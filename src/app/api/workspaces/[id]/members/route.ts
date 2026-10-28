// Make It — GET/POST /api/workspaces/[id]/members
// GET  : list members (and pending invitations).
// POST : invite a member by email (creates Invitation with token, role).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { getWorkspaceContext, hasRole } from "@/server/core/rbac";
import { ROLES, type Role } from "@/server/core/types";
import { inviteMember } from "@/server/modules/workspaces/service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;
  const wctx = await getWorkspaceContext(workspaceId);
  if (!wctx || wctx.userId !== user.id) return forbidden("Workspace inaccessible");

  const [members, invitations] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { workspaceId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return ok({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt,
    })),
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    })),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;
  const wctx = await getWorkspaceContext(workspaceId);
  if (!wctx || wctx.userId !== user.id) return forbidden("Workspace inaccessible");
  if (!hasRole(wctx, "admin")) return forbidden("Rôle insuffisant");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  if (!EMAIL_RE.test(email)) return badRequest("Email invalide", { email });
  const role: Role = isRole(body.role) ? body.role : "viewer";
  if (role === "owner") return badRequest("Le rôle owner ne peut être invité");

  try {
    const { invitation } = await inviteMember({
      workspaceId,
      invitedBy: user.id,
      email,
      role,
    });
    // Return the updated invitation list.
    const invitations = await db.invitation.findMany({
      where: { workspaceId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      {
        invitation,
        invitations: invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        })),
      },
      { invited: true }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ALREADY_MEMBER") {
      return badRequest("Cet utilisateur est déjà membre du workspace", { email });
    }
    return serverError("Impossible d'inviter ce membre", { error: msg });
  }
}
