// Make It — Change member role / remove member (owner/admin only).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { getWorkspaceContext, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { ROLES, type Role } from "@/server/core/types";
import { removeMember } from "@/server/modules/workspaces/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

// PATCH /api/workspaces/[id]/members/[memberId] — change role (owner/admin only).
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id: workspaceId, memberId } = await ctx.params;
  const wctx = await getWorkspaceContext(workspaceId);
  if (!wctx || wctx.userId !== user.id) return forbidden("Workspace inaccessible");
  if (!hasRole(wctx, "admin")) return forbidden("Rôle insuffisant");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  const role = body?.role;
  if (!isRole(role)) return badRequest("Rôle invalide", { role });

  const member = await db.workspaceMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  });
  if (!member || member.workspaceId !== workspaceId) return notFound("Membre introuvable");

  if (member.role === "owner") {
    return badRequest("Le rôle du propriétaire ne peut être modifié");
  }
  if (role === "owner") {
    return badRequest("Le rôle owner ne peut être assigné via cette route");
  }

  const updated = await db.workspaceMember.update({
    where: { id: memberId },
    data: { role },
  });

  await audit({
    workspaceId,
    userId: user.id,
    action: "member.role.change",
    entity: "WorkspaceMember",
    entityId: memberId,
    metadata: { from: member.role, to: role, targetEmail: member.user.email },
    ip: clientIp(req),
  });

  return ok({
    id: updated.id,
    workspaceId: updated.workspaceId,
    userId: updated.userId,
    role: updated.role,
  });
}

// DELETE /api/workspaces/[id]/members/[memberId] — remove member (owner/admin, not self).
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id: workspaceId, memberId } = await ctx.params;
  const wctx = await getWorkspaceContext(workspaceId);
  if (!wctx || wctx.userId !== user.id) return forbidden("Workspace inaccessible");
  if (!hasRole(wctx, "admin")) return forbidden("Rôle insuffisant");

  const member = await db.workspaceMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  });
  if (!member || member.workspaceId !== workspaceId) return notFound("Membre introuvable");

  if (member.userId === user.id) {
    return badRequest("Impossible de vous retirer vous-même");
  }
  if (member.role === "owner") {
    return badRequest("Le propriétaire ne peut être retiré");
  }

  const removed = await removeMember(workspaceId, memberId);
  if (!removed) return notFound("Membre introuvable");

  await audit({
    workspaceId,
    userId: user.id,
    action: "member.remove",
    entity: "WorkspaceMember",
    entityId: memberId,
    metadata: { targetEmail: member.user.email, targetRole: member.role },
    ip: clientIp(req),
  });

  return ok({ removed: true, memberId });
}
