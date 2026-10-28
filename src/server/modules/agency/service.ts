// Make It — Agency domain service.
//
// Powers "Make It for Agencies" — a meta-account that lets an agency manage
// multiple client workspaces from a single sign-in.
//
// Activation flow:
//   activateAgency(userId, name) creates the Agency + AgencyWallet + AgencySetting
//   + AgencyMember(admin) for the activating user. The user's CURRENT workspace
//   is onboarded as the agency's first AgencyClient (so the Portfolio isn't
//   empty). The user can then create more client workspaces via createClient().
//
// All operations are tenant-aware (scoped by agencyId) and emit AuditLog entries.

import { db } from "@/lib/db";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";
import { jsonStringify } from "@/server/core/types";
import { createWorkspaceWithOwner } from "@/server/modules/workspaces/service";
import {
  AGENCY_ROLE_RANK,
  type AgencyRole,
} from "@/server/core/rbac";
import { computeScores } from "@/server/modules/insights/performance";

// Re-export for API routes that prefer to import from the service module.
export { AGENCY_ROLE_RANK, type AgencyRole };

// ─────────────────────────── types ───────────────────────────

export type ClientStatus = "active" | "paused" | "archived";
export const CLIENT_STATUSES: readonly ClientStatus[] = ["active", "paused", "archived"] as const;

export type AgencyContext = {
  agencyId: string;
  agencyName: string;
  role: AgencyRole;
  userId: string;
};

// ─────────────────────────── helpers ───────────────────────────

