// Make It — GET /api/insights
// Compute DETERMINISTIC insights from AnalyticsSnapshot (NO LLM).
// Returns an array of insights sorted by priorityScore desc, each with:
// { id, category, severity, evidence, explanation, recommendation, expectedImpact,
//   impactScore, effortScore, urgencyScore, confidence, priorityScore }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { rankInsights } from "@/server/modules/insights/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const insights = await rankInsights(ctx.workspaceId);
    return ok(
      { insights },
      {
        count: insights.length,
        workspaceId: ctx.workspaceId,
        deterministic: true,
      }
    );
  } catch (e) {
    return serverError("Échec du calcul des insights", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
