// Make It — GET/POST /api/agency/library
// GET  : list agency library assets (filterable by kind, search, tags, sort).
//        Returns `{ assets, summary }` with origin info + reuse count +
//        performance score per asset + summary aggregates.
// POST : copy an asset from a client's library into the agency library.
//        Body: { contentId?, mediaId?, kind, title, content?, thumb?, tags? }
//        The workspaceId is the active client workspace (X-Workspace-Id header).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency, resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  listAgencyLibrary,
  copyToAgencyLibrary,
  findSimilarByTitle,
  type AssetKind,
} from "@/server/modules/agency/library";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

const VALID_KINDS = new Set<AssetKind>(["text", "image", "video", "carousel", "template"]);
const VALID_SORTS = new Set(["recent", "most-reused", "best-performance"]);

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");

  const url = new URL(req.url);
  const kind = asString(url.searchParams.get("kind"));
  const search = asString(url.searchParams.get("search"));
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : null;
  const sort = asString(url.searchParams.get("sort")) ?? "recent";
  // `?similar=<query>` — anti-waste hint: returns up to 3 agency library assets
  // whose title overlaps with the given query (used by the "Copier vers
  // bibliothèque agence" UI to suggest reusing existing content).
  const similarQuery = asString(url.searchParams.get("similar"));

  if (kind && !VALID_KINDS.has(kind as AssetKind)) {
    return badRequest("`kind` invalide");
  }
  if (!VALID_SORTS.has(sort)) {
    return badRequest("`sort` invalide");
  }

  try {
    const list = await listAgencyLibrary(ctx.agencyId, {
      kind: kind as AssetKind | null,
      search,
      tags,
      sort: sort as "recent" | "most-reused" | "best-performance",
    });
    // Best-effort anti-waste suggestion (parallel — non-blocking).
    const similar = similarQuery
      ? await findSimilarByTitle(ctx.agencyId, similarQuery, 3)
      : [];
    return ok(
      { ...list, similar },
      {
        agencyId: ctx.agencyId,
        role: ctx.role,
        count: list.assets.length,
        hasSimilar: similar.length > 0,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture de la bibliothèque agence", { error: msg });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace client actif");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const title = asString(body.title);
  if (!title) return badRequest("Champ `title` requis");
  const kind = asString(body.kind);
  if (!kind || !VALID_KINDS.has(kind as AssetKind)) {
    return badRequest("Champ `kind` invalide (text|image|video|carousel|template)");
  }
  const contentId = asString(body.contentId);
  const mediaId = asString(body.mediaId);
  const thumb = asString(body.thumb);
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];
  const content =
    body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? (body.content as Record<string, unknown>)
      : null;

  try {
    const asset = await copyToAgencyLibrary(ctx.agencyId, wsCtx.workspaceId, {
      contentId,
      mediaId,
      kind: kind as AssetKind,
      title,
      content,
      thumb,
      tags,
    });
    await audit({
      userId: user.id,
      action: "agency.library.copy",
      entity: "AgencyLibraryAsset",
      entityId: asset.id,
      metadata: {
        agencyId: ctx.agencyId,
        originWorkspaceId: wsCtx.workspaceId,
        originContentId: contentId,
        kind,
        title,
        tags,
      },
      ip: clientIp(req),
    });
    return ok({ asset }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("invalide") || msg.includes("appartient")) {
      return badRequest(msg);
    }
    return serverError("Échec de copie vers la bibliothèque agence", { error: msg });
  }
}
