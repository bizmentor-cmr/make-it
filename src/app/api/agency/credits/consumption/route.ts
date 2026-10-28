// Make It — GET /api/agency/credits/consumption
// Returns a breakdown of agency credit consumption over a period (default 30d).

import { NextRequest } from "next/server";
import { ok, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { resolveAgency } from "@/server/core/rbac";
import { getConsumptionBreakdown } from "@/server/modules/agency/credits";

export async function GET(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("sinceDays");
  let sinceDays = 30;
  if (sinceParam) {
    const n = Number.parseInt(sinceParam, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 365) {
      return badRequest("`sinceDays` doit être un entier 1..365");
    }
    sinceDays = n;
  }

  try {
    const breakdown = await getConsumptionBreakdown(ctx.agencyId, sinceDays);
    return ok(breakdown, { agencyId: ctx.agencyId, sinceDays });
  } catch (e) {
    return serverError("Échec de lecture de la consommation", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
