// Make It — GET/PATCH /api/agency/clients/[id]/branding
// GET   : returns the client's white-label branding (or default violet+emerald).
// PATCH : upserts the branding — {logoUrl?, primaryColor?, secondaryColor?, font?, agencyName?}.

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
  getClientBranding,
  updateClientBranding,
  verifyClientOwnership,
} from "@/server/modules/agency/clients";

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v.trim() || null : null;
}

// GET /api/agency/clients/[id]/branding
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  const { id } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");
  try {
    const branding = await getClientBranding(id);
    return ok(branding, { agencyClientId: id });
  } catch (e) {
    return serverError("Échec de lecture du branding client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// PATCH /api/agency/clients/[id]/branding
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
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    font?: string | null;
    agencyName?: string | null;
  } = {};
  if (body.logoUrl !== undefined) patch.logoUrl = asStringOrNull(body.logoUrl);
  if (body.primaryColor !== undefined) patch.primaryColor = asStringOrNull(body.primaryColor);
  if (body.secondaryColor !== undefined) patch.secondaryColor = asStringOrNull(body.secondaryColor);
  if (body.font !== undefined) patch.font = asStringOrNull(body.font);
  if (body.agencyName !== undefined) patch.agencyName = asStringOrNull(body.agencyName);

  try {
    const branding = await updateClientBranding(id, patch, { updatedBy: user.id });
    return ok(branding, { agencyClientId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "COLOR_INVALID") return badRequest("Couleur invalide (format hex requis, ex: #7c3aed)");
    return serverError("Échec de mise à jour du branding client", { error: msg });
  }
}
