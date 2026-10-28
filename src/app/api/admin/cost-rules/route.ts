// Make It — GET / POST /api/admin/cost-rules
// GET  : list AICostRule (admin only).
// POST : create AICostRule (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, listCostRules, createCostRule } from "@/server/modules/admin/service";

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

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");

  try {
    const rules = await listCostRules();
    return ok({ costRules: rules }, { count: rules.length });
  } catch (e) {
    return serverError("Échec de lecture des règles de coût", {
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

  const operation = asString(body.operation);
  if (!operation) return badRequest("Champ `operation` requis");

  try {
    const rule = await createCostRule({
      operation,
      provider: asString(body.provider),
      model: asString(body.model),
      baseCost: asNum(body.baseCost) ?? 0,
      variableCost: asNum(body.variableCost) ?? 0,
      unit: asString(body.unit),
      enabled: asBool(body.enabled) ?? true,
    });

    await audit({
      userId: user.id,
      action: "admin.cost_rule.create",
      entity: "AICostRule",
      entityId: rule.id,
      metadata: { operation, baseCost: rule.baseCost, variableCost: rule.variableCost },
      ip: clientIp(req),
    });

    return ok({ costRule: rule }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la création", { error: msg });
  }
}
