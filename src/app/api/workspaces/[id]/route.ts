// Make It — GET/PATCH/DELETE /api/workspaces/[id]
// GET    : any member of the workspace.
// PATCH  : owner/admin only — update name/plan.
// DELETE : owner only — cascade delete.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { getWorkspaceContext, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { PLANS, type Plan } from "@/server/core/types";
import { getWorkspaceSummary } from "@/server/modules/workspaces/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
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

  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      members: { include: { user: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!ws) return notFound("Workspace introuvable");

  const summary = await getWorkspaceSummary(workspaceId);

  return ok({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    plan: ws.plan,
    role: wctx.role,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    members: ws.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt,
    })),
    summary,
  });
}

export async function PATCH(
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

  const data: { name?: string; plan?: string } = {};
  if (typeof body.name === "string" && body.name.trim().length >= 2) {
    data.name = body.name.trim();
  }
  if (body.plan !== undefined) {
    if (!isPlan(body.plan)) return badRequest("Plan invalide", { plan: body.plan });
    data.plan = body.plan;
  }
  if (Object.keys(data).length === 0) return badRequest("Aucune modification valide");

  const before = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!before) return notFound("Workspace introuvable");

  const updated = await db.workspace.update({
    where: { id: workspaceId },
    data,
  });

  await audit({
    workspaceId,
    userId: user.id,
    action: "workspace.update",
    entity: "Workspace",
    entityId: workspaceId,
    metadata: { before: { name: before.name, plan: before.plan }, after: data },
    ip: clientIp(req),
  });

  return ok({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    plan: updated.plan,
    updatedAt: updated.updatedAt,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;
  const wctx = await getWorkspaceContext(workspaceId);
  if (!wctx || wctx.userId !== user.id) return forbidden("Workspace inaccessible");
  if (!hasRole(wctx, "owner")) return forbidden("Seul le propriétaire peut supprimer le workspace");

  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) return notFound("Workspace introuvable");

  // Reassign owner to the workspace.ownerId just to be safe — only owner can delete.
  try {
    await db.workspace.delete({ where: { id: workspaceId } });
  } catch (e) {
    return serverError("Impossible de supprimer le workspace", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await audit({
    userId: user.id,
    action: "workspace.delete",
    entity: "Workspace",
    entityId: workspaceId,
    metadata: { name: ws.name, slug: ws.slug, plan: ws.plan },
    ip: clientIp(req),
  });

  return ok({ deleted: true, workspaceId });
}
