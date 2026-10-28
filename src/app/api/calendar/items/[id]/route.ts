// Make It — PATCH / DELETE /api/calendar/items/[id]
// Move/reschedule an editorial item (workspace-scoped).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { rescheduleItem } from "@/server/modules/calendar/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  const { id: itemId } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Parameters<typeof rescheduleItem>[2] = {};
  if (typeof body.day === "number" && Number.isFinite(body.day)) patch.day = Math.floor(body.day);
  if (body.time !== undefined) patch.time = body.time === null ? null : asString(body.time);
  if (body.status !== undefined) patch.status = asString(body.status) ?? undefined;
  if (body.platform !== undefined) patch.platform = asString(body.platform) ?? undefined;
  if (body.format !== undefined) patch.format = asString(body.format) ?? undefined;
  if (body.title !== undefined) patch.title = asString(body.title) ?? undefined;
  if (body.goal !== undefined) patch.goal = body.goal === null ? null : asString(body.goal);
  if (body.contentId !== undefined) patch.contentId = body.contentId === null ? null : asString(body.contentId);
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) {
      patch.scheduledAt = null;
    } else if (typeof body.scheduledAt === "string") {
      const d = new Date(body.scheduledAt);
      if (!Number.isNaN(d.getTime())) patch.scheduledAt = d;
    }
  }

  try {
    const updated = await rescheduleItem(wsCtx.workspaceId, itemId, patch);
    if (!updated) return notFound("Item introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "calendar.item.update",
      entity: "EditorialItem",
      entityId: itemId,
      metadata: patch,
      ip: clientIp(req),
    });

    return ok({
      item: {
        id: updated.id,
        planId: updated.planId,
        workspaceId: updated.workspaceId,
        day: updated.day,
        platform: updated.platform,
        format: updated.format,
        title: updated.title,
        goal: updated.goal,
        status: updated.status,
        scheduledAt: updated.scheduledAt,
        time: updated.time,
        contentId: updated.contentId,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return badRequest(msg);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  const { id: itemId } = await ctx.params;

  try {
    const item = await db.editorialItem.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== wsCtx.workspaceId) return notFound("Item introuvable");

    await db.editorialItem.delete({ where: { id: itemId } });

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "calendar.item.delete",
      entity: "EditorialItem",
      entityId: itemId,
      ip: clientIp(req),
    });

    return ok({ deleted: true, itemId });
  } catch (e) {
    return serverError("Échec de la suppression de l'item", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
