// Make It — GET/PATCH/DELETE /api/agency/clients/[id]
// GET    : one client (with its workspace data).
// PATCH  : rename / change status (manager+).
// DELETE : archive the client (does NOT delete data).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency, hasAgencyRole } from "@/server/core/rbac";
import {
  getClient,
  updateClient,
  archiveClient,
  isClientStatus,
  type ClientStatus,
} from "@/server/modules/agency/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// GET /api/agency/clients/[id]
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  const { id } = await ctx.params;
  const client = await getClient({ clientId: id, userId: user.id });
  if (!client) return notFound("Client introuvable ou inaccessible");
  return ok(client, { agencyId: agencyCtx.agencyId, role: agencyCtx.role });
}

// PATCH /api/agency/clients/[id] — rename / change status (manager+).
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const status = isClientStatus(body.status) ? (body.status as ClientStatus) : undefined;

  if (!name && !status) {
    return badRequest("Rien à mettre à jour (fournir `name` ou `status`)");
  }

  try {
    const result = await updateClient({
      agencyId: agencyCtx.agencyId,
      clientId: id,
      userId: user.id,
      name,
      status,
    });
    return ok(result, { agencyId: agencyCtx.agencyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_NOT_FOUND") return notFound("Client introuvable");
    if (msg === "INSUFFICIENT_ROLE") return forbidden("Rôle manager+ requis");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Accès agence requis");
    return serverError("Échec de mise à jour du client", { error: msg });
  }
}

// DELETE /api/agency/clients/[id] — archive the client (no data deletion).
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");

  const { id } = await ctx.params;

  try {
    const result = await archiveClient({
      agencyId: agencyCtx.agencyId,
      clientId: id,
      userId: user.id,
    });
    return ok(result, { agencyId: agencyCtx.agencyId, archived: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_NOT_FOUND") return notFound("Client introuvable");
    if (msg === "INSUFFICIENT_ROLE") return forbidden("Rôle manager+ requis");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Accès agence requis");
    return serverError("Échec de l'archivage du client", { error: msg });
  }
}
