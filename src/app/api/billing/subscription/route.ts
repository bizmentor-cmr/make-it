// Make It — GET / POST /api/billing/subscription
// GET  : return the workspace's current Subscription (with plan).
// POST : upgrade/downgrade — update Workspace.plan + Subscription.planId + reset
//        subscriptionCredits to the plan's includedCredits via addCredits("allocation"),
//        bump currentPeriodEnd by +30d. owner/admin only.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { addCredits } from "@/server/core/credits";
import { jsonParse } from "@/server/core/types";
import { processConversion } from "@/server/modules/referral/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const sub = await db.subscription.findUnique({
    where: { workspaceId: ctx.workspaceId },
    include: { plan: true },
  });
  if (!sub) return notFound("Aucun abonnement actif");

  return ok(
    {
      subscription: {
        id: sub.id,
        workspaceId: sub.workspaceId,
        planId: sub.planId,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
      },
      plan: sub.plan
        ? {
            id: sub.plan.id,
            name: sub.plan.name,
            monthlyPrice: sub.plan.monthlyPrice,
            includedCredits: sub.plan.includedCredits,
            storageLimitMb: sub.plan.storageLimitMb,
            socialAccountsLimit: sub.plan.socialAccountsLimit,
            teamMembersLimit: sub.plan.teamMembersLimit,
            featureFlags: jsonParse<Record<string, unknown>>(sub.plan.featureFlags, {}),
          }
        : null,
    },
    { workspaceId: ctx.workspaceId }
  );
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "admin")) {
    return forbidden("Rôle insuffisant (admin+ requis pour modifier l'abonnement)");
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const planId = asString(body.planId);
  if (!planId) return badRequest("Champ `planId` requis");

  const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) {
    return badRequest("Plan introuvable ou inactif", { planId });
  }

  try {
    // Resolve existing subscription (if any).
    const existing = await db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
    });

    const newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (existing) {
      // Difference in included credits — top-up or reset.
      const previousPlan = await db.subscriptionPlan.findUnique({ where: { id: existing.planId } });
      const previousIncluded = previousPlan?.includedCredits ?? 0;
      const delta = plan.includedCredits - previousIncluded;

      await db.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { workspaceId: ctx.workspaceId },
          data: {
            planId: plan.id,
            currentPeriodEnd: newPeriodEnd,
            status: "active",
          },
        });
        // Update Workspace.plan too for convenience (mirrors Subscription.planId).
        await tx.workspace.update({
          where: { id: ctx.workspaceId },
          data: { plan: plan.name },
        });
      });

      if (delta !== 0) {
        // Reset subscriptionCredits to the new plan's includedCredits.
        // We do this by computing the current subscriptionCredits and adjusting
        // via addCredits("allocation", delta, ...). For upgrades delta>0 → add;
        // for downgrades delta<0 we cap to a deduction (but never negative wallet).
        if (delta > 0) {
          await addCredits(
            ctx.workspaceId,
            delta,
            "allocation",
            plan.id,
            `Ré-allocation suite au passage au plan ${plan.name} (+${delta} crédits)`
          );
        } else {
          // Downgrade: deduct the difference from subscriptionCredits (never below 0).
          const wallet = await db.creditWallet.findUnique({ where: { workspaceId: ctx.workspaceId } });
          if (wallet) {
            const toDeduct = Math.min(wallet.subscriptionCredits, Math.abs(delta));
            if (toDeduct > 0) {
              await db.creditWallet.update({
                where: { workspaceId: ctx.workspaceId },
                data: { subscriptionCredits: wallet.subscriptionCredits - toDeduct },
              });
              await db.creditTransaction.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  type: "allocation",
                  amount: -toDeduct,
                  referenceId: plan.id,
                  note: `Ré-allocation suite au passage au plan ${plan.name} (-${toDeduct} crédits)`,
                },
              });
            }
          }
        }
      }
    } else {
      // No subscription yet — create one and allocate the included credits.
      await db.$transaction(async (tx) => {
        await tx.subscription.create({
          data: {
            workspaceId: ctx.workspaceId,
            planId: plan.id,
            status: "active",
            currentPeriodEnd: newPeriodEnd,
          },
        });
        await tx.workspace.update({
          where: { id: ctx.workspaceId },
          data: { plan: plan.name },
        });
      });
      if (plan.includedCredits > 0) {
        await addCredits(
          ctx.workspaceId,
          plan.includedCredits,
          "allocation",
          plan.id,
          `Allocation initiale plan ${plan.name}`
        );
      }
    }

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "billing.subscription.update",
      entity: "Subscription",
      metadata: { planId: plan.id, planName: plan.name, periodEnd: newPeriodEnd },
      ip: clientIp(req),
    });

    // Referral conversion reward — non-blocking. If the user was referred
    // (signed_up referral where referredId = user.id), mark it converted and
    // grant 500 credits to the referrer. Any error is logged but never
    // bubbles — the subscription itself already succeeded.
    try {
      await processConversion({ userId: user.id });
    } catch (e) {
      console.error("[referral] processConversion failed", e);
    }

    const updated = await db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
      include: { plan: true },
    });

    return ok(
      {
        subscription: updated
          ? {
              id: updated.id,
              workspaceId: updated.workspaceId,
              planId: updated.planId,
              status: updated.status,
              currentPeriodEnd: updated.currentPeriodEnd,
            }
          : null,
        plan: updated?.plan
          ? {
              id: updated.plan.id,
              name: updated.plan.name,
              monthlyPrice: updated.plan.monthlyPrice,
              includedCredits: updated.plan.includedCredits,
            }
          : null,
      },
      { updated: true, workspaceId: ctx.workspaceId }
    );
  } catch (e) {
    return serverError("Échec de la mise à jour de l'abonnement", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
