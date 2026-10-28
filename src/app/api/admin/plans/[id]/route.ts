// Make It — PATCH /api/admin/plans/[id]
// Update a SubscriptionPlan (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, updatePlan } from "@/server/modules/admin/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function asObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
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

  const patch: Parameters<typeof updatePlan>[1] = {};
  if (body.name !== undefined) {
    const v = asString(body.name);
    if (!v) return badRequest("Champ `name` invalide");
    patch.name = v;
  }
  if (body.monthlyPrice !== undefined) {
    const v = asNum(body.monthlyPrice);
    if (v === null || v < 0) return badRequest("Champ `monthlyPrice` invalide");
    patch.monthlyPrice = v;
  }
  if (body.includedCredits !== undefined) {
    const v = asNum(body.includedCredits);
    if (v === null || v < 0) return badRequest("Champ `includedCredits` invalide");
    patch.includedCredits = v;
  }
  if (body.storageLimitMb !== undefined) {
    const v = asNum(body.storageLimitMb);
    if (v === null || v < 0) return badRequest("Champ `storageLimitMb` invalide");
    patch.storageLimitMb = v;
  }
  if (body.socialAccountsLimit !== undefined) {
    const v = asNum(body.socialAccountsLimit);
    if (v === null || v < 0) return badRequest("Champ `socialAccountsLimit` invalide");
    patch.socialAccountsLimit = v;
  }
  if (body.teamMembersLimit !== undefined) {
    const v = asNum(body.teamMembersLimit);
    if (v === null || v < 0) return badRequest("Champ `teamMembersLimit` invalide");
    patch.teamMembersLimit = v;
  }
  if (body.featureFlags !== undefined) patch.featureFlags = asObject(body.featureFlags);
  if (body.active !== undefined) {
    const v = asBool(body.active);
    if (v === null) return badRequest("Champ `active` invalide");
    patch.active = v;
  }

  if (Object.keys(patch).length === 0) return badRequest("Aucun champ à mettre à jour");

  try {
    const updated = await updatePlan(id, patch);
    if (!updated) return notFound("Plan introuvable");

    await audit({
      userId: user.id,
      action: "admin.plan.update",
      entity: "SubscriptionPlan",
      entityId: id,
      metadata: patch,
      ip: clientIp(req),
    });

    return ok({ plan: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}
