// Make It — GET/PATCH/DELETE /api/agency/library/[assetId]
// GET    : one asset (with origin info + reuse count + performance).
// PATCH  : update title / tags / content / performanceScore (manager+).
// DELETE : remove an asset (admin only).

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
import { audit } from "@/server/core/audit";
import {
  getAgencyLibraryAsset,
  updateAgencyLibraryAsset,
  deleteAgencyLibraryAsset,
} from "@/server/modules/agency/library";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agCtx = await resolveAgency(req);
  if (!agCtx) return forbidden("Accès agence requis");
  const { assetId } = await ctx.params;

  try {
    const asset = await getAgencyLibraryAsset(agCtx.agencyId, assetId);
    if (!asset) return notFound("Asset introuvable");
    return ok({ asset }, { agencyId: agCtx.agencyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture de l'asset", { error: msg });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agCtx = await resolveAgency(req);
  if (!agCtx) return forbidden("Accès agence requis");
  const { assetId } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: {
    title?: string;
    tags?: string[];
    content?: Record<string, unknown> | null;
    performanceScore?: number | null;
  } = {};
  if (body.title !== undefined) {
    const t = asString(body.title);
    if (!t) return badRequest("`title` invalide");
    patch.title = t;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return badRequest("`tags` doit être un tableau");
    patch.tags = body.tags
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (body.content !== undefined) {
    patch.content =
      body.content === null
        ? null
        : body.content && typeof body.content === "object" && !Array.isArray(body.content)
        ? (body.content as Record<string, unknown>)
        : null;
  }
  if (body.performanceScore !== undefined) {
    if (body.performanceScore === null) {
      patch.performanceScore = null;
    } else if (typeof body.performanceScore === "number") {
      patch.performanceScore = body.performanceScore;
    } else {
      return badRequest("`performanceScore` doit être un nombre");
    }
  }

  if (Object.keys(patch).length === 0) {
    return badRequest("Aucun champ à mettre à jour (title, tags, content, performanceScore)");
  }

  try {
    const asset = await updateAgencyLibraryAsset(
      agCtx.agencyId,
      assetId,
      patch,
      user.id,
      agCtx.role
    );
    await audit({
      userId: user.id,
      action: "agency.library.update",
      entity: "AgencyLibraryAsset",
      entityId: assetId,
      metadata: { agencyId: agCtx.agencyId, patch },
      ip: clientIp(req),
    });
    return ok({ asset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("insuffisant") || msg.includes("refusé")) return forbidden(msg);
    if (msg.includes("requis") || msg.includes("introuvable")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agCtx = await resolveAgency(req);
  if (!agCtx) return forbidden("Accès agence requis");
  const { assetId } = await ctx.params;

  try {
    const deleted = await deleteAgencyLibraryAsset(
      agCtx.agencyId,
      assetId,
      user.id,
      agCtx.role
    );
    if (!deleted) return notFound("Asset introuvable");
    await audit({
      userId: user.id,
      action: "agency.library.delete",
      entity: "AgencyLibraryAsset",
      entityId: assetId,
      metadata: { agencyId: agCtx.agencyId },
      ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("insuffisant") || msg.includes("refusé")) return forbidden(msg);
    return serverError("Échec de la suppression", { error: msg });
  }
}
