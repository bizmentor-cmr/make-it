// Make It — GET/POST /api/agency/clients/[id]/users
// GET  : list the client portal users for this agency client (manager+).
// POST : create a new client portal user (manager+) — {email, name, password}.

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
import {
  createClientUser,
  listClientUsers,
  verifyClientOwnership,
} from "@/server/modules/agency/clients";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// GET /api/agency/clients/[id]/users
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");
  try {
    const users = await listClientUsers(id);
    return ok({ users }, { agencyClientId: id, count: users.length });
  } catch (e) {
    return serverError("Échec de lecture des utilisateurs client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// POST /api/agency/clients/[id]/users — create a portal login.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const email = asString(body.email);
  if (!email) return badRequest("Champ `email` requis");
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return badRequest("Le mot de passe doit faire ≥ 6 caractères");
  const name = asString(body.name);

  try {
    const created = await createClientUser({
      agencyClientId: id,
      email,
      name,
      password,
      createdBy: user.id,
    });
    return ok(created, { agencyClientId: id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "EMAIL_INVALID") return badRequest("Email invalide");
    if (msg === "PASSWORD_TOO_SHORT") return badRequest("Mot de passe trop court (≥ 6 caractères)");
    if (msg === "EMAIL_ALREADY_USED") return badRequest("Cet email est déjà utilisé pour ce client");
    return serverError("Échec de création de l'utilisateur client", { error: msg });
  }
}
