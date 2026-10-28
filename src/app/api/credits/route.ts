// Make It — GET /api/credits
// Returns the workspace's CreditWallet + available balance + renewal date
// (from Subscription.currentPeriodEnd).
// Available = subscriptionCredits + purchasedCredits - reservedCredits.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { getWallet, availableBalance } from "@/server/core/credits";

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const wallet = await getWallet(ctx.workspaceId);
    const available = availableBalance(wallet);

    // Resolve subscription for renewal date + plan.
    const sub = await db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
      include: { plan: true },
    });

    const renewalDate = sub?.currentPeriodEnd ?? null;
    const renewalInDays = daysUntil(renewalDate);

    return ok(
      {
        subscriptionCredits: wallet.subscriptionCredits,
        purchasedCredits: wallet.purchasedCredits,
        reservedCredits: wallet.reservedCredits,
        totalConsumed: wallet.totalConsumed,
        available,
        renewalDate,
        renewalInDays,
        plan: sub?.plan
          ? {
              id: sub.plan.id,
              name: sub.plan.name,
              includedCredits: sub.plan.includedCredits,
              monthlyPrice: sub.plan.monthlyPrice,
            }
          : null,
      },
      { workspaceId: ctx.workspaceId }
    );
  } catch (e) {
    return serverError("Échec de lecture du portefeuille de crédits", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
