// Make It — GET / POST /api/admin/packs
// GET  : list all CreditPack (admin only).
// POST : create a CreditPack (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, listPacksAdmin, createPack } from "@/server/modules/admin/service";

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
    const packs = await listPacksAdmin();
    return ok({ packs }, { count: packs.length });
  } catch (e) {
    return serverError("Échec de lecture des packs", {
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
  const credits = asNum(body.credits);
  if (credits === null || credits <= 0) return badRequest("Champ `credits` invalide");
  const priceCents = asNum(body.priceCents);
  if (priceCents === null || priceCents < 0) return badRequest("Champ `priceCents` invalide");

  try {
    const pack = await createPack({
      name,
      credits,
      priceCents,
      active: asBool(body.active) ?? true,
      popular: asBool(body.popular) ?? false,
    });
    await audit({
      userId: user.id,
      action: "admin.pack.create",
      entity: "CreditPack",
      entityId: pack.id,
      metadata: { name, credits, priceCents },
      ip: clientIp(req),
    });
    return ok({ pack }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la création", { error: msg });
  }
}
