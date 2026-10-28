// Make It — GET / POST /api/trends
// GET  : list the workspace's trend watches + a compact insights summary
//        (top hashtags, top platforms, top angles, recent keywords, sector).
// POST : create a trend watch (name, platforms, keywords, sector, competitors, language).
// creator+ write; viewer read. Scoped by workspaceId.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  listTrendWatches,
  createTrendWatch,
  getTrendInsights,
} from "@/server/modules/trends/service";

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
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t) continue;
    out.push(t);
  }
  return out;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// GET /api/trends — list watches + insights
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const [watches, insights] = await Promise.all([
    listTrendWatches(ctx.workspaceId),
    getTrendInsights(ctx.workspaceId).catch(() => null),
  ]);

  return ok(
    { watches, insights },
    {
      workspaceId: ctx.workspaceId,
      count: watches.length,
    }
  );
}

// POST /api/trends — create a watch
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

  const name = asString(body.name);
  if (!name) return badRequest("Champ `name` requis");
  const platforms = asStringArr(body.platforms);
  if (!platforms || platforms.length === 0) {
    return badRequest("Au moins une `platforms` requise", {
      allowed: Array.from(ALLOWED_PLATFORMS),
    });
  }
  for (const p of platforms) {
    if (!ALLOWED_PLATFORMS.has(p.toLowerCase())) {
      return badRequest(`Plateforme invalide: ${p}`, { allowed: Array.from(ALLOWED_PLATFORMS) });
    }
  }
  const keywords = asStringArr(body.keywords) ?? [];
  if (keywords.length === 0) {
    return badRequest("Au moins un mot-clé (keywords) requis");
  }
  const sector = asString(body.sector);
  const competitors = asStringArr(body.competitors) ?? [];
  const language = asString(body.language) ?? "fr";

  try {
    const watch = await createTrendWatch(ctx.workspaceId, {
      name,
      platforms: platforms.map((p) => p.toLowerCase()),
      keywords,
      sector,
      competitors,
      language,
    });
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "trends.watch.create",
      entity: "TrendWatch",
      entityId: watch.id,
      metadata: { name, platforms: watch.platforms, keywords, sector, competitors, language },
      ip: clientIp(req),
    });
    return ok(watch, { created: true }, { status: 201 });
  } catch (e) {
    return serverError("Échec de la création de la veille", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
