// Make It — POST /api/credits/buy
// Provider-agnostic credit purchase endpoint.
// Body: { packId? | credits, amountCents, provider }
// Creates a CreditPurchase (status "paid" mock), adds credits to the wallet,
// emits `credits:update` (handled inside addCredits), returns {purchaseId, newBalance}.
//
// REAL PAYMENT PROVIDERS SLOT:
//   - card  → Stripe PaymentIntents / Stripe Checkout (capture the charge server-side
//            using a webhook; on `payment_intent.succeeded`, call addCredits).
//   - mobile_money → Wave / Orange Money / MTN MoMo / Airtel — initiate a charge,
//            poll the provider webhook, then call addCredits on success.
//   For this MVP we mock the charge as "paid" immediately. The slot for the real
//   gateway call is clearly marked below.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { addCredits, getWallet, availableBalance } from "@/server/core/credits";

const ALLOWED_PROVIDERS = new Set(["card", "mobile_money"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.floor(v);
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const provider = asString(body.provider) ?? "card";
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return badRequest("Provider invalide", { provider, allowed: Array.from(ALLOWED_PROVIDERS) });
  }

  // Resolve credits either from a packId or from an explicit `credits` integer.
  const packId = asString(body.packId);
  let credits: number | null = null;
  let amountCents: number | null = asInt(body.amountCents);
  let packName: string | null = null;

  if (packId) {
    const pack = await db.creditPack.findUnique({ where: { id: packId } });
    if (!pack || !pack.active) {
      return badRequest("Pack de crédits introuvable ou inactif", { packId });
    }
    credits = pack.credits;
    amountCents = pack.priceCents;
    packName = pack.name;
  } else {
    credits = asInt(body.credits);
  }

  if (!credits || credits <= 0) {
    return badRequest("Montant de crédits invalide", { credits });
  }
  if (!amountCents || amountCents < 0) {
    return badRequest("Montant en cents invalide", { amountCents });
  }

  try {
    // ── PAYMENT PROVIDER SLOT ───────────────────────────────────────────
    // In production, before adding credits, you would call the real provider
    // here and only proceed on confirmed payment:
    //   - card:      stripe.paymentIntents.create / confirm + webhook
    //   - mobile_money: Wave / Orange / MTN / Airtel charge + webhook
    // For this MVP, we treat the payment as confirmed immediately and
    // record the purchase as `paid`.
    // ─────────────────────────────────────────────────────────────────────

    const purchase = await db.creditPurchase.create({
      data: {
        workspaceId: ctx.workspaceId,
        packId: packId,
        credits,
        amountCents,
        provider,
        status: "paid",
      },
    });

    await addCredits(
      ctx.workspaceId,
      credits,
      "purchase",
      purchase.id,
      `Achat ${credits} crédits (${provider})${packName ? ` — ${packName}` : ""}`
    );

    const wallet = await getWallet(ctx.workspaceId);
    const newBalance = availableBalance(wallet);

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "credits.buy",
      entity: "CreditPurchase",
      entityId: purchase.id,
      metadata: { credits, amountCents, provider, packId, newBalance },
      ip: clientIp(req),
    });

    return ok(
      {
        purchaseId: purchase.id,
        credits,
        amountCents,
        provider,
        status: purchase.status,
        newBalance,
      },
      { purchased: true },
      { status: 201 }
    );
  } catch (e) {
    return serverError("Échec de l'achat de crédits", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
