// Make It — GET /api/calendar
// Returns the workspace's editorial plans + items, grouped by plan.
// Optional ?horizon=30|60|90 filter.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";

const ALLOWED_HORIZONS = new Set([30, 60, 90]);

function parseHorizon(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const horizon = parseHorizon(url.searchParams.get("horizon"));
  if (horizon !== undefined && !ALLOWED_HORIZONS.has(horizon)) {
    return badRequest("Horizon invalide (30|60|90)", { horizon });
  }

  try {
    const where: { workspaceId: string; horizon?: number } = { workspaceId: ctx.workspaceId };
    if (horizon !== undefined) where.horizon = horizon;

    const plans = await db.editorialPlan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          orderBy: { day: "asc" },
        },
      },
    });

    return ok(
      {
        plans: plans.map((p) => ({
          id: p.id,
          workspaceId: p.workspaceId,
          name: p.name,
          horizon: p.horizon,
          startDate: p.startDate,
          endDate: p.endDate,
          objective: p.objective,
          createdAt: p.createdAt,
          items: p.items.map((it) => ({
            id: it.id,
            planId: it.planId,
            workspaceId: it.workspaceId,
            day: it.day,
            platform: it.platform,
            format: it.format,
            title: it.title,
            goal: it.goal,
            status: it.status,
            scheduledAt: it.scheduledAt,
            time: it.time,
            contentId: it.contentId,
            createdAt: it.createdAt,
          })),
        })),
      },
      {
        count: plans.length,
        itemCount: plans.reduce((acc, p) => acc + p.items.length, 0),
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture du calendrier", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
