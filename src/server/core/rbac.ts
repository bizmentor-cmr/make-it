// Make It — RBAC + workspace context helpers.
// Tenant isolation: every query must be scoped by workspaceId.

import { db } from "@/lib/db";
import { getSessionUser } from "./auth";
import { ROLE_RANK, type Role } from "./types";

// ─────────────────────────── WORKSPACE CONTEXT ───────────────────────────

export type WorkspaceCtx = {
  workspaceId: string;
  workspaceName: string;
  plan: string;
  role: Role;
  userId: string;
};

export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceCtx | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    include: { workspace: true },
  });
  if (!membership) return null;
  return {
    workspaceId,
    workspaceName: membership.workspace.name,
    plan: membership.workspace.plan,
    role: membership.role as Role,
    userId: user.id,
  };
}

// Resolve workspace from query param or header `x-workspace-id`, fallback to first membership.
export async function resolveWorkspace(req: Request): Promise<WorkspaceCtx | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("workspaceId");
  const fromHeader = req.headers.get("x-workspace-id");
  const candidate = fromQuery || fromHeader;
  if (candidate) return getWorkspaceContext(candidate);

  const user = await getSessionUser();
  if (!user) return null;
  const first = await db.workspaceMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
  if (!first) return null;
  return {
    workspaceId: first.workspaceId,
    workspaceName: first.workspace.name,
    plan: first.workspace.plan,
    role: first.role as Role,
    userId: user.id,
  };
}

export function hasRole(ctx: WorkspaceCtx, role: Role): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK[role];
}

export function requireRole(ctx: WorkspaceCtx, role: Role): boolean {
  return hasRole(ctx, role);
}

// Get the user's workspaces list.
export async function listUserWorkspaces(userId: string) {
  const memberships = await db.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    plan: m.workspace.plan,
    role: m.role,
  }));
}

// ─────────────────────────── AGENCY CONTEXT ───────────────────────────
// An Agency is a meta-account that owns multiple client workspaces.
// `resolveAgency(req)` returns the agency the user is acting on + their role.
// The active agency is selected via the `x-agency-id` header or `?agencyId=`
// query param, otherwise falls back to the user's first agency membership.

export type AgencyRole = "admin" | "manager" | "creative";

export const AGENCY_ROLE_RANK: Record<AgencyRole, number> = {
  admin: 100,
  manager: 60,
  creative: 20,
};

export type AgencyCtx = {
  agencyId: string;
  agencyName: string;
  agencySlug: string;
  mode: "pool" | "quotas";
  role: AgencyRole;
  userId: string;
};

/**
 * Get the agency context for a specific agency id, verifying the user is a
 * member. Returns null if the user is not a member.
 *
 * Two-arg overload (agencyId, userId) is supported for callers that already
 * have the user id (e.g. service functions). The legacy one-arg form
 * (agencyId) uses the session user.
 */
export async function getAgencyContext(
  agencyId: string,
  userId?: string
): Promise<AgencyCtx | null> {
  const resolvedUserId = userId ?? (await getSessionUser())?.id;
  if (!resolvedUserId) return null;
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId: resolvedUserId } },
    include: { agency: true },
  });
  if (!member) return null;
  return {
    agencyId,
    agencyName: member.agency.name,
    agencySlug: member.agency.slug,
    mode: (member.agency.mode as "pool" | "quotas") ?? "pool",
    role: (member.role as AgencyRole) ?? "creative",
    userId: resolvedUserId,
  };
}

export async function resolveAgency(req: Request): Promise<AgencyCtx | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("agencyId");
  const fromHeader = req.headers.get("x-agency-id");
  const candidate = fromQuery || fromHeader;
  if (candidate) return getAgencyContext(candidate, user.id);

  // Fall back to the user's first agency membership.
  const first = await db.agencyMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { agency: true },
  });
  if (!first) return null;
  return {
    agencyId: first.agencyId,
    agencyName: first.agency.name,
    agencySlug: first.agency.slug,
    mode: (first.agency.mode as "pool" | "quotas") ?? "pool",
    role: (first.role as AgencyRole) ?? "creative",
    userId: user.id,
  };
}

export function isAgencyAdmin(ctx: AgencyCtx): boolean {
  return ctx.role === "admin";
}

export function isAgencyManager(ctx: AgencyCtx): boolean {
  return ctx.role === "admin" || ctx.role === "manager";
}

/**
 * Check that the user's agency role meets or exceeds the required role.
 * (admin > manager > creative — see AGENCY_ROLE_RANK.)
 */
export function hasAgencyRole(ctx: AgencyCtx, role: AgencyRole): boolean {
  return AGENCY_ROLE_RANK[ctx.role] >= AGENCY_ROLE_RANK[role];
}

// Verify the user has access to a specific agency client (manager or creative assigned,
// or any admin of the agency).
export async function userHasClientAccess(
  userId: string,
  agencyClientId: string,
  agencyRole?: AgencyRole
): Promise<boolean> {
  if (agencyRole === "admin") return true;
  const client = await db.agencyClient.findUnique({
    where: { id: agencyClientId },
    select: { agencyId: true },
  });
  if (!client) return false;
  // Direct access assignment.
  const access = await db.agencyClientAccess.findUnique({
    where: { agencyClientId_userId: { agencyClientId, userId } },
  });
  if (access) return true;
  // Managers of the agency also get access.
  if (agencyRole === "manager") {
    const member = await db.agencyMember.findUnique({
      where: { agencyId_userId: { agencyId: client.agencyId, userId } },
    });
    return !!member && member.role === "manager";
  }
  return false;
}
