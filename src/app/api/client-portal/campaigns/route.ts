// Make It — GET /api/client-portal/campaigns
// Returns the client's campaigns (status, budget, spent, platforms, dates).
// Includes a derived cpa when conversions are available. Read-only.

import { NextRequest } from "next/server";
import { ok, unauthorized, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";
import { aggregateAnalytics } from "@/server/modules/analytics/service";

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;

    const [campaigns, analytics] = await Promise.all([
      db.campaign.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          _count: { select: { variants: true, contents: true } },
        },
      }),
      aggregateAnalytics(workspaceId, 30).catch(() => null),
    ]);

    const totalConversions = analytics?.metrics.conversions ?? 0;
    const totalSpentCents = campaigns.reduce((s, c) => s + c.spentCents, 0);
    const globalCpa = totalConversions > 0 ? totalSpentCents / totalConversions : 0;

    const items = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      budgetCents: c.budgetCents,
      spentCents: c.spentCents,
      startDate: c.startDate ? c.startDate.toISOString() : null,
      endDate: c.endDate ? c.endDate.toISOString() : null,
      platforms: jsonParse<string[]>(c.platforms, []),
      status: c.status,
      variantCount: c._count.variants,
      contentCount: c._count.contents,
      // Per-campaign CPA approximation (uniform spend assumption when detailed
      // per-campaign analytics aren't available — the MVP returns the global CPA).
      cpaCents: totalConversions > 0 ? Math.round((c.spentCents / Math.max(1, totalSpentCents)) * globalCpa) : 0,
      createdAt: c.createdAt.toISOString(),
    }));

    return ok(
      {
        items,
        summary: {
          totalCampaigns: items.length,
          activeCampaigns: items.filter((c) => c.status === "active").length,
          totalBudgetCents: campaigns.reduce((s, c) => s + c.budgetCents, 0),
          totalSpentCents,
          globalCpaCents: Math.round(globalCpa),
          conversions: totalConversions,
        },
      },
      {
        count: items.length,
        workspaceId,
        auth: "client-portal",
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des campagnes client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
