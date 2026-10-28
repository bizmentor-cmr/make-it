// Make It — GET /api/agency/credits  |  PATCH /api/agency/credits
// GET: returns the agency wallet + the allocations tree.
// PATCH: admin-only — sets the credit mode (pool | quotas).

import { NextRequest } from "next/server";
import {
  ok,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { resolveAgency, isAgencyAdmin } from "@/server/core/rbac";
import {
  getAgencyWallet,
  getAllocations,
  setAgencyMode,
} from "@/server/modules/agency/credits";

export async function GET(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  try {
    const [wallet, allocations] = await Promise.all([
      getAgencyWallet(ctx.agencyId),
      getAllocations(ctx.agencyId, ctx.userId, ctx.role),
    ]);
    return ok({ wallet, allocations }, { agencyId: ctx.agencyId, role: ctx.role });
  } catch (e) {
    return serverError("Échec de lecture des crédits agence", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!isAgencyAdmin(ctx)) return forbidden("Rôle admin requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const mode = body.mode;
  if (mode !== "pool" && mode !== "quotas") {
    return badRequest("`mode` doit être 'pool' ou 'quotas'");
  }

  try {
    const result = await setAgencyMode(ctx.agencyId, ctx.userId, mode);
    return ok(result, { agencyId: ctx.agencyId });
  } catch (e) {
    return serverError("Échec du changement de mode", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
