// Make It — GET/POST /api/agency/clients/[id]/reports
// GET  : list the client's white-label reports (filterable by type).
// POST : generate a new white-label report — {type, branding?}.

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
  verifyClientOwnership,
} from "@/server/modules/agency/clients";
import {
  generateWhiteLabelReport,
  listWhiteLabelReports,
  WHITE_LABEL_REPORT_TYPES,
  type WhiteLabelReportType,
  type WhiteLabelBranding,
} from "@/server/modules/reports/white-label";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// GET /api/agency/clients/[id]/reports
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

  const url = new URL(req.url);
  const typeParam = asString(url.searchParams.get("type"));
  const type =
    typeParam && (WHITE_LABEL_REPORT_TYPES as readonly string[]).includes(typeParam)
      ? (typeParam as WhiteLabelReportType)
      : undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, Number.parseInt(limitParam, 10) || 50)) : 50;

  try {
    const reports = await listWhiteLabelReports(client.workspaceId, { type, limit });
    return ok({ reports }, { agencyClientId: id, count: reports.length });
  } catch (e) {
    return serverError("Échec de lecture des rapports white-label", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// POST /api/agency/clients/[id]/reports — generate a new white-label report.
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

  const typeRaw = asString(body.type);
  const type: WhiteLabelReportType =
    typeRaw && (WHITE_LABEL_REPORT_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as WhiteLabelReportType)
      : "monthly";

  // Optional branding overrides (logoUrl, primaryColor, secondaryColor, font, agencyName).
  const brandingOverride: WhiteLabelBranding = {};
  if (body.logoUrl !== undefined) brandingOverride.logoUrl = asString(body.logoUrl);
  if (body.primaryColor !== undefined) brandingOverride.primaryColor = asString(body.primaryColor);
  if (body.secondaryColor !== undefined) brandingOverride.secondaryColor = asString(body.secondaryColor);
  if (body.font !== undefined) brandingOverride.font = asString(body.font);
  if (body.agencyName !== undefined) brandingOverride.agencyName = asString(body.agencyName);
  if (body.clientName !== undefined) brandingOverride.clientName = asString(body.clientName);

  try {
    const report = await generateWhiteLabelReport(client.workspaceId, agencyCtx.agencyId, {
      type,
      branding: Object.keys(brandingOverride).length > 0 ? brandingOverride : undefined,
      generatedBy: user.id,
    });
    return ok(report, { agencyClientId: id, agencyId: agencyCtx.agencyId }, { status: 201 });
  } catch (e) {
    return serverError("Échec de génération du rapport white-label", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
