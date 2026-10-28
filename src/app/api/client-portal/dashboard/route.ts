// Make It — GET /api/client-portal/dashboard
// Returns the client's dashboard summary: Make It Score + upcoming content count +
// recent performances + pending validations count.

import { NextRequest } from "next/server";
import { ok, unauthorized, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { computeScores } from "@/server/modules/insights/performance";
import { aggregateAnalytics } from "@/server/modules/analytics/service";
import { listPendingValidations } from "@/server/modules/validation/service";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;

    const [score, analytics, pendingClient, upcomingContent, recentPublications] = await Promise.all([
      computeScores(workspaceId).catch(() => ({ total: 0, delta: 0, subscores: [] })),
      aggregateAnalytics(workspaceId, 30).catch(() => null),
      listPendingValidations(workspaceId, "pending_client").catch(() => []),
      db.content.count({
        where: {
          workspaceId,
          status: { in: ["scheduled", "ready"] },
        },
      }),
      db.publication.findMany({
        where: {
          workspaceId,
          status: "published",
          publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: {
          id: true,
          publishedAt: true,
          status: true,
          externalPermalink: true,
          content: { select: { id: true, title: true, type: true } },
          socialAccount: { select: { platform: true, accountName: true } },
        },
      }),
    ]);

    const upcomingCount = upcomingContent;
    const pendingValidationsCount = pendingClient.length;

    return ok(
      {
        makeItScore: {
          total: score.total,
          delta: score.delta,
          subscores: score.subscores,
        },
        upcomingContentCount: upcomingCount,
        pendingValidationsCount,
        recentPerformances: recentPublications.map((p) => ({
          id: p.id,
          publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
          status: p.status,
          platform: p.socialAccount?.platform ?? null,
          accountName: p.socialAccount?.accountName ?? null,
          permalink: p.externalPermalink,
          content: p.content
            ? { id: p.content.id, title: p.content.title, type: p.content.type }
            : null,
        })),
        metrics: analytics?.metrics ?? null,
        byPlatform: analytics?.byPlatform ?? [],
      },
      { workspaceId, auth: "client-portal" }
    );
  } catch (e) {
    return serverError("Échec de lecture du tableau de bord client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
