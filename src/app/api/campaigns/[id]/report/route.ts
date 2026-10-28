// Make It — GET /api/campaigns/[id]/report
// Returns the cached Report for this campaign (type="campaign", refId=campaignId),
// or 404 if none. Generation is performed via POST /api/reports/generate
// (owned by agent B8).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { jsonParse } from "@/server/core/types";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  // Verify the campaign belongs to the workspace.
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign || campaign.workspaceId !== wsCtx.workspaceId) {
    return notFound("Campagne introuvable");
  }

  try {
    const report = await db.report.findFirst({
      where: { workspaceId: wsCtx.workspaceId, type: "campaign", refId: id },
      orderBy: { createdAt: "desc" },
    });

    if (!report) {
      return notFound("Aucun rapport généré pour cette campagne");
    }

    return ok(
      {
        id: report.id,
        workspaceId: report.workspaceId,
        type: report.type,
        refId: report.refId,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        summary: jsonParse<Record<string, unknown> | null>(report.summary, null),
        body: report.body,
        createdAt: report.createdAt,
      },
      { campaignId: id }
    );
  } catch (e) {
    return serverError("Échec de lecture du rapport", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