function slugifyAgency(input: string): string {
  const base = (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  return base || "agence";
}

async function uniqueAgencySlug(name: string): Promise<string> {
  const base = slugifyAgency(name);
  let candidate = base;
  let i = 1;
  while (await db.agency.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

function isAgencyRole(v: unknown): v is AgencyRole {
  return typeof v === "string" && (["admin", "manager", "creative"] as readonly string[]).includes(v);
}

export function isClientStatus(v: unknown): v is ClientStatus {
  return typeof v === "string" && (CLIENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Compute a 0-100 "Make It Score" for a client workspace.
 * Delegates to the existing insights/performance engine (computeScores).
 * Returns 0 if the engine can't compute (e.g. brand-new workspace with no data).
 */
export async function computeMakeItScore(workspaceId: string): Promise<number> {
  try {
    const scores = await computeScores(workspaceId);
    return Math.max(0, Math.min(100, Math.round(scores.total)));
  } catch (e) {
    logger.warn("agency:computeMakeItScore failed", { workspaceId, error: e });
    return 0;
  }
}

// ─────────────────────────── activateAgency ───────────────────────────

export async function activateAgency(opts: {
  userId: string;
  name: string;
}): Promise<{
  agency: {
    id: string;
    name: string;
    slug: string;
    status: string;
    mode: string;
  };
  role: AgencyRole;
  firstClientId: string;
  firstClientName: string;
}> {
  const name = opts.name?.trim();
  if (!name || name.length < 2) throw new Error("NAME_REQUIRED");

  // Already activated?
  const existing = await db.agencyMember.findFirst({
    where: { userId: opts.userId },
    include: { agency: true },
  });
  if (existing) {
    return {
      agency: {
        id: existing.agency.id,
        name: existing.agency.name,
        slug: existing.agency.slug,
        status: existing.agency.status,
        mode: existing.agency.mode,
      },
      role: existing.role as AgencyRole,
      firstClientId: "",
      firstClientName: "",
    };
  }

  const slug = await uniqueAgencySlug(name);

  // Find the user's current workspace (their first membership) — this will be
  // onboarded as the agency's first AgencyClient (so the Portfolio isn't empty).
  const firstMembership = await db.workspaceMember.findFirst({
    where: { userId: opts.userId },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });

  // Create the Agency + wallet + settings + admin membership in a transaction.
  const result = await db.$transaction(async (tx) => {
    const agency = await tx.agency.create({
      data: {
        name,
        slug,
        ownerId: opts.userId,
        status: "active",
        mode: "pool",
      },
    });

    await tx.agencyWallet.create({
      data: {
        agencyId: agency.id,
        totalCredits: 0,
        reservedCredits: 0,
        totalConsumed: 0,
      },
    });

    await tx.agencySetting.create({
      data: {
        agencyId: agency.id,
        requireClientValidation: false,
        whiteLabel: false,
        autoReports: true,
      },
    });

    const adminMember = await tx.agencyMember.create({
      data: {
        agencyId: agency.id,
        userId: opts.userId,
        role: "admin",
      },
    });

    // Onboard the user's current workspace as the first client (if any).
    let firstClientId = "";
    let firstClientName = "";
    if (firstMembership) {
      const ws = firstMembership.workspace;
      // Make sure a wallet exists for this workspace.
      await tx.creditWallet.upsert({
        where: { workspaceId: ws.id },
        update: {},
        create: { workspaceId: ws.id, subscriptionCredits: 5000 },
      });
      const client = await tx.agencyClient.create({
        data: {
          agencyId: agency.id,
          workspaceId: ws.id,
          status: "active",
        },
      });
      // The activating admin gets manager access to the client.
      await tx.agencyClientAccess.create({
        data: {
          agencyClientId: client.id,
          userId: opts.userId,
          role: "manager",
          assignedById: opts.userId,
        },
      });
      firstClientId = client.id;
      firstClientName = ws.name;
    }

    return { agency, adminMember, firstClientId, firstClientName };
  });

  await audit({
    userId: opts.userId,
    action: "agency.activate",
    entity: "Agency",
    entityId: result.agency.id,
    metadata: {
      name: result.agency.name,
      slug: result.agency.slug,
      firstClientId: result.firstClientId || null,
      firstClientName: result.firstClientName || null,
    },
  });

  logger.info("agency:activated", {
    agencyId: result.agency.id,
    userId: opts.userId,
    firstClientId: result.firstClientId,
  });

  return {
    agency: {
      id: result.agency.id,
      name: result.agency.name,
      slug: result.agency.slug,
      status: result.agency.status,
      mode: result.agency.mode,
    },
    role: "admin",
    firstClientId: result.firstClientId,
    firstClientName: result.firstClientName,
  };
}

// ─────────────────────────── getAgency ───────────────────────────

export async function getAgency(userId: string): Promise<{
  agency: {
    id: string;
    name: string;
    slug: string;
    status: string;
    mode: string;
    createdAt: string;
  };
  role: AgencyRole;
  wallet: {
    totalCredits: number;
    reservedCredits: number;
    totalConsumed: number;
    available: number;
  };
  clientCount: number;
  memberCount: number;
} | null> {
  const member = await db.agencyMember.findFirst({
    where: { userId },
    include: {
      agency: {
        include: {
          wallet: true,
          _count: { select: { clients: true, members: true } },
        },
      },
    },
  });
  if (!member) return null;

  const wallet = member.agency.wallet;
  const total = wallet?.totalCredits ?? 0;
  const reserved = wallet?.reservedCredits ?? 0;
  const consumed = wallet?.totalConsumed ?? 0;

  return {
    agency: {
      id: member.agency.id,
      name: member.agency.name,
      slug: member.agency.slug,
      status: member.agency.status,
      mode: member.agency.mode,
      createdAt: member.agency.createdAt.toISOString(),
    },
    role: member.role as AgencyRole,
    wallet: {
      totalCredits: total,
      reservedCredits: reserved,
      totalConsumed: consumed,
      available: Math.max(0, total - reserved),
    },
    clientCount: member.agency._count.clients,
    memberCount: member.agency._count.members,
  };
}

// ─────────────────────────── listAgencyClients ───────────────────────────

export async function listAgencyClients(
  agencyId: string,
  userId: string
): Promise<{
  clients: Array<{
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: ClientStatus;
    onboardedAt: string;
    archivedAt: string | null;
    makeItScore: number;
    managerName: string | null;
    myRole: AgencyRole | "manager" | "creative" | null;
    platforms: string[];
    objective: string | null;
    sector: string | null;
    country: string | null;
  }>;
}> {
  // Verify membership
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
  });
  if (!member) return { clients: [] };

  const rows = await db.agencyClient.findMany({
    where: { agencyId },
    include: {
      workspace: {
        include: {
          brandProfile: true,
          socialAccounts: { where: { status: "connected" }, select: { platform: true } },
        },
      },
      accesses: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { onboardedAt: "asc" },
  });

  const clients = await Promise.all(
    rows.map(async (c) => {
      const manager = c.accesses.find((a) => a.role === "manager");
      const myAccess = c.accesses.find((a) => a.userId === userId);
      const score = await computeMakeItScore(c.workspaceId);
      const platforms = Array.from(
        new Set(c.workspace.socialAccounts.map((s) => s.platform))
      );
      return {
        id: c.id,
        workspaceId: c.workspaceId,
        name: c.workspace.name,
        slug: c.workspace.slug,
        status: c.status as ClientStatus,
        onboardedAt: c.onboardedAt.toISOString(),
        archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
        makeItScore: score,
        managerName: manager?.user.name ?? manager?.user.email ?? null,
        myRole: (myAccess?.role ?? null) as AgencyRole | "manager" | "creative" | null,
        platforms,
        objective: c.workspace.brandProfile?.objectives ?? null,
        sector: c.workspace.brandProfile?.industry ?? null,
        country: c.workspace.brandProfile?.country ?? null,
      };
    })
  );

  return { clients };
}

// ─────────────────────────── createClient ───────────────────────────

export async function createClient(opts: {
  agencyId: string;
  userId: string;
  name: string;
  sector?: string | null;
  country?: string | null;
  platforms?: string[];
  objective?: string | null;
}): Promise<{
  client: {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: ClientStatus;
  };
}> {
  const name = opts.name?.trim();
  if (!name || name.length < 2) throw new Error("NAME_REQUIRED");

  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.userId } },
  });
  if (!member) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[member.role as AgencyRole] < AGENCY_ROLE_RANK.manager) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  // Create the workspace with the activating user as owner.
  const { workspace } = await createWorkspaceWithOwner({
    ownerId: opts.userId,
    name,
    plan: "free",
  });

  // Create the brand profile with the client metadata.
  const platforms = opts.platforms && opts.platforms.length > 0 ? opts.platforms : [];
  await db.brandProfile.upsert({
    where: { workspaceId: workspace.id },
    update: {
      industry: opts.sector ?? null,
      country: opts.country ?? null,
      objectives: opts.objective ?? null,
    },
    create: {
      workspaceId: workspace.id,
      businessName: name,
      industry: opts.sector ?? null,
      country: opts.country ?? null,
      objectives: opts.objective ?? null,
    },
  });

  // Onboard as agency client.
  const client = await db.agencyClient.create({
    data: {
      agencyId: opts.agencyId,
      workspaceId: workspace.id,
      status: "active",
    },
  });

  // The creator gets manager access.
  await db.agencyClientAccess.create({
    data: {
      agencyClientId: client.id,
      userId: opts.userId,
      role: "manager",
      assignedById: opts.userId,
    },
  });

  // Persist platforms on the workspace (best-effort — store as a note via audit).
  await audit({
    userId: opts.userId,
    action: "agency.client.create",
    entity: "AgencyClient",
    entityId: client.id,
    metadata: {
      agencyId: opts.agencyId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      sector: opts.sector ?? null,
      country: opts.country ?? null,
      platforms,
      objective: opts.objective ?? null,
    },
  });

  // P5: Auto-create a `#client-{name}` channel at the agency level for
  // cross-team discussion about this client (best-effort — never fails the
  // client creation if seeding errors out).
  try {
    const { seedClientChannel } = await import("@/server/modules/messaging/service");
    void (await seedClientChannel(opts.agencyId, name, opts.userId));
  } catch (e) {
    logger.warn("agency.createClient: seedClientChannel failed", {
      agencyId: opts.agencyId,
      name,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    client: {
      id: client.id,
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: client.status as ClientStatus,
    },
  };
}

// ─────────────────────────── archiveClient ───────────────────────────

export async function archiveClient(opts: {
  agencyId: string;
  clientId: string;
  userId: string;
}): Promise<{ archived: boolean; clientId: string }> {
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.userId } },
  });
  if (!member) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[member.role as AgencyRole] < AGENCY_ROLE_RANK.manager) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  const client = await db.agencyClient.findFirst({
    where: { id: opts.clientId, agencyId: opts.agencyId },
  });
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  const updated = await db.agencyClient.update({
    where: { id: client.id },
    data: { status: "archived", archivedAt: new Date() },
  });

  await audit({
    userId: opts.userId,
    action: "agency.client.archive",
    entity: "AgencyClient",
    entityId: client.id,
    metadata: { agencyId: opts.agencyId, workspaceId: client.workspaceId },
  });

  return { archived: true, clientId: updated.id };
}

