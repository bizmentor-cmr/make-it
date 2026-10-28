// Make It — GET /api/client-portal/performance
// Returns the client's analytics (last 30 days, by platform) + daily series +
// top content. Read-only — the portal renders a simplified dashboard.

import { NextRequest } from "next/server";
import { ok, unauthorized, badRequest, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { aggregateAnalytics } from "@/server/modules/analytics/service";

const ALLOWED_RANGES = new Set([7, 30, 90]);

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range");
    const range = rangeParam ? Number.parseInt(rangeParam, 10) : 30;
    if (!Number.isFinite(range) || range <= 0 || range > 365) {
      return badRequest("Range invalide (1-365 jours)");
    }

    const aggregated = await aggregateAnalytics(workspaceId, range);

    return ok(
      aggregated,
      {
        workspaceId,
        range,
        requestedRange: ALLOWED_RANGES.has(range) ? range : "custom",
        auth: "client-portal",
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des performances client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
