// Make It — GET /api/insights/score
// Make It Growth Score — compute 8 subscores (Reach/Engagement/Growth/Content/
// Visibility/Conversion/Brand/Consistency) deterministically from AnalyticsSnapshot,
// then weighted `makeItScore`. Returns { total, delta, subscores:[{key, label, value, delta, note}] }.
// Powers the home dashboard ScoreRing.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { computeScores } from "@/server/modules/insights/performance";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const scores = await computeScores(ctx.workspaceId);
    return ok(
      {
        total: scores.total,
        delta: scores.delta,
        subscores: scores.subscores,
      },
      {
        workspaceId: ctx.workspaceId,
        deterministic: true,
      }
    );
  } catch (e) {
    return serverError("Échec du calcul du Make It Score", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