// ─────────────────────────── listAgencyMembers ───────────────────────────

export async function listAgencyMembers(agencyId: string, userId: string): Promise<{
  members: Array<{
    id: string;
    userId: string;
    email: string;
    name: string | null;
    role: AgencyRole;
    assignedClientsCount: number;
    createdAt: string;
  }>;
}> {
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
  });
  if (!member) return { members: [] };

  const rows = await db.agencyMember.findMany({
    where: { agencyId },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Count each member's client accesses within this agency (grouped by userId).
  const userIds = rows.map((r) => r.userId);
  const accesses = await db.agencyClientAccess.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      agencyClient: { agencyId },
    },
    _count: { _all: true },
  });
  const accessCountByUser = new Map<string, number>(
    accesses.map((a) => [a.userId, a._count._all])
  );

  return {
    members: rows.map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role as AgencyRole,
      assignedClientsCount: accessCountByUser.get(m.userId) ?? 0,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

// ─────────────────────────── inviteMember ───────────────────────────
//
// Agency invites are lightweight for P2: if the email matches an existing user,
// they're added directly as an AgencyMember. Otherwise we record an audit entry
// (no email transport in dev) and let the agency admin share a sign-up link.
// Either way, this returns the member (or the pending invite record).

export async function inviteMember(opts: {
  agencyId: string;
  invitedBy: string;
  email: string;
  role: AgencyRole;
}): Promise<{
  member: {
    id: string;
    userId: string;
    email: string;
    name: string | null;
    role: AgencyRole;
    pending: boolean;
  } | null;
}> {
  const email = opts.email.toLowerCase().trim();
  if (!email) throw new Error("EMAIL_REQUIRED");
  if (!isAgencyRole(opts.role)) throw new Error("INVALID_ROLE");

  // Look up the user by email — if found, add as AgencyMember directly.
  const existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    // No user with this email — record the invite as audit (P2 placeholder).
    await audit({
      userId: opts.invitedBy,
      action: "agency.member.invite.pending",
      entity: "Agency",
      entityId: opts.agencyId,
      metadata: { email, role: opts.role, reason: "no_account_yet" },
    });
    return { member: null };
  }

  // Already a member?
  const already = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: existing.id } },
  });
  if (already) {
    // Update role if changed.
    if (already.role !== opts.role) {
      const updated = await db.agencyMember.update({
        where: { id: already.id },
        data: { role: opts.role },
      });
      await audit({
        userId: opts.invitedBy,
        action: "agency.member.role.change",
        entity: "AgencyMember",
        entityId: updated.id,
        metadata: { from: already.role, to: opts.role, targetEmail: email },
      });
    }
    return {
      member: {
        id: already.id,
        userId: existing.id,
        email,
        name: existing.name,
        role: opts.role,
        pending: false,
      },
    };
  }

  const member = await db.agencyMember.create({
    data: {
      agencyId: opts.agencyId,
      userId: existing.id,
      role: opts.role,
    },
  });

  await audit({
    userId: opts.invitedBy,
    action: "agency.member.add",
    entity: "AgencyMember",
    entityId: member.id,
    metadata: { email, role: opts.role, targetUserId: existing.id },
  });

  return {
    member: {
      id: member.id,
      userId: existing.id,
      email,
      name: existing.name,
      role: opts.role,
      pending: false,
    },
  };
}

