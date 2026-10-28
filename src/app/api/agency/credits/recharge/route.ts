// Make It — POST /api/agency/credits/recharge
// Admin-only: adds credits to the agency wallet.
// Body: { amountCents, credits, provider? }.

import { NextRequest } from "next/server";
import {
  ok,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { resolveAgency, isAgencyAdmin } from "@/server/core/rbac";
import { rechargeAgency } from "@/server/modules/agency/credits";

export async function POST(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!isAgencyAdmin(ctx)) return forbidden("Rôle admin requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const amountCents = typeof body.amountCents === "number" ? body.amountCents : null;
  const credits = typeof body.credits === "number" ? body.credits : null;
  if (amountCents === null || amountCents < 0) {
    return badRequest("`amountCents` (entier ≥ 0) requis");
  }
  if (credits === null || credits <= 0 || !Number.isFinite(credits)) {
    return badRequest("`credits` (entier > 0) requis");
  }
  // `provider` is informational only (we don't process payments here).
  const provider = typeof body.provider === "string" ? body.provider : null;

  try {
    const wallet = await rechargeAgency(
      ctx.agencyId,
      ctx.userId,
      Math.floor(amountCents),
      Math.floor(credits)
    );
    return ok(wallet, { agencyId: ctx.agencyId, provider }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la recharge", { error: msg });
  }
}
