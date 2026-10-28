// Make It — GET /api/reports
// List reports (filterable by type, refId).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { listReports } from "@/server/modules/reports/service";

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

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
  const type = asString(url.searchParams.get("type"));
  const refId = asString(url.searchParams.get("refId"));
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 100);

  try {
    const reports = await listReports(ctx.workspaceId, { type, refId, limit });
    return ok({ reports }, { count: reports.length, workspaceId: ctx.workspaceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de lecture des rapports", { error: msg });
  }
}
