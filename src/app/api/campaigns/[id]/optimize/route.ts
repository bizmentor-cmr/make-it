// Make It — GET /api/campaigns/[id]/optimize
// Campaign optimization — compute CTR/CPC/CPM/cost-per-result/frequency/conversion
// from AnalyticsSnapshot (mock: derive from campaign spent or stored performance
// JSON). Classify each variant WINNER / STABLE / UNDERPERFORMING.
// Sensitive actions (budget change >20%, auto-pause) flagged with requiresConfirmation.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { optimizeCampaign } from "@/server/modules/campaigns/service";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  try {
    const result = await optimizeCampaign(wsCtx.workspaceId, id);
    if (!result) return notFound("Campagne introuvable");

    return ok(
      result,
      {
        campaignId: id,
        totalSensitiveActions: result.sensitiveActions.length,
        workspaceId: wsCtx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec de l'optimisation de la campagne", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
