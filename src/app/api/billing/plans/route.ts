// Make It — GET /api/billing/plans
// List all active SubscriptionPlans. Public-ish read (any member).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { jsonParse } from "@/server/core/types";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const plans = await db.subscriptionPlan.findMany({
      where: { active: true },
      orderBy: { monthlyPrice: "asc" },
    });

    return ok(
      {
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          monthlyPrice: p.monthlyPrice,
          includedCredits: p.includedCredits,
          storageLimitMb: p.storageLimitMb,
          socialAccountsLimit: p.socialAccountsLimit,
          teamMembersLimit: p.teamMembersLimit,
          featureFlags: jsonParse<Record<string, unknown>>(p.featureFlags, {}),
          active: p.active,
        })),
      },
      { count: plans.length, workspaceId: ctx.workspaceId }
    );
  } catch (e) {
    return serverError("Échec de lecture des plans", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
