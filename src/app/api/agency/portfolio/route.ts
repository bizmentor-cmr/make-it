// Make It — GET /api/agency/portfolio
// Returns the agency portfolio (clients + summary). Admin sees all clients;
// managers see all (managers can supervise); creatives see only assigned.

import { NextRequest } from "next/server";
import { ok, forbidden, serverError } from "@/server/core/api-response";
import { resolveAgency } from "@/server/core/rbac";
import { getPortfolio } from "@/server/modules/agency/portfolio";

export async function GET(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  try {
    const portfolio = await getPortfolio(ctx.agencyId, ctx.userId, ctx.role);
    return ok(portfolio, {
      agencyId: ctx.agencyId,
      role: ctx.role,
      mode: ctx.mode,
    });
  } catch (e) {
    return serverError("Échec de lecture du portfolio agence", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
