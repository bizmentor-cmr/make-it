// Make It — PATCH / DELETE /api/campaigns/[id]/variants/[vid]
// PATCH  : update variant fields (creative, copy, audience, performance, status).
// DELETE : delete the variant.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { updateVariant, deleteVariant } from "@/server/modules/campaigns/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; vid: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id, vid } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Parameters<typeof updateVariant>[3] = {};
  if (body.creative !== undefined) {
    patch.creative = body.creative === null ? null : (body.creative as Record<string, unknown>);
  }
  if (body.copy !== undefined) patch.copy = body.copy === null ? null : typeof body.copy === "string" ? body.copy : null;
  if (body.audience !== undefined) patch.audience = body.audience === null ? null : asString(body.audience as string);
  if (body.performance !== undefined) {
    patch.performance = body.performance === null ? null : (body.performance as Record<string, unknown>);
  }
  if (body.status !== undefined) patch.status = asString(body.status) ?? undefined;

  try {
    const updated = await updateVariant(wsCtx.workspaceId, id, vid, patch);
    if (!updated) return notFound("Variante ou campagne introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "campaign.variant.update",
      entity: "CampaignVariant",
      entityId: vid,
      metadata: { campaignId: id, patch },
      ip: clientIp(req),
    });

    return ok({ variant: updated });
  } catch (e) {
    return serverError("Échec de la mise à jour de la variante", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; vid: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id, vid } = await ctx.params;

  try {
    const deleted = await deleteVariant(wsCtx.workspaceId, id, vid);
    if (!deleted) return notFound("Variante ou campagne introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "campaign.variant.delete",
      entity: "CampaignVariant",
      entityId: vid,
      metadata: { campaignId: id },
      ip: clientIp(req),
    });

    return ok({ deleted: true, variantId: vid });
  } catch (e) {
    return serverError("Échec de la suppression de la variante", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
