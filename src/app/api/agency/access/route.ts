// Make It — POST /api/agency/access
// Manager/Admin assigns a creative or manager to a client.
// Body: { clientId, userId, role: "manager" | "creative" }

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
import { assignClientAccess } from "@/server/modules/agency/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

const VALID_ROLES = new Set(["manager", "creative"]);

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(ctx, "manager")) return forbidden("Rôle manager+ requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const role =
    typeof body.role === "string" && VALID_ROLES.has(body.role)
      ? (body.role as "manager" | "creative")
      : null;

  if (!clientId) return badRequest("`clientId` requis");
  if (!userId) return badRequest("`userId` requis");
  if (!role) return badRequest("`role` doit être 'manager' ou 'creative'");

  try {
    const result = await assignClientAccess({
      agencyId: ctx.agencyId,
      clientId,
      userId,
      role,
      assignedBy: user.id,
    });
    return ok(result, { agencyId: ctx.agencyId, assigned: true, ip: clientIp(req) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_NOT_FOUND") return badRequest("Client introuvable");
    if (msg === "TARGET_NOT_MEMBER") return badRequest("L'utilisateur n'est pas membre de l'agence");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Accès agence requis");
    if (msg === "INSUFFICIENT_ROLE") return forbidden("Rôle manager+ requis");
    return serverError("Échec de l'assignation", { error: msg });
  }
}
