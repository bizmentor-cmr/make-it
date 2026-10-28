// Make It — PATCH /api/admin/cost-rules/[id]
// Update baseCost, variableCost, enabled (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, updateCostRule } from "@/server/modules/admin/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
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
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Parameters<typeof updateCostRule>[1] = {};
  if (body.baseCost !== undefined) {
    const v = asNum(body.baseCost);
    if (v === null) return badRequest("Champ `baseCost` invalide");
    patch.baseCost = v;
  }
  if (body.variableCost !== undefined) {
    const v = asNum(body.variableCost);
    if (v === null) return badRequest("Champ `variableCost` invalide");
    patch.variableCost = v;
  }
  if (body.enabled !== undefined) {
    const v = asBool(body.enabled);
    if (v === null) return badRequest("Champ `enabled` invalide");
    patch.enabled = v;
  }
  if (body.provider !== undefined) patch.provider = asString(body.provider);
  if (body.model !== undefined) patch.model = asString(body.model);
  if (body.unit !== undefined) patch.unit = asString(body.unit);

  if (Object.keys(patch).length === 0) return badRequest("Aucun champ à mettre à jour");

  try {
    const updated = await updateCostRule(id, patch);
    if (!updated) return notFound("Règle de coût introuvable");

    await audit({
      userId: user.id,
      action: "admin.cost_rule.update",
      entity: "AICostRule",
      entityId: id,
      metadata: patch,
      ip: clientIp(req),
    });

    return ok({ costRule: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}
