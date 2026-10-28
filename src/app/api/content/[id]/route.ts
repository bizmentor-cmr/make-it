// Make It — GET / PATCH / DELETE /api/content/[id]
// Single-content CRUD scoped by workspaceId. creator+ for PATCH/DELETE; viewer read.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getContent, updateContent, deleteContent } from "@/server/modules/content/service";

const ALLOWED_TYPES = new Set(["text", "image", "carousel", "video", "reel", "story", "ad"]);
const ALLOWED_STATUSES = new Set(["idea", "draft", "ready", "scheduled", "published", "failed"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
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
  const row = await getContent(ctx.workspaceId, id);
  if (!row) return notFound("Contenu introuvable");
  return ok(row, { workspaceId: ctx.workspaceId });
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
  if (body.type !== undefined) {
    const t = asString(body.type);
    if (!t || !ALLOWED_TYPES.has(t)) return badRequest("Type invalide", { type: body.type });
    patch.type = t;
  }
  if (body.title !== undefined) {
    const t = asString(body.title);
    if (!t) return badRequest("Titre invalide");
    patch.title = t;
  }
  if (body.description !== undefined) patch.description = asString(body.description);
  if (body.objective !== undefined) patch.objective = asString(body.objective);
  if (body.pillar !== undefined) patch.pillar = asString(body.pillar);
  if (body.campaignId !== undefined) patch.campaignId = asString(body.campaignId);
  if (body.status !== undefined) {
    const s = asString(body.status);
    if (!s || !ALLOWED_STATUSES.has(s)) return badRequest("Statut invalide", { status: body.status });
    patch.status = s;
  }
  if (body.aiGenerated !== undefined) patch.aiGenerated = body.aiGenerated === true;
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms)) return badRequest("`platforms` doit être un tableau");
    patch.platforms = (body.platforms as unknown[]).filter((x): x is string => typeof x === "string");
  }
  if (body.metadata !== undefined) {
    if (typeof body.metadata !== "object" || body.metadata === null) return badRequest("`metadata` doit être un objet");
    patch.metadata = body.metadata as Record<string, unknown>;
  }
  if (body.parentContentId !== undefined) patch.parentContentId = asString(body.parentContentId);

  try {
    const row = await updateContent(ctx.workspaceId, id, patch);
    if (!row) return notFound("Contenu introuvable");
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "content.update",
      entity: "Content",
      entityId: id,
      metadata: { fields: Object.keys(patch) },
      ip: clientIp(req),
    });
    return ok(row, { updated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la mise à jour du contenu", { error: msg });
  }
}

export async function DELETE(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;
  const ok_del = await deleteContent(ctx.workspaceId, id);
  if (!ok_del) return notFound("Contenu introuvable");
  await audit({
    workspaceId: ctx.workspaceId,
    userId: user.id,
    action: "content.delete",
    entity: "Content",
    entityId: id,
    ip: clientIp(req),
  });
  return ok({ deleted: true }, { id });
}
