// Make It — GET / POST /api/admin/plans
// GET  : list all SubscriptionPlans (admin only).
// POST : create a SubscriptionPlan (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, listPlansAdmin, createPlan } from "@/server/modules/admin/service";

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

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");

  try {
    const plans = await listPlansAdmin();
    return ok({ plans }, { count: plans.length });
  } catch (e) {
    return serverError("Échec de lecture des plans", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = asString(body.name);
  if (!name) return badRequest("Champ `name` requis");
  const monthlyPrice = asNum(body.monthlyPrice);
  if (monthlyPrice === null || monthlyPrice < 0) return badRequest("Champ `monthlyPrice` invalide");
  const includedCredits = asNum(body.includedCredits);
  if (includedCredits === null || includedCredits < 0) return badRequest("Champ `includedCredits` invalide");

  try {
    const plan = await createPlan({
      name,
      monthlyPrice,
      includedCredits,
      storageLimitMb: asNum(body.storageLimitMb) ?? 500,
      socialAccountsLimit: asNum(body.socialAccountsLimit) ?? 2,
      teamMembersLimit: asNum(body.teamMembersLimit) ?? 1,
      featureFlags: asObject(body.featureFlags),
      active: asBool(body.active) ?? true,
    });
    await audit({
      userId: user.id,
      action: "admin.plan.create",
      entity: "SubscriptionPlan",
      entityId: plan.id,
      metadata: { name, monthlyPrice, includedCredits },
      ip: clientIp(req),
    });
    return ok({ plan }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la création", { error: msg });
  }
}
