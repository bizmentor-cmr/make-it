// Make It — GET / PATCH / DELETE /api/trends/[id]
// Single-watch CRUD scoped by workspaceId. creator+ for PATCH/DELETE; viewer read.

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
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  updateTrendWatch,
  deleteTrendWatch,
} from "@/server/modules/trends/service";
import { db } from "@/lib/db";

const ALLOWED_PLATFORMS = new Set([
  "instagram",
  "tiktok",
  "linkedin",
  "youtube",
  "facebook",
  "twitter",
  "web",
]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArr(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

type CtxParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { id } = await params;
  // Load the watch directly + verify workspace isolation.
  const watch = await db.trendWatch.findUnique({
    where: { id },
    include: { _count: { select: { posts: true } } },
  });
  if (!watch || watch.workspaceId !== ctx.workspaceId) {
    return notFound("Veille introuvable");
  }
  return ok(watch, { workspaceId: ctx.workspaceId });
}

export async function PATCH(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const n = asString(body.name);
    if (!n) return badRequest("Nom invalide");
    patch.name = n;
  }
  if (body.platforms !== undefined) {
    const arr = asStringArr(body.platforms);
    if (!arr || arr.length === 0) return badRequest("Au moins une plateforme requise");
    for (const p of arr) {
      if (!ALLOWED_PLATFORMS.has(p.toLowerCase())) {
        return badRequest(`Plateforme invalide: ${p}`);
      }
    }
    patch.platforms = arr.map((p) => p.toLowerCase());
  }
  if (body.keywords !== undefined) {
    const arr = asStringArr(body.keywords);
    if (!arr || arr.length === 0) return badRequest("Au moins un mot-clé requis");
    patch.keywords = arr;
  }
  if (body.sector !== undefined) patch.sector = asString(body.sector);
  if (body.competitors !== undefined) patch.competitors = asStringArr(body.competitors) ?? [];
  if (body.language !== undefined) {
    const l = asString(body.language);
    if (!l) return badRequest("Langue invalide");
    patch.language = l;
  }
  if (body.active !== undefined) patch.active = body.active === true;
  if (body.syncIntervalH !== undefined) {
    const n = typeof body.syncIntervalH === "number" ? body.syncIntervalH : Number(body.syncIntervalH);
    if (!Number.isFinite(n) || n < 1) return badRequest("syncIntervalH invalide");
    patch.syncIntervalH = Math.min(168, Math.floor(n));
  }

  try {
    const row = await updateTrendWatch(ctx.workspaceId, id, patch);
    if (!row) return notFound("Veille introuvable");
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "trends.watch.update",
      entity: "TrendWatch",
      entityId: id,
      metadata: { fields: Object.keys(patch) },
      ip: clientIp(req),
    });
    return ok(row, { updated: true });
  } catch (e) {
    return serverError("Échec de la mise à jour de la veille", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function DELETE(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;
  const ok_del = await deleteTrendWatch(ctx.workspaceId, id);
  if (!ok_del) return notFound("Veille introuvable");
  await audit({
    workspaceId: ctx.workspaceId,
    userId: user.id,
    action: "trends.watch.delete",
    entity: "TrendWatch",
    entityId: id,
    ip: clientIp(req),
  });
  return ok({ deleted: true }, { id });
}