// ─────────────────────────── updateMemberRole ───────────────────────────

export async function updateMemberRole(opts: {
  agencyId: string;
  memberId: string;
  actingUserId: string;
  role: AgencyRole;
}): Promise<{ member: { id: string; role: AgencyRole } }> {
  if (!isAgencyRole(opts.role)) throw new Error("INVALID_ROLE");

  const actor = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.actingUserId } },
  });
  if (!actor) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[actor.role as AgencyRole] < AGENCY_ROLE_RANK.admin) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  const target = await db.agencyMember.findFirst({
    where: { id: opts.memberId, agencyId: opts.agencyId },
    include: { user: { select: { email: true } } },
  });
  if (!target) throw new Error("MEMBER_NOT_FOUND");
  if (target.userId === opts.actingUserId && opts.role !== "admin") {
    // Allow self-demotion only if there's another admin (best-effort: just block).
    throw new Error("CANNOT_DEMOTE_SELF");
  }

  const updated = await db.agencyMember.update({
    where: { id: target.id },
    data: { role: opts.role },
  });

  await audit({
    userId: opts.actingUserId,
    action: "agency.member.role.change",
    entity: "AgencyMember",
    entityId: target.id,
    metadata: { from: target.role, to: opts.role, targetEmail: target.user.email },
  });

  return { member: { id: updated.id, role: updated.role as AgencyRole } };
}

