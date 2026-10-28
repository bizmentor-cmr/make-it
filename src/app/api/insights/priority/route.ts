// Make It — GET /api/insights/priority
// Ranked top recommendations (sorted by priorityScore desc).
// Returns { items: [{ title, reason, cta, impact, effort, priorityScore }] }.
// Powers the Strategy page + home "priorité de la semaine".

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { rankInsights } from "@/server/modules/insights/service";

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 5, 20);

  try {
    const insights = await rankInsights(ctx.workspaceId);
    const items = insights.slice(0, limit).map((i) => ({
      title: i.recommendation ?? "Action recommandée",
      reason: i.explanation ?? i.evidence ?? "Recommandation data-driven.",
      cta: i.recommendation ?? null,
      impact: i.impactScore ?? 0,
      effort: i.effortScore ?? 0,
      urgency: i.urgencyScore ?? 0,
      confidence: i.confidence ?? 0,
      priorityScore: i.priorityScore ?? 0,
      category: i.category,
      severity: i.severity,
      source: i.source,
      expectedImpact: i.expectedImpact ?? null,
    }));
    return ok(
      { items },
      {
        count: items.length,
        totalAvailable: insights.length,
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec du calcul des priorités", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
