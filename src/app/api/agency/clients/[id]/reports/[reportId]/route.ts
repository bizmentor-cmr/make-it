// Make It — GET/PATCH/DELETE /api/agency/clients/[id]/reports/[reportId]
// GET    : one white-label report.
// PATCH  : edit the report content / branding before export (manager+).
// DELETE : delete the report (manager+).

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
import { verifyClientOwnership } from "@/server/modules/agency/clients";
import {
  getWhiteLabelReport,
  updateWhiteLabelReport,
  deleteWhiteLabelReport,
  type WhiteLabelBranding,
  type WhiteLabelReportContent,
} from "@/server/modules/reports/white-label";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v.trim() || null : null;
}

// GET /api/agency/clients/[id]/reports/[reportId]
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; reportId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  const { id, reportId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");
  const report = await getWhiteLabelReport(client.workspaceId, reportId);
  if (!report) return notFound("Rapport introuvable");
  return ok(report, { agencyClientId: id });
}

// PATCH /api/agency/clients/[id]/reports/[reportId]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; reportId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id, reportId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: {
    content?: Partial<WhiteLabelReportContent>;
    branding?: Partial<WhiteLabelBranding>;
  } = {};

  if (body.content && typeof body.content === "object") {
    const c = body.content as Record<string, unknown>;
    const contentPatch: Partial<WhiteLabelReportContent> = {};
    if (c.title !== undefined) contentPatch.title = asString(c.title) ?? "Rapport";
    if (c.periodLabel !== undefined) contentPatch.periodLabel = asStringOrNull(c.periodLabel);
    if (c.commentary !== undefined) contentPatch.commentary = asStringOrNull(c.commentary);
    if (Array.isArray(c.recommendations)) {
      contentPatch.recommendations = c.recommendations.filter(
        (r): r is string => typeof r === "string"
      );
    }
    if (Array.isArray(c.working)) contentPatch.working = c.working.filter((r): r is string => typeof r === "string");
    if (Array.isArray(c.declining)) contentPatch.declining = c.declining.filter((r): r is string => typeof r === "string");
    if (Array.isArray(c.growing)) contentPatch.growing = c.growing.filter((r): r is string => typeof r === "string");
    if (Array.isArray(c.toChange)) contentPatch.toChange = c.toChange.filter((r): r is string => typeof r === "string");
    patch.content = contentPatch;
  }

  if (body.branding && typeof body.branding === "object") {
    const b = body.branding as Record<string, unknown>;
    const brandingPatch: WhiteLabelBranding = {};
    if (b.logoUrl !== undefined) brandingPatch.logoUrl = asStringOrNull(b.logoUrl);
    if (b.primaryColor !== undefined) brandingPatch.primaryColor = asStringOrNull(b.primaryColor);
    if (b.secondaryColor !== undefined) brandingPatch.secondaryColor = asStringOrNull(b.secondaryColor);
    if (b.font !== undefined) brandingPatch.font = asStringOrNull(b.font);
    if (b.agencyName !== undefined) brandingPatch.agencyName = asStringOrNull(b.agencyName);
    if (b.clientName !== undefined) brandingPatch.clientName = asStringOrNull(b.clientName);
    patch.branding = brandingPatch;
  }

  if (!patch.content && !patch.branding) {
    return badRequest("Rien à mettre à jour (fournir `content` ou `branding`)");
  }

  try {
    const updated = await updateWhiteLabelReport(client.workspaceId, reportId, patch, {
      updatedBy: user.id,
    });
    return ok(updated, { agencyClientId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "REPORT_NOT_FOUND") return notFound("Rapport introuvable");
    return serverError("Échec de mise à jour du rapport", { error: msg });
  }
}

// DELETE /api/agency/clients/[id]/reports/[reportId]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; reportId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agencyCtx = await resolveAgency(req);
  if (!agencyCtx) return forbidden("Accès agence requis");
  if (!hasAgencyRole(agencyCtx, "manager")) return forbidden("Rôle manager+ requis");
  const { id, reportId } = await ctx.params;
  const client = await verifyClientOwnership(agencyCtx.agencyId, id);
  if (!client) return forbidden("Client introuvable ou inaccessible");

  try {
    const res = await deleteWhiteLabelReport(client.workspaceId, reportId, {
      deletedBy: user.id,
    });
    return ok(res, { agencyClientId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "REPORT_NOT_FOUND") return notFound("Rapport introuvable");
    return serverError("Échec de suppression du rapport", { error: msg });
  }
}