// ─────────────────────────── removeMember ───────────────────────────

export async function removeMember(opts: {
  agencyId: string;
  memberId: string;
  actingUserId: string;
}): Promise<{ removed: boolean; memberId: string }> {
  const actor = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.actingUserId } },
  });
  if (!actor) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[actor.role as AgencyRole] < AGENCY_ROLE_RANK.admin) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  const target = await db.agencyMember.findFirst({
    where: { id: opts.memberId, agencyId: opts.agencyId },
    include: { user: { select: { email: true } } },
  });
  if (!target) throw new Error("MEMBER_NOT_FOUND");
  if (target.userId === opts.actingUserId) throw new Error("CANNOT_REMOVE_SELF");
  if (target.role === "admin") {
    // Block removing the last admin.
    const adminCount = await db.agencyMember.count({
      where: { agencyId: opts.agencyId, role: "admin" },
    });
    if (adminCount <= 1) throw new Error("LAST_ADMIN");
  }

  // Cascade: also drop their client access entries.
  await db.agencyClientAccess.deleteMany({
    where: { userId: target.userId, agencyClient: { agencyId: opts.agencyId } },
  });
  await db.agencyMember.delete({ where: { id: target.id } });

  await audit({
    userId: opts.actingUserId,
    action: "agency.member.remove",
    entity: "AgencyMember",
    entityId: target.id,
    metadata: { targetEmail: target.user.email, targetRole: target.role },
  });

  return { removed: true, memberId: target.id };
}

// ─────────────────────────── assignClientAccess ───────────────────────────

export async function assignClientAccess(opts: {
  agencyId: string;
  clientId: string;
  userId: string;
  role: "manager" | "creative";
  assignedBy: string;
}): Promise<{
  access: {
    id: string;
    agencyClientId: string;
    userId: string;
    role: "manager" | "creative";
  };
}> {
  const actor = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.assignedBy } },
  });
  if (!actor) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[actor.role as AgencyRole] < AGENCY_ROLE_RANK.manager) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  const client = await db.agencyClient.findFirst({
    where: { id: opts.clientId, agencyId: opts.agencyId },
  });
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  // Verify the target user is an agency member.
  const target = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.userId } },
    include: { user: { select: { email: true } } },
  });
  if (!target) throw new Error("TARGET_NOT_MEMBER");

  const access = await db.agencyClientAccess.upsert({
    where: { agencyClientId_userId: { agencyClientId: client.id, userId: opts.userId } },
    update: { role: opts.role, assignedById: opts.assignedBy },
    create: {
      agencyClientId: client.id,
      userId: opts.userId,
      role: opts.role,
      assignedById: opts.assignedBy,
    },
  });

  await audit({
    userId: opts.assignedBy,
    action: "agency.access.assign",
    entity: "AgencyClientAccess",
    entityId: access.id,
    metadata: {
      clientId: client.id,
      targetUserId: opts.userId,
      targetEmail: target.user.email,
      role: opts.role,
    },
  });

  return {
    access: {
      id: access.id,
      agencyClientId: access.agencyClientId,
      userId: access.userId,
      role: access.role as "manager" | "creative",
    },
  };
}

// ─────────────────────────── listMyClients ───────────────────────────

