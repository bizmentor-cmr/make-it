// Make It — GET / POST /api/content
// List (filters + pagination) and create Content (status default "draft").
// creator+ write; viewer read. Scoped by workspaceId.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { listContent, createContent } from "@/server/modules/content/service";

const ALLOWED_TYPES = new Set(["text", "image", "carousel", "video", "reel", "story", "ad"]);
const ALLOWED_STATUSES = new Set(["idea", "draft", "ready", "scheduled", "published", "failed"]);

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const objective = url.searchParams.get("objective");
  const campaignId = url.searchParams.get("campaignId");
  const search = url.searchParams.get("search");
  const parentContentIdParam = url.searchParams.get("parentContentId");

  let parentContentId: string | null | undefined = undefined;
  if (parentContentIdParam === "null") parentContentId = null;
  else if (parentContentIdParam) parentContentId = parentContentIdParam;

  if (type && !ALLOWED_TYPES.has(type)) return badRequest("Type de contenu invalide", { type });
  if (status && !ALLOWED_STATUSES.has(status)) return badRequest("Statut invalide", { status });

  const res = await listContent(ctx.workspaceId, {
    type: type ?? undefined,
    status: status ?? undefined,
    objective: objective ?? undefined,
    campaignId: campaignId ?? undefined,
    parentContentId,
    search: search ?? undefined,
    page,
    limit,
  });
  return ok(res.items, {
    page: res.page,
    limit: res.limit,
    total: res.total,
    pages: res.pages,
    workspaceId: ctx.workspaceId,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const type = asString(body.type);
  if (!type || !ALLOWED_TYPES.has(type)) return badRequest("Type invalide", { type, allowed: Array.from(ALLOWED_TYPES) });
  const title = asString(body.title);
  if (!title) return badRequest("Champ `title` requis");
  const status = asString(body.status) ?? "draft";
  if (!ALLOWED_STATUSES.has(status)) return badRequest("Statut invalide", { status });

  try {
    const row = await createContent(ctx.workspaceId, {
      type,
      title,
      description: asString(body.description),
      objective: asString(body.objective),
      pillar: asString(body.pillar),
      campaignId: asString(body.campaignId),
      status,
      aiGenerated: body.aiGenerated === true,
      platforms: Array.isArray(body.platforms) ? (body.platforms as unknown[]).filter((x): x is string => typeof x === "string") : [],
      metadata: (body.metadata as Record<string, unknown>) ?? {},
      parentContentId: asString(body.parentContentId),
    });
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "content.create",
      entity: "Content",
      entityId: row.id,
      metadata: { type, title, status },
      ip: clientIp(req),
    });
    return ok(row, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du contenu", { error: msg });
  }
}
