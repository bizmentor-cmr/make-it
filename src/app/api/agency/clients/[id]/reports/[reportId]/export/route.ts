// Make It — GET /api/agency/clients/[id]/reports/[reportId]/export
// Exports the white-label report as a printable HTML page (the MVP uses
// browser "Print to PDF" — no heavy PDF dependency). Returns Content-Type
// text/html so a new-tab click shows the report immediately.

import { NextRequest } from "next/server";
import { unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency } from "@/server/core/rbac";
import { verifyClientOwnership } from "@/server/modules/agency/clients";
import {
  getWhiteLabelReport,
  exportWhiteLabelReportHtml,
} from "@/server/modules/reports/white-label";
import { audit } from "@/server/core/audit";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; reportId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  const { id, reportId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  const report = await getWhiteLabelReport(client.workspaceId, reportId);
  if (!report) return notFound("Rapport introuvable");

  try {
    const html = exportWhiteLabelReportHtml(report);
    await audit({
      workspaceId: client.workspaceId,
      userId: user.id,
      action: "white_label_report.export",
      entity: "WhiteLabelReport",
      entityId: report.id,
      metadata: { type: report.type, format: "html-print" },
    });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return serverError("Échec de l'export du rapport", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