export async function listMyClients(userId: string): Promise<{
  clients: Array<{
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: ClientStatus;
    role: "manager" | "creative";
    makeItScore: number;
    agencyId: string;
  }>;
}> {
  const accesses = await db.agencyClientAccess.findMany({
    where: { userId },
    include: {
      agencyClient: {
        include: {
          workspace: { select: { id: true, name: true, slug: true } },
          agency: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const clients = await Promise.all(
    accesses.map(async (a) => ({
      id: a.agencyClient.id,
      workspaceId: a.agencyClient.workspace.id,
      name: a.agencyClient.workspace.name,
      slug: a.agencyClient.workspace.slug,
      status: a.agencyClient.status as ClientStatus,
      role: a.role as "manager" | "creative",
      makeItScore: await computeMakeItScore(a.agencyClient.workspace.id),
      agencyId: a.agencyClient.agency.id,
    }))
  );

  return { clients };
}

// ─────────────────────────── switchClient ───────────────────────────
//
// Verifies the user has access to the target client (either via AgencyClientAccess
// OR they are an agency admin/manager — admins/managers can access all clients).
// Returns the workspace context for the client's workspace so the frontend can
// pin the active workspace via setWorkspaceHeader.

export async function switchClient(opts: {
  clientId: string;
  userId: string;
}): Promise<{
  client: {
    id: string;
    agencyId: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: ClientStatus;
    role: "manager" | "creative" | "admin";
  };
}> {
  const client = await db.agencyClient.findUnique({
    where: { id: opts.clientId },
    include: { workspace: { select: { id: true, name: true, slug: true } }, agency: true },
  });
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  if (client.status === "archived") throw new Error("CLIENT_ARCHIVED");

  // Check agency-level access (admin or manager can access any client).
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: client.agencyId, userId: opts.userId } },
  });

  let role: "manager" | "creative" | "admin" | null = null;
  if (member) {
    if (member.role === "admin") role = "admin";
    else if (member.role === "manager") role = "manager";
  }

  // If not an agency manager/admin, check explicit client access.
  if (!role) {
    const access = await db.agencyClientAccess.findUnique({
      where: { agencyClientId_userId: { agencyClientId: client.id, userId: opts.userId } },
    });
    if (!access) throw new Error("NO_ACCESS");
    role = access.role as "manager" | "creative";
  }

  await audit({
    userId: opts.userId,
    workspaceId: client.workspaceId,
    action: "agency.client.switch",
    entity: "AgencyClient",
    entityId: client.id,
    metadata: { agencyId: client.agencyId, role },
  });

  return {
    client: {
      id: client.id,
      agencyId: client.agencyId,
      workspaceId: client.workspace.id,
      name: client.workspace.name,
      slug: client.workspace.slug,
      status: client.status as ClientStatus,
      role,
    },
  };
}

// ─────────────────────────── getClient ───────────────────────────

export async function getClient(opts: {
  clientId: string;
  userId: string;
}): Promise<{
  client: {
    id: string;
    agencyId: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: ClientStatus;
    onboardedAt: string;
    makeItScore: number;
    sector: string | null;
    country: string | null;
    platforms: string[];
    objective: string | null;
    myRole: "manager" | "creative" | "admin";
    manager: { id: string; name: string | null; email: string } | null;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
} | null> {
  const client = await db.agencyClient.findUnique({
    where: { id: opts.clientId },
    include: {
      workspace: {
        include: {
          brandProfile: true,
          socialAccounts: { where: { status: "connected" }, select: { platform: true } },
        },
      },
      accesses: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      agency: {
        include: { members: { where: { userId: opts.userId } } },
      },
    },
  });
  if (!client) return null;

  // Resolve role (admin > manager > creative).
  const myMember = client.agency.members[0];
  let myRole: "manager" | "creative" | "admin" | null = null;
  if (myMember) {
    if (myMember.role === "admin") myRole = "admin";
    else if (myMember.role === "manager") myRole = "manager";
  }
  if (!myRole) {
    const access = client.accesses.find((a) => a.userId === opts.userId);
    if (access) myRole = access.role as "manager" | "creative";
  }
  if (!myRole) return null; // no access

  const managerAccess = client.accesses.find((a) => a.role === "manager");
  const score = await computeMakeItScore(client.workspaceId);

  return {
    client: {
      id: client.id,
      agencyId: client.agencyId,
      workspaceId: client.workspaceId,
      name: client.workspace.name,
      slug: client.workspace.slug,
      status: client.status as ClientStatus,
      onboardedAt: client.onboardedAt.toISOString(),
      makeItScore: score,
      sector: client.workspace.brandProfile?.industry ?? null,
      country: client.workspace.brandProfile?.country ?? null,
      platforms: Array.from(
        new Set(client.workspace.socialAccounts.map((s) => s.platform))
      ),
      objective: client.workspace.brandProfile?.objectives ?? null,
      myRole,
      manager: managerAccess
        ? {
            id: managerAccess.user.id,
            name: managerAccess.user.name,
            email: managerAccess.user.email,
          }
        : null,
    },
    workspace: {
      id: client.workspace.id,
      name: client.workspace.name,
      slug: client.workspace.slug,
      plan: client.workspace.plan,
    },
  };
}

// ─────────────────────────── updateClient ───────────────────────────

export async function updateClient(opts: {
  agencyId: string;
  clientId: string;
  userId: string;
  name?: string;
  status?: ClientStatus;
}): Promise<{
  client: { id: string; status: ClientStatus; name: string };
}> {
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.userId } },
  });
  if (!member) throw new Error("NOT_AGENCY_MEMBER");
  if (AGENCY_ROLE_RANK[member.role as AgencyRole] < AGENCY_ROLE_RANK.manager) {
    throw new Error("INSUFFICIENT_ROLE");
  }

  const client = await db.agencyClient.findFirst({
    where: { id: opts.clientId, agencyId: opts.agencyId },
    include: { workspace: true },
  });
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  const updates: { workspaceName?: string; clientStatus?: ClientStatus } = {};
  if (typeof opts.name === "string" && opts.name.trim().length >= 2) {
    updates.workspaceName = opts.name.trim();
  }
  if (opts.status && isClientStatus(opts.status)) {
    updates.clientStatus = opts.status;
  }

  let newName = client.workspace.name;
  if (updates.workspaceName) {
    await db.workspace.update({
      where: { id: client.workspaceId },
      data: { name: updates.workspaceName },
    });
    newName = updates.workspaceName;
  }

  let newStatus = client.status as ClientStatus;
  if (updates.clientStatus) {
    const updated = await db.agencyClient.update({
      where: { id: client.id },
      data: {
        status: updates.clientStatus,
        archivedAt: updates.clientStatus === "archived" ? new Date() : null,
      },
    });
    newStatus = updated.status as ClientStatus;
  }

  await audit({
    userId: opts.userId,
    action: "agency.client.update",
    entity: "AgencyClient",
    entityId: client.id,
    metadata: {
      agencyId: opts.agencyId,
      name: updates.workspaceName ?? null,
      status: updates.clientStatus ?? null,
    },
  });

  return {
    client: {
      id: client.id,
      status: newStatus,
      name: newName,
    },
  };
}

