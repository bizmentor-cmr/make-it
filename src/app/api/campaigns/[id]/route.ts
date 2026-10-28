// Make It — GET / PATCH / DELETE /api/campaigns/[id]
// GET    : one campaign (with variantCount + contentCount).
// PATCH  : update name, objective, budgetCents, startDate, endDate, audience,
//          platforms, status. manager+.
// DELETE : archive (soft delete — set status to "archived"). manager+.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getCampaign, updateCampaign, archiveCampaign } from "@/server/modules/campaigns/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  const campaign = await getCampaign(wsCtx.workspaceId, id);
  if (!campaign) return notFound("Campagne introuvable");

  return ok({ campaign });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Parameters<typeof updateCampaign>[2] = {};
  if (body.name !== undefined) {
    const v = asString(body.name);
    if (!v) return badRequest("Champ `name` invalide");
    patch.name = v;
  }
  if (body.objective !== undefined) patch.objective = asString(body.objective) ?? undefined;
  if (body.budgetCents !== undefined) {
    if (typeof body.budgetCents !== "number" || !Number.isFinite(body.budgetCents) || body.budgetCents < 0) {
      return badRequest("Champ `budgetCents` invalide");
    }
    patch.budgetCents = Math.floor(body.budgetCents);
  }
  if (body.startDate !== undefined) {
    patch.startDate = body.startDate === null ? null : typeof body.startDate === "string" ? new Date(body.startDate) : null;
  }
  if (body.endDate !== undefined) {
    patch.endDate = body.endDate === null ? null : typeof body.endDate === "string" ? new Date(body.endDate) : null;
  }
  if (body.platforms !== undefined) {
    patch.platforms = Array.isArray(body.platforms)
      ? (body.platforms as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
  }
  if (body.audience !== undefined) {
    patch.audience = body.audience === null ? null : (body.audience as Record<string, unknown>);
  }
  if (body.status !== undefined) patch.status = asString(body.status) ?? undefined;

  try {
    const updated = await updateCampaign(wsCtx.workspaceId, id, patch);
    if (!updated) return notFound("Campagne introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "campaign.update",
      entity: "Campaign",
      entityId: id,
      metadata: patch,
      ip: clientIp(req),
    });

    return ok({ campaign: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
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
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id } = await ctx.params;

  try {
    const archived = await archiveCampaign(wsCtx.workspaceId, id);
    if (!archived) return notFound("Campagne introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "campaign.archive",
      entity: "Campaign",
      entityId: id,
      ip: clientIp(req),
    });

    return ok({ archived: true, campaignId: id, status: "archived" });
  } catch (e) {
    return serverError("Échec de l'archivage", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
