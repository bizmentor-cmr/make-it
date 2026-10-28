// Make It — PATCH/DELETE /api/agency/clients/[id]/users/[userId]
// PATCH  : update name / password / status (manager+).
// DELETE : delete the client portal user (manager+).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency, hasAgencyRole } from "@/server/core/rbac";
import {
  updateClientUser,
  deleteClientUser,
  verifyClientOwnership,
  CLIENT_USER_STATUSES,
  type ClientUserStatus,
} from "@/server/modules/agency/clients";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// PATCH /api/agency/clients/[id]/users/[userId]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id, userId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: {
    name?: string | null;
    password?: string;
    status?: ClientUserStatus;
  } = {};
  if (body.name !== undefined) {
    patch.name = asString(body.name);
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    patch.password = body.password;
  }
  if (body.status !== undefined) {
    const s = asString(body.status);
    if (!s || !(CLIENT_USER_STATUSES as readonly string[]).includes(s)) {
      return badRequest("Statut invalide (active | suspended)");
    }
    patch.status = s as ClientUserStatus;
  }

  if (patch.name === undefined && patch.password === undefined && patch.status === undefined) {
    return badRequest("Rien à mettre à jour (fournir `name`, `password` ou `status`)");
  }

  try {
    const updated = await updateClientUser(userId, patch, { updatedBy: user.id });
    return ok(updated, { agencyClientId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_USER_NOT_FOUND") return notFound("Utilisateur client introuvable");
    if (msg === "PASSWORD_TOO_SHORT") return badRequest("Mot de passe trop court (≥ 6 caractères)");
    if (msg === "STATUS_INVALID") return badRequest("Statut invalide");
    if (msg === "NOTHING_TO_UPDATE") return badRequest("Rien à mettre à jour");
    return serverError("Échec de mise à jour de l'utilisateur client", { error: msg });
  }
}

// DELETE /api/agency/clients/[id]/users/[userId]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id, userId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  try {
    const res = await deleteClientUser(userId, { deletedBy: user.id });
    return ok(res, { agencyClientId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_USER_NOT_FOUND") return notFound("Utilisateur client introuvable");
    return serverError("Échec de suppression de l'utilisateur client", { error: msg });
  }
}
