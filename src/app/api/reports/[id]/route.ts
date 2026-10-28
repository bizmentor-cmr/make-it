// Make It — GET /api/reports/[id]
// Get one report (parsed JSON summary).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { getReport } from "@/server/modules/reports/service";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  const report = await getReport(wsCtx.workspaceId, id);
  if (!report) return notFound("Rapport introuvable");

  return ok({ report });
}
