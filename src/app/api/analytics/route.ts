// Make It — GET /api/analytics
// Aggregated unified analytics for the active workspace over a date range.
// Query params:
//   ?range=7|30|90   — last N days (default 30). Clamped to [1, 365].
//   ?platform=       — filter to a single platform (instagram, tiktok, ...).
//                      Omit / empty → all platforms (still includes byPlatform breakdown).
// Any workspace member can read analytics.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { aggregateAnalytics } from "@/server/modules/analytics/service";
import { PLATFORMS } from "@/server/core/types";

const PLATFORM_SET = new Set<string>(PLATFORMS);
const ALLOWED_RANGES = new Set([7, 30, 90]);

function parseRange(v: string | null): number {
  if (!v) return 30;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return n;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const days = parseRange(url.searchParams.get("range"));
  const platformParam = url.searchParams.get("platform");

  let platform: string | null | undefined = undefined; // undefined = no filter
  if (platformParam !== null) {
    const trimmed = platformParam.trim().toLowerCase();
    if (trimmed.length === 0) {
      platform = undefined;
    } else if (!PLATFORM_SET.has(trimmed)) {
      return badRequest("Plateforme invalide", { platform: trimmed });
    } else {
      platform = trimmed;
    }
  }

  const aggregated = await aggregateAnalytics(ctx.workspaceId, days, platform);

  return ok(
    aggregated,
    {
      workspaceId: ctx.workspaceId,
      range: days,
      requestedRange: ALLOWED_RANGES.has(days) ? days : "custom",
      platform: platform ?? null,
    }
  );
}
