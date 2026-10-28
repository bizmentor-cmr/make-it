// Make It — Agency Client User + Branding management (P4).
//
// The agency can create light login accounts (`ClientUser`) for their clients so
// the client can sign into the standalone `/portal` page and view their
// dashboards + validate/refuse content. The agency can also configure per-client
// white-label `ClientBranding` (logo, primary/secondary color, font, agency
// display name) so the portal can be presented under the agency's colors
// instead of Make It's.
//
// Passwords are hashed via bcrypt (10 rounds — same as the main User table).
// All mutations emit AuditLog entries. These functions DO NOT enforce agency
// RBAC themselves — the API routes are responsible for calling
// `resolveAgency(req)` + `hasAgencyRole(ctx, "manager")` + verifying the
// agencyClientId belongs to the agency before invoking these helpers.

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";

// ─────────────────────────── types ───────────────────────────

export type ClientUserStatus = "active" | "suspended";

export const CLIENT_USER_STATUSES: readonly ClientUserStatus[] = [
  "active",
  "suspended",
] as const;

export type ClientUserRow = {
  id: string;
  agencyClientId: string;
  email: string;
  name: string | null;
  status: ClientUserStatus;
  lastLoginAt: string | null;
  createdAt: string;
};

export type ClientBrandingRow = {
  id: string;
  agencyClientId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  agencyName: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_BRANDING: Omit<ClientBrandingRow, "id" | "agencyClientId" | "createdAt" | "updatedAt"> = {
  logoUrl: null,
  primaryColor: "#7c3aed", // violet — Make It primary
  secondaryColor: "#10b981", // emerald — Make It accent
  font: null,
  agencyName: null,
};

function isClientUserStatus(v: unknown): v is ClientUserStatus {
  return typeof v === "string" && (CLIENT_USER_STATUSES as readonly string[]).includes(v);
}

function toUserRow(u: {
  id: string;
  agencyClientId: string;
  email: string;
  name: string | null;
  passwordHash: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}): ClientUserRow {
  return {
    id: u.id,
    agencyClientId: u.agencyClientId,
    email: u.email,
    name: u.name,
    status: isClientUserStatus(u.status) ? u.status : "active",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

function toBrandingRow(b: {
  id: string;
  agencyClientId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  agencyName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ClientBrandingRow {
  return {
    id: b.id,
    agencyClientId: b.agencyClientId,
    logoUrl: b.logoUrl,
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    font: b.font,
    agencyName: b.agencyName,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ─────────────────────────── helpers ───────────────────────────

// Verifies that an agencyClientId belongs to the given agency.
// Returns the AgencyClient row (with workspaceId) or null.
export async function verifyClientOwnership(
  agencyId: string,
  agencyClientId: string
): Promise<{ id: string; agencyId: string; workspaceId: string; status: string } | null> {
  const c = await db.agencyClient.findUnique({
    where: { id: agencyClientId },
    select: { id: true, agencyId: true, workspaceId: true, status: true },
  });
  if (!c || c.agencyId !== agencyId) return null;
  return c;
}

// ─────────────────────────── ClientUser CRUD ───────────────────────────

// Create a ClientUser login for a client. Email must be unique within the
// agency client (not globally — two agencies could have a "contact@x.com"
// client). Password is hashed via bcrypt.
export async function createClientUser(opts: {
  agencyClientId: string;
  email: string;
  name?: string | null;
  password: string;
  createdBy?: string; // user id of the agency member (audit only)
}): Promise<ClientUserRow> {
  const email = (opts.email ?? "").toLowerCase().trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("EMAIL_INVALID");
  }
  const pwd = opts.password ?? "";
  if (pwd.length < 6) throw new Error("PASSWORD_TOO_SHORT");

  // Unique email within the client.
  const existing = await db.clientUser.findFirst({
    where: { agencyClientId: opts.agencyClientId, email },
    select: { id: true },
  });
  if (existing) throw new Error("EMAIL_ALREADY_USED");

  const passwordHash = await bcrypt.hash(pwd, 10);
  const row = await db.clientUser.create({
    data: {
      agencyClientId: opts.agencyClientId,
      email,
      name: opts.name?.trim() || null,
      passwordHash,
      status: "active",
    },
  });

  await audit({
    action: "agency.client_user.create",
    entity: "ClientUser",
    entityId: row.id,
    userId: opts.createdBy,
    metadata: {
      agencyClientId: opts.agencyClientId,
      email,
      name: row.name,
    },
  });
  logger.info("agency.client_user.created", { id: row.id, agencyClientId: opts.agencyClientId, email });
  return toUserRow(row);
}

// List all ClientUsers for a client (no password hashes exposed).
export async function listClientUsers(agencyClientId: string): Promise<ClientUserRow[]> {
  const rows = await db.clientUser.findMany({
    where: { agencyClientId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toUserRow);
}

// Update a ClientUser. If `password` is provided it's re-hashed. The
// `status` field can be toggled between active | suspended (suspended
// prevents portal login).
export async function updateClientUser(
  id: string,
  patch: {
    name?: string | null;
    password?: string;
    status?: ClientUserStatus;
  },
  opts: { updatedBy?: string } = {}
): Promise<ClientUserRow> {
  const existing = await db.clientUser.findUnique({ where: { id } });
  if (!existing) throw new Error("CLIENT_USER_NOT_FOUND");

  const data: {
    name?: string | null;
    passwordHash?: string;
    status?: ClientUserStatus;
  } = {};
  if (patch.name !== undefined) {
    data.name = patch.name?.trim() || null;
  }
  if (typeof patch.password === "string" && patch.password.length > 0) {
    if (patch.password.length < 6) throw new Error("PASSWORD_TOO_SHORT");
    data.passwordHash = await bcrypt.hash(patch.password, 10);
  }
  if (patch.status !== undefined) {
    if (!isClientUserStatus(patch.status)) throw new Error("STATUS_INVALID");
    data.status = patch.status;
  }
  if (Object.keys(data).length === 0) throw new Error("NOTHING_TO_UPDATE");

  const updated = await db.clientUser.update({ where: { id }, data });
  await audit({
    action: "agency.client_user.update",
    entity: "ClientUser",
    entityId: id,
    userId: opts.updatedBy,
    metadata: {
      agencyClientId: existing.agencyClientId,
      changedName: data.name !== undefined,
      changedPassword: !!data.passwordHash,
      changedStatus: data.status ?? null,
    },
  });
  return toUserRow(updated);
}

// Delete a ClientUser (cascades portal access — JWTs will be rejected on next
// verify because the user no longer exists).
export async function deleteClientUser(
  id: string,
  opts: { deletedBy?: string } = {}
): Promise<{ deleted: boolean; id: string }> {
  const existing = await db.clientUser.findUnique({ where: { id } });
  if (!existing) throw new Error("CLIENT_USER_NOT_FOUND");
  await db.clientUser.delete({ where: { id } });
  await audit({
    action: "agency.client_user.delete",
    entity: "ClientUser",
    entityId: id,
    userId: opts.deletedBy,
    metadata: { agencyClientId: existing.agencyClientId, email: existing.email },
  });
  return { deleted: true, id };
}

// ─────────────────────────── ClientBranding ───────────────────────────

// Returns the ClientBranding for an agency client, or a default (violet +
// emerald, no logo) if none exists yet. Always returns a fully-populated row.
export async function getClientBranding(
  agencyClientId: string
): Promise<ClientBrandingRow> {
  const row = await db.clientBranding.findUnique({
    where: { agencyClientId },
  });
  if (row) return toBrandingRow(row);
  // Return a default-shaped row (NOT persisted — persisted on first PATCH).
  return {
    id: "",
    agencyClientId,
    ...DEFAULT_BRANDING,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

// Update (or create) the ClientBranding for an agency client. Only the
// provided fields are touched.
export async function updateClientBranding(
  agencyClientId: string,
  patch: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    font?: string | null;
    agencyName?: string | null;
  },
  opts: { updatedBy?: string } = {}
): Promise<ClientBrandingRow> {
  const data: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    font?: string | null;
    agencyName?: string | null;
  } = {};
  if (patch.logoUrl !== undefined) data.logoUrl = patch.logoUrl?.trim() || null;
  if (patch.primaryColor !== undefined) {
    const c = patch.primaryColor?.trim() || null;
    if (c && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
      throw new Error("COLOR_INVALID");
    }
    data.primaryColor = c;
  }
  if (patch.secondaryColor !== undefined) {
    const c = patch.secondaryColor?.trim() || null;
    if (c && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
      throw new Error("COLOR_INVALID");
    }
    data.secondaryColor = c;
  }
  if (patch.font !== undefined) data.font = patch.font?.trim() || null;
  if (patch.agencyName !== undefined) data.agencyName = patch.agencyName?.trim() || null;

  // Upsert — creates the row if it doesn't exist yet.
  const updated = await db.clientBranding.upsert({
    where: { agencyClientId },
    update: data,
    create: {
      agencyClientId,
      logoUrl: data.logoUrl ?? null,
      primaryColor: data.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      secondaryColor: data.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
      font: data.font ?? null,
      agencyName: data.agencyName ?? null,
    },
  });
  await audit({
    action: "agency.client_branding.update",
    entity: "ClientBranding",
    entityId: updated.id,
    userId: opts.updatedBy,
    metadata: { agencyClientId, fields: Object.keys(data) },
  });
  return toBrandingRow(updated);
}

// Verify a ClientUser's password (used by the client-portal auth login flow).
// Returns the ClientUser row (with agencyClientId) on success, or null.
export async function verifyClientUserCredentials(
  email: string,
  password: string
): Promise<ClientUserRow | null> {
  const e = (email ?? "").toLowerCase().trim();
  if (!e || !password) return null;
  // Email isn't globally unique (two agencies can share an email) — we look
  // up by email across all clients and pick the first active match whose
  // bcrypt hash verifies. The portal page must guard against ambiguous emails
  // in production; for the MVP this is acceptable.
  const candidates = await db.clientUser.findMany({
    where: { email: e, status: "active" },
    take: 5,
  });
  for (const u of candidates) {
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (ok) {
      // Touch lastLoginAt (best-effort).
      await db.clientUser
        .update({ where: { id: u.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
      return toUserRow(u);
    }
  }
  return null;
}
