// Make It — PATCH / DELETE /api/notifications/[id]
// PATCH : mark read/unread. Body: { read: boolean }.
// DELETE: delete a notification.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { setRead, deleteNotification } from "@/server/modules/notifications/service";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  if (typeof body.read !== "boolean") {
    return badRequest("Champ `read` (booléen) requis");
  }

  try {
    const updated = await setRead(wsCtx.workspaceId, id, body.read);
    if (!updated) return notFound("Notification introuvable");
    return ok({ notification: updated });
  } catch (e) {
    return serverError("Échec de la mise à jour", {
      error: e instanceof Error ? e.message : String(e),
    });
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
  const { id } = await ctx.params;

  try {
    const deleted = await deleteNotification(wsCtx.workspaceId, id);
    if (!deleted) return notFound("Notification introuvable");
    return ok({ deleted: true, id });
  } catch (e) {
    return serverError("Échec de la suppression", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
