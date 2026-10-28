// Make It — GET/POST /api/agency/members
// GET  : list agency members (name, email, role, assigned clients count).
// POST : invite a member (email + role). If the email matches an existing user,
//        they're added directly. Otherwise, an audit entry records the pending invite.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency, hasAgencyRole } from "@/server/core/rbac";
import { listAgencyMembers, inviteMember } from "@/server/modules/agency/service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(["admin", "manager", "creative"]);

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// GET /api/agency/members
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  try {
    const { members } = await listAgencyMembers(ctx.agencyId, ctx.userId);
    return ok({ members }, { agencyId: ctx.agencyId, role: ctx.role, count: members.length });
  } catch (e) {
    return serverError("Échec de lecture des membres", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// POST /api/agency/members — invite a member (admin only).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(ctx, "admin")) return forbidden("Rôle admin requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  if (!EMAIL_RE.test(email)) return badRequest("Email invalide", { email });
  const role = typeof body.role === "string" && VALID_ROLES.has(body.role)
    ? (body.role as "admin" | "manager" | "creative")
    : null;
  if (!role) return badRequest("Rôle invalide (admin | manager | creative)");

  try {
    const result = await inviteMember({
      agencyId: ctx.agencyId,
      invitedBy: user.id,
      email,
      role,
    });
    return ok(
      { member: result.member, pending: result.member === null },
      { agencyId: ctx.agencyId, invited: true, ip: clientIp(req) },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "EMAIL_REQUIRED") return badRequest("Email requis");
    if (msg === "INVALID_ROLE") return badRequest("Rôle invalide");
    return serverError("Impossible d'inviter ce membre", { error: msg });
  }
}
