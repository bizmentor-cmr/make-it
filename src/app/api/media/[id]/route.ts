// Make It — GET / DELETE /api/media/[id]
// Get media metadata; DELETE (creator+).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getMedia, deleteMedia } from "@/server/modules/media/service";

type CtxParams = { params: Promise<{ id: string }> };

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { id } = await params;
  const asset = await getMedia(ctx.workspaceId, id);
  if (!asset) return notFound("Média introuvable");
  return ok(asset, { workspaceId: ctx.workspaceId });
}

export async function DELETE(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;
  const ok_del = await deleteMedia(ctx.workspaceId, id);
  if (!ok_del) return notFound("Média introuvable");
  await audit({
    workspaceId: ctx.workspaceId,
    userId: user.id,
    action: "media.delete",
    entity: "MediaAsset",
    entityId: id,
    ip: clientIp(req),
  });
  return ok({ deleted: true }, { id });
}