// ─────────────────────────── deactivateAgency ───────────────────────────
//
// Archives all clients but keeps the data (audit-friendly). The agency record
// itself stays so the user can re-activate. The user's agency membership is
// preserved.

export async function deactivateAgency(opts: {
  agencyId: string;
  userId: string;
}): Promise<{ deactivated: boolean; archivedClientCount: number }> {
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId: opts.agencyId, userId: opts.userId } },
  });
  if (!member) throw new Error("NOT_AGENCY_MEMBER");
  if (member.role !== "admin") throw new Error("ADMIN_ONLY");

  const now = new Date();
  // Archive all active/paused clients.
  const result = await db.agencyClient.updateMany({
    where: { agencyId: opts.agencyId, status: { not: "archived" } },
    data: { status: "archived", archivedAt: now },
  });

  // Mark the agency itself as archived.
  await db.agency.update({
    where: { id: opts.agencyId },
    data: { status: "archived" },
  });

  await audit({
    userId: opts.userId,
    action: "agency.deactivate",
    entity: "Agency",
    entityId: opts.agencyId,
    metadata: { archivedClientCount: result.count },
  });

  logger.info("agency:deactivated", {
    agencyId: opts.agencyId,
    userId: opts.userId,
    archivedClientCount: result.count,
  });

  return { deactivated: true, archivedClientCount: result.count };
}

// Re-export for API routes.
export { jsonStringify };
