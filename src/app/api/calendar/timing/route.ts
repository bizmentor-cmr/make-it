// Make It — GET /api/calendar/timing
// Smart Timing Engine — per-platform recommended publishing time.
// Computes from AnalyticsSnapshot (last 30 days) + WorkspacePlatformLearning.
// Returns {platform, recommendedTime, confidence (0-1), reason}.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { smartTiming } from "@/server/modules/calendar/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const recommendations = await smartTiming(ctx.workspaceId);
    return ok(
      { recommendations },
      {
        count: recommendations.length,
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec du calcul du Smart Timing", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
