// Make It — GET /api/validation/setting  |  PATCH /api/validation/setting
// Reads / updates the `requireClientValidation` setting for the active workspace's agency.
// PATCH is admin-only (verifies via resolveAgency + isAgencyAdmin).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, resolveAgency, isAgencyAdmin } from "@/server/core/rbac";
import {
  getRequireClientSetting,
  setRequireClientSetting,
} from "@/server/modules/validation/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  try {
    const setting = await getRequireClientSetting(ctx.workspaceId);
    return ok(setting, { workspaceId: ctx.workspaceId });
  } catch (e) {
    return serverError("Échec de lecture du setting", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  // Verify the workspace is an agency client + the user is admin of that agency.
  const client = await db.agencyClient.findUnique({
    where: { workspaceId: wsCtx.workspaceId },
    select: { agencyId: true },
  });
  if (!client) return forbidden("Ce workspace n'est pas un client d'agence");
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx || agencyCtx.agencyId !== client.agencyId) {
    return forbidden("Accès agence requis");
  }
  if (!isAgencyAdmin(agencyCtx)) return forbidden("Rôle admin requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  const value = body.requireClientValidation;
  if (typeof value !== "boolean") {
    return badRequest("`requireClientValidation` (booléen) requis");
  }

  try {
    const result = await setRequireClientSetting(wsCtx.workspaceId, value);
    return ok(result, { workspaceId: wsCtx.workspaceId, agencyId: agencyCtx.agencyId });
  } catch (e) {
    return serverError("Échec de mise à jour du setting", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
