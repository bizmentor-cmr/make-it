// Make It — Reports domain service.
// Lists reports persisted by the AI `report` runner.
// The runner body lives in `@/server/modules/ai/runners.ts` (owned by agent B6);
// we additionally re-register a wrapper here that emits a `report_available`
// notification on completion (see `./runner.ts`).

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

export type ReportType = "weekly" | "monthly" | "campaign";

export type ReportRow = {
  id: string;
  workspaceId: string;
  type: string;
  refId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  summary: Record<string, unknown> | null;
  body: string | null;
  createdAt: Date;
};

function toRow(r: {
  id: string;
  workspaceId: string;
  type: string;
  refId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  summary: string | null;
  body: string | null;
  createdAt: Date;
}): ReportRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    type: r.type,
    refId: r.refId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    summary: r.summary ? jsonParse<Record<string, unknown>>(r.summary, {}) : null,
    body: r.body,
    createdAt: r.createdAt,
  };
}

const ALLOWED_TYPES = new Set<string>(["weekly", "monthly", "campaign"]);

export async function listReports(
  workspaceId: string,
  opts: { type?: string | null; refId?: string | null; limit?: number } = {}
): Promise<ReportRow[]> {
  const where: { workspaceId: string; type?: string; refId?: string } = { workspaceId };
  if (opts.type && opts.type.length > 0) {
    if (!ALLOWED_TYPES.has(opts.type)) throw new Error("Type de rapport invalide");
    where.type = opts.type;
  }
  if (opts.refId && opts.refId.length > 0) where.refId = opts.refId;
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)));
  const rows = await db.report.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}

export async function getReport(workspaceId: string, id: string): Promise<ReportRow | null> {
  const r = await db.report.findUnique({ where: { id } });
  if (!r || r.workspaceId !== workspaceId) return null;
  return toRow(r);
}

export { ALLOWED_TYPES };
