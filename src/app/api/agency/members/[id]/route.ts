// Make It — PATCH/DELETE /api/agency/members/[id]
// PATCH  : change member role (admin only).
// DELETE : remove member (admin only, cannot remove self / last admin).

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
import { resolveAgency } from "@/server/core/rbac";
import { updateMemberRole, removeMember } from "@/server/modules/agency/service";

const VALID_ROLES = new Set(["admin", "manager", "creative"]);

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// PATCH /api/agency/members/[id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");

  const { id: memberId } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const role =
    typeof body.role === "string" && VALID_ROLES.has(body.role)
      ? (body.role as "admin" | "manager" | "creative")
      : null;
  if (!role) return badRequest("Rôle invalide (admin | manager | creative)");

  try {
    const result = await updateMemberRole({
      agencyId: agencyCtx.agencyId,
      memberId,
      actingUserId: user.id,
      role,
    });
    return ok(result, { agencyId: agencyCtx.agencyId, ip: clientIp(req) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "MEMBER_NOT_FOUND") return notFound("Membre introuvable");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Accès agence requis");
    if (msg === "INSUFFICIENT_ROLE") return forbidden("Rôle admin requis");
    if (msg === "CANNOT_DEMOTE_SELF") return badRequest("Vous ne pouvez pas vous rétrograder");
    if (msg === "INVALID_ROLE") return badRequest("Rôle invalide");
    return serverError("Échec du changement de rôle", { error: msg });
  }
}

// DELETE /api/agency/members/[id]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");

  const { id: memberId } = await ctx.params;

  try {
    const result = await removeMember({
      agencyId: agencyCtx.agencyId,
      memberId,
      actingUserId: user.id,
    });
    return ok(result, { agencyId: agencyCtx.agencyId, ip: clientIp(req) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "MEMBER_NOT_FOUND") return notFound("Membre introuvable");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Accès agence requis");
    if (msg === "INSUFFICIENT_ROLE") return forbidden("Rôle admin requis");
    if (msg === "CANNOT_REMOVE_SELF") return badRequest("Impossible de vous retirer vous-même");
    if (msg === "LAST_ADMIN") return badRequest("Impossible de retirer le dernier admin");
    return serverError("Échec du retrait du membre", { error: msg });
  }
}
