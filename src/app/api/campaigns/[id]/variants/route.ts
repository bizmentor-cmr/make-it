// Make It — GET / POST /api/campaigns/[id]/variants
// GET  : list variants for a campaign.
// POST : create a new variant (manager+).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { listVariants, createVariant } from "@/server/modules/campaigns/service";

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

  const variants = await listVariants(wsCtx.workspaceId, id);
  if (variants === null) return notFound("Campagne introuvable");

  return ok({ variants }, { count: variants.length });
}

export async function POST(
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

  const copy = body.copy !== undefined && body.copy !== null ? (typeof body.copy === "string" ? body.copy : null) : null;
  const audience = body.audience !== undefined && body.audience !== null ? asString(body.audience as string) : null;
  const status = asString(body.status) ?? "active";
  const creative =
    body.creative !== undefined && body.creative !== null
      ? (body.creative as Record<string, unknown>)
      : null;
  const performance =
    body.performance !== undefined && body.performance !== null
      ? (body.performance as Record<string, unknown>)
      : null;

  try {
    const variant = await createVariant(wsCtx.workspaceId, id, {
      creative,
      copy,
      audience,
      performance,
      status,
    });
    if (!variant) return notFound("Campagne introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "campaign.variant.create",
      entity: "CampaignVariant",
      entityId: variant.id,
      metadata: { campaignId: id, status },
      ip: clientIp(req),
    });

    return ok({ variant }, { created: true }, { status: 201 });
  } catch (e) {
    return serverError("Échec de la création de la variante", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
