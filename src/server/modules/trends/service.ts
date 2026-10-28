// Make It — Competitive Intelligence / Trend Watching domain service.
//
// A workspace can set up "trend watches" — monitoring specific platforms +
// keywords + sectors to discover trending content from competitors and the
// broader market. Each watch, when synced, uses the z-ai `web_search` function
// to discover recent high-engagement posts, then the LLM (`textChat`) enriches
// every result with a summary of why it performs + a reusable marketing angle.
//
// The sync is idempotent — a post with the same externalId / url is never
// duplicated. The cap is 20 new posts per sync (10 in the synchronous MVP —
// see the API route which passes a `maxResults` override).
//
// The `getTrendInsights(workspaceId)` helper produces a compact summary
// (top hashtags, top platforms, top angles) that the calendar_generate + text
// runners consume to align suggested content with current trends.

import { db } from "@/lib/db";
import { textChat, webSearch } from "@/server/core/ai";
import { jsonParse, jsonStringify } from "@/server/core/types";
import { logger } from "@/server/core/logger";

// ── Types ────────────────────────────────────────────────────────────────

export type TrendWatchRow = {
  id: string;
  workspaceId: string;
  name: string;
  platforms: string[];
  keywords: string[];
  sector: string | null;
  competitors: string[];
  language: string;
  active: boolean;
  lastSyncAt: Date | null;
  syncIntervalH: number;
  createdAt: Date;
  updatedAt: Date;
  postCount: number;
};

export type TrendPostRow = {
  id: string;
  watchId: string;
  platform: string;
  authorHandle: string | null;
  authorName: string | null;
  authorFollowers: number | null;
  externalId: string | null;
  url: string | null;
  caption: string | null;
  hashtags: string[];
  mediaType: string | null;
  thumbnailUrl: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  engagementRate: number | null;
  summary: string | null;
  contentAngle: string | null;
  relevanceScore: number | null;
  postedAt: Date | null;
  discoveredAt: Date;
  isSaved: boolean;
  inspiredContentId: string | null;
};

export type TrendInsights = {
  watchCount: number;
  postCount: number;
  topHashtags: { tag: string; count: number }[];
  topPlatforms: { platform: string; count: number; avgEngagement: number | null }[];
  topAngles: { angle: string; platform: string; engagementRate: number | null }[];
  recentKeywords: string[];
  sector: string | null;
  lastSyncAt: Date | null;
};

// ── Mappers ──────────────────────────────────────────────────────────────

function toWatchRow(
  w: {
    id: string; workspaceId: string; name: string; platforms: string; keywords: string;
    sector: string | null; competitors: string | null; language: string; active: boolean;
    lastSyncAt: Date | null; syncIntervalH: number; createdAt: Date; updatedAt: Date;
    _count?: { posts: number };
  }
): TrendWatchRow {
  return {
    id: w.id,
    workspaceId: w.workspaceId,
    name: w.name,
    platforms: jsonParse<string[]>(w.platforms, []),
    keywords: jsonParse<string[]>(w.keywords, []),
    sector: w.sector,
    competitors: jsonParse<string[]>(w.competitors, []),
    language: w.language,
    active: w.active,
    lastSyncAt: w.lastSyncAt,
    syncIntervalH: w.syncIntervalH,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    postCount: w._count?.posts ?? 0,
  };
}

function toPostRow(p: {
  id: string; watchId: string; platform: string; authorHandle: string | null;
  authorName: string | null; authorFollowers: number | null; externalId: string | null;
  url: string | null; caption: string | null; hashtags: string | null; mediaType: string | null;
  thumbnailUrl: string | null; likes: number | null; comments: number | null; shares: number | null;
  saves: number | null; views: number | null; engagementRate: number | null; summary: string | null;
  contentAngle: string | null; relevanceScore: number | null; postedAt: Date | null;
  discoveredAt: Date; isSaved: boolean; inspiredContentId: string | null;
}): TrendPostRow {
  return {
    ...p,
    hashtags: jsonParse<string[]>(p.hashtags, []),
  };
}

// ── List watches ─────────────────────────────────────────────────────────
export async function listTrendWatches(workspaceId: string): Promise<TrendWatchRow[]> {
  const rows = await db.trendWatch.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { posts: true } } },
  });
  return rows.map(toWatchRow);
}

// ── Create watch ─────────────────────────────────────────────────────────
export type CreateTrendWatchInput = {
  name: string;
  platforms: string[];
  keywords: string[];
  sector?: string | null;
  competitors?: string[];
  language?: string;
};

export async function createTrendWatch(
  workspaceId: string,
  input: CreateTrendWatchInput
): Promise<TrendWatchRow> {
  const w = await db.trendWatch.create({
    data: {
      workspaceId,
      name: input.name.trim() || "Veille sans nom",
      platforms: jsonStringify(input.platforms ?? []),
      keywords: jsonStringify(input.keywords ?? []),
      sector: input.sector ?? null,
      competitors: jsonStringify(input.competitors ?? []),
      language: input.language ?? "fr",
      active: true,
    },
    include: { _count: { select: { posts: true } } },
  });
  return toWatchRow(w);
}

// ── Update watch ─────────────────────────────────────────────────────────
export type UpdateTrendWatchInput = Partial<CreateTrendWatchInput & { active?: boolean; syncIntervalH?: number }>;

export async function updateTrendWatch(
  workspaceId: string,
  id: string,
  patch: UpdateTrendWatchInput
): Promise<TrendWatchRow | null> {
  const existing = await db.trendWatch.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.platforms !== undefined) data.platforms = jsonStringify(patch.platforms);
  if (patch.keywords !== undefined) data.keywords = jsonStringify(patch.keywords);
  if (patch.sector !== undefined) data.sector = patch.sector;
  if (patch.competitors !== undefined) data.competitors = jsonStringify(patch.competitors);
  if (patch.language !== undefined) data.language = patch.language;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.syncIntervalH !== undefined) data.syncIntervalH = Math.max(1, Math.min(168, Math.floor(patch.syncIntervalH)));
  const w = await db.trendWatch.update({
    where: { id },
    data,
    include: { _count: { select: { posts: true } } },
  });
  return toWatchRow(w);
}

// ── Delete watch ─────────────────────────────────────────────────────────
export async function deleteTrendWatch(workspaceId: string, id: string): Promise<boolean> {
  const existing = await db.trendWatch.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return false;
  await db.trendWatch.delete({ where: { id } });
  return true;
}

// ── Sync watch (the core) ───────────────────────────────────────────────
// Uses `webSearch` to find trending content matching the watch's keywords +
// sector + platform. For each result, the LLM enriches it with a summary of
// why it performs + a reusable marketing angle. Idempotent on externalId/url.
// Cap = `maxResults` (default 10 — kept low for the synchronous MVP).
export type SyncResult = {
  watchId: string;
  discovered: number;
  inserted: number;
  skipped: number;
  failed: number;
  posts: TrendPostRow[];
  syncedAt: Date;
};

export async function syncTrendWatch(
  id: string,
  opts: { maxResults?: number } = {}
): Promise<SyncResult | null> {
  const watch = await db.trendWatch.findUnique({ where: { id } });
  if (!watch) return null;
  const maxResults = Math.max(3, Math.min(20, opts.maxResults ?? 10));
  const platforms = jsonParse<string[]>(watch.platforms, []);
  const keywords = jsonParse<string[]>(watch.keywords, []);
  const competitors = jsonParse<string[]>(watch.competitors, []);
  const sector = watch.sector ?? "";
  const language = watch.language ?? "fr";

  // Build a focused query string for the web search — trending ${keywords} ${sector} ${platform}.
  const queryParts: string[] = [];
  if (keywords.length) queryParts.push(keywords.slice(0, 5).join(" "));
  if (sector) queryParts.push(sector);
  // Pick the first platform as the focal platform for the query — searching
  // for "instagram" + "tiktok" at the same time returns mixed noise. We
  // instead narrow the query to the most representative platform.
  if (platforms.length) queryParts.push(platforms[0]);
  if (competitors.length) queryParts.push(competitors.slice(0, 3).join(" "));
  // "trending" + "viral" + lang hint bias toward recent high-engagement posts.
  queryParts.push("trending viral " + (language === "fr" ? "tendance" : "trend"));
  const query = queryParts.join(" ").trim();

  // 1) Web search — best-effort, never fatal when the function misbehaves.
  let rawResults: unknown = null;
  try {
    rawResults = await webSearch(query, maxResults);
  } catch (e) {
    logger.error("[trends] web_search failed", { error: e instanceof Error ? e.message : String(e), watchId: id });
  }
  const items = normalizeSearchResults(rawResults, maxResults);

  // 2) For each result, run an enrichment pass that produces:
  //    - summary (why it performs)
  //    - contentAngle (a reusable marketing idea)
  //    - hashtags (extracted from caption/title)
  //    - platform (inferred when missing)
  //    - engagementRate + likes + comments (parsed when available)
  //    - thumbnailUrl (when available)
  //    - externalId (url-hash fallback so we stay idempotent)
  const inserted: TrendPostRow[] = [];
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const externalId = item.externalId ?? `url:${item.url ?? ""}`;
      // Idempotency check on externalId / url.
      const exists = await db.trendPost.findFirst({
        where: {
          watchId: id,
          OR: [{ externalId: externalId }, ...(item.url ? [{ url: item.url }] : [])],
        },
        select: { id: true },
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      // Enrichment via the LLM. Wrapped in try/catch — on failure we still
      // store the raw post (without AI enrichment) so nothing is lost.
      const emptyEnriched: EnrichedPost = {
        summary: null,
        contentAngle: null,
        hashtags: [],
        engagementRate: null,
        likes: null,
        comments: null,
        shares: null,
        saves: null,
        views: null,
        authorHandle: null,
        authorName: null,
        authorFollowers: null,
        mediaType: null,
        thumbnailUrl: null,
        postedAt: null,
      };
      let enriched: EnrichedPost = emptyEnriched;
      try {
        enriched = await enrichPost(item, { platforms, keywords, sector, competitors, language });
      } catch (e) {
        logger.warn("[trends] enrichment failed for one result", { error: e instanceof Error ? e.message : String(e) });
      }

      const created = await db.trendPost.create({
        data: {
          watchId: id,
          platform: item.platform ?? platforms[0] ?? "web",
          authorHandle: enriched.authorHandle ?? item.authorHandle ?? null,
          authorName: enriched.authorName ?? item.authorName ?? null,
          authorFollowers: enriched.authorFollowers ?? null,
          externalId,
          url: item.url ?? null,
          caption: item.caption ?? null,
          hashtags: jsonStringify(enriched.hashtags ?? item.hashtags ?? []),
          mediaType: enriched.mediaType ?? item.mediaType ?? null,
          thumbnailUrl: enriched.thumbnailUrl ?? item.thumbnailUrl ?? null,
          likes: enriched.likes ?? item.likes ?? null,
          comments: enriched.comments ?? item.comments ?? null,
          shares: enriched.shares ?? item.shares ?? null,
          saves: enriched.saves ?? item.saves ?? null,
          views: enriched.views ?? item.views ?? null,
          engagementRate: enriched.engagementRate ?? item.engagementRate ?? null,
          summary: enriched.summary ?? null,
          contentAngle: enriched.contentAngle ?? null,
          relevanceScore: item.relevanceScore ?? null,
          postedAt: enriched.postedAt ? safeDate(enriched.postedAt) : item.postedAt,
        },
      });
      inserted.push(toPostRow(created));
    } catch (e) {
      failed += 1;
      logger.error("[trends] failed to insert one post", { error: e instanceof Error ? e.message : String(e) });
    }
    // Cap at 20 new posts per sync (defensive — the search already capped).
    if (inserted.length >= 20) break;
  }

  // 3) Update the watch's lastSyncAt.
  const now = new Date();
  await db.trendWatch.update({ where: { id }, data: { lastSyncAt: now } });

  return {
    watchId: id,
    discovered: items.length,
    inserted: inserted.length,
    skipped,
    failed,
    posts: inserted,
    syncedAt: now,
  };
}

// ── List posts (filterable + sortable + paginated) ──────────────────────
export type ListTrendPostsInput = {
  watchId?: string;
  workspaceId?: string;
  platform?: string;
  savedOnly?: boolean;
  sortBy?: "engagementRate" | "relevanceScore" | "discoveredAt";
  page?: number;
  limit?: number;
};

export type ListTrendPostsResult = {
  items: TrendPostRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export async function listTrendPosts(input: ListTrendPostsInput): Promise<ListTrendPostsResult> {
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.max(1, Math.min(50, input.limit ?? 20));
  // Scope by watchId when given, otherwise by workspaceId (via watch relation).
  const where: Record<string, unknown> = {};
  if (input.watchId) {
    where.watchId = input.watchId;
  } else if (input.workspaceId) {
    where.watch = { workspaceId: input.workspaceId };
  }
  if (input.platform) where.platform = input.platform;
  if (input.savedOnly) where.isSaved = true;

  const sortField = input.sortBy ?? "discoveredAt";
  const orderBy: Record<string, string> =
    sortField === "discoveredAt"
      ? { discoveredAt: "desc" }
      : sortField === "relevanceScore"
      ? { relevanceScore: "desc" }
      : { engagementRate: "desc" };

  const [total, rows] = await Promise.all([
    db.trendPost.count({ where }),
    db.trendPost.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return {
    items: rows.map(toPostRow),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── Save / unsave a post ─────────────────────────────────────────────────
export async function setTrendPostSaved(
  postId: string,
  workspaceId: string,
  saved: boolean
): Promise<TrendPostRow | null> {
  // Verify the post belongs to a watch owned by this workspace.
  const post = await db.trendPost.findUnique({
    where: { id: postId },
    include: { watch: { select: { workspaceId: true } } },
  });
  if (!post || post.watch.workspaceId !== workspaceId) return null;
  const updated = await db.trendPost.update({
    where: { id: postId },
    data: { isSaved: saved },
  });
  return toPostRow(updated);
}

// ── Create content inspired by a trend post ────────────────────────────
// Creates a Content row (type=text, status=idea, title=post.contentAngle,
// description=post.summary, metadata records the inspiration source). Links
// the post via inspiredContentId so the UI can show "déjà transformé en idée".
export async function inspireContentFromPost(
  postId: string,
  workspaceId: string
): Promise<{ contentId: string } | null> {
  const post = await db.trendPost.findUnique({
    where: { id: postId },
    include: { watch: { select: { workspaceId: true, platforms: true } } },
  });
  if (!post || post.watch.workspaceId !== workspaceId) return null;

  const title = (post.contentAngle ?? post.caption ?? "Idée issue d'une tendance").slice(0, 200);
  const description = post.summary ?? null;
  const platforms = jsonParse<string[]>(post.watch.platforms ?? "[]", []);
  // Pick the post's own platform when available, otherwise all watch platforms.
  const contentPlatforms = post.platform ? [post.platform] : platforms;

  const created = await db.content.create({
    data: {
      workspaceId,
      type: "text",
      title,
      description,
      objective: "engagement",
      status: "idea",
      platforms: jsonStringify(contentPlatforms),
      metadata: jsonStringify({
        source: "trend_post",
        trendPostId: post.id,
        trendWatchId: post.watchId,
        platform: post.platform,
        authorHandle: post.authorHandle,
        url: post.url,
        engagementRate: post.engagementRate,
        contentAngle: post.contentAngle,
        summary: post.summary,
      }),
      aiGenerated: false,
    },
  });

  // Link the post back so the UI shows "déjà transformé en idée".
  await db.trendPost.update({
    where: { id: postId },
    data: { inspiredContentId: created.id },
  });

  return { contentId: created.id };
}

// ── Insights (compact summary for the calendar + text runners) ────────
// Returns: watch count, post count, top hashtags, top platforms (with avg
// engagement), top angles (with engagement), recent keywords, sector, lastSync.
export async function getTrendInsights(workspaceId: string): Promise<TrendInsights> {
  const watches = await db.trendWatch.findMany({
    where: { workspaceId, active: true },
    select: {
      id: true, keywords: true, sector: true, platforms: true, lastSyncAt: true,
    },
  });

  if (watches.length === 0) {
    return {
      watchCount: 0,
      postCount: 0,
      topHashtags: [],
      topPlatforms: [],
      topAngles: [],
      recentKeywords: [],
      sector: null,
      lastSyncAt: null,
    };
  }

  const watchIds = watches.map((w) => w.id);
  // Pull the most recent 200 posts (enough signal for the summary, capped
  // to keep the query fast on SQLite).
  const posts = await db.trendPost.findMany({
    where: { watchId: { in: watchIds } },
    select: {
      platform: true, hashtags: true, contentAngle: true, engagementRate: true,
      discoveredAt: true,
    },
    orderBy: { discoveredAt: "desc" },
    take: 200,
  });

  // Top hashtags — split JSON arrays, lowercase, count.
  const tagCount = new Map<string, number>();
  for (const p of posts) {
    const tags = jsonParse<string[]>(p.hashtags, []);
    for (const t of tags) {
      const key = t.toLowerCase().trim();
      if (!key) continue;
      tagCount.set(key, (tagCount.get(key) ?? 0) + 1);
    }
  }
  const topHashtags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Top platforms — count + avg engagementRate (when available).
  const platformAgg = new Map<string, { count: number; engagementSum: number; engagementCount: number }>();
  for (const p of posts) {
    const key = p.platform ?? "web";
    const acc = platformAgg.get(key) ?? { count: 0, engagementSum: 0, engagementCount: 0 };
    acc.count += 1;
    if (typeof p.engagementRate === "number" && Number.isFinite(p.engagementRate)) {
      acc.engagementSum += p.engagementRate;
      acc.engagementCount += 1;
    }
    platformAgg.set(key, acc);
  }
  const topPlatforms = Array.from(platformAgg.entries())
    .map(([platform, acc]) => ({
      platform,
      count: acc.count,
      avgEngagement: acc.engagementCount > 0 ? acc.engagementSum / acc.engagementCount : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Top angles — pick the highest-engagement posts with a contentAngle.
  const angled = posts
    .filter((p) => typeof p.contentAngle === "string" && p.contentAngle!.trim().length > 0)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, 6)
    .map((p) => ({
      angle: (p.contentAngle as string).slice(0, 200),
      platform: p.platform ?? "web",
      engagementRate: p.engagementRate,
    }));

  // Recent keywords — flatten all watch keywords, dedupe, cap at 12.
  const allKeywords = new Set<string>();
  for (const w of watches) {
    for (const k of jsonParse<string[]>(w.keywords, [])) {
      if (k.trim()) allKeywords.add(k.trim());
    }
  }
  const recentKeywords = Array.from(allKeywords).slice(0, 12);

  const sector = watches.map((w) => w.sector).filter(Boolean)[0] ?? null;
  const lastSyncAt = watches
    .map((w) => w.lastSyncAt)
    .filter(Boolean)
    .sort((a, b) => (b!.getTime() - a!.getTime()))[0] ?? null;

  return {
    watchCount: watches.length,
    postCount: posts.length,
    topHashtags,
    topPlatforms,
    topAngles: angled,
    recentKeywords,
    sector: sector ?? null,
    lastSyncAt,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

// The z-ai `web_search` function returns either an array of objects, or an
// object with a `results` field, or a raw string. Normalize to a list of
// { url, title, snippet, ... }.
type RawSearchItem = {
  url?: string;
  link?: string;
  title?: string;
  snippet?: string;
  content?: string;
  description?: string;
  source?: string;
  published?: string;
  date?: string;
  author?: string;
};

type NormalizedItem = {
  url: string | null;
  caption: string | null;
  authorHandle: string | null;
  authorName: string | null;
  externalId: string | null;
  platform: string | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
  hashtags: string[];
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  engagementRate: number | null;
  relevanceScore: number | null;
  postedAt: Date | null;
};

function normalizeSearchResults(raw: unknown, max: number): NormalizedItem[] {
  if (!raw) return [];
  // Unwrap common envelopes.
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.results)) list = obj.results as unknown[];
    else if (Array.isArray(obj.items)) list = obj.items as unknown[];
    else if (Array.isArray(obj.data)) list = obj.data as unknown[];
    else if (Array.isArray(obj.posts)) list = obj.posts as unknown[];
    else if (typeof obj.content === "string") {
      // Some providers return a single text blob — surface it as one item.
      list = [{ content: obj.content, url: obj.url ?? null, title: obj.title ?? null }];
    }
  } else if (typeof raw === "string" && raw.trim()) {
    list = [{ content: raw, url: null, title: null }];
  }
  const out: NormalizedItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as RawSearchItem & Record<string, unknown>;
    const url = (e.url ?? e.link ?? null) as string | null;
    const title = (e.title ?? null) as string | null;
    const snippet = (e.snippet ?? e.content ?? e.description ?? null) as string | null;
    const caption = [title, snippet].filter(Boolean).join(" — ") || null;
    const author = (e.author ?? null) as string | null;
    const source = (e.source ?? null) as string | null;
    const platform = inferPlatform(url ?? undefined, source ?? undefined);
    const externalId = url ? `url:${url}` : null;
    // Extract hashtags from the caption (cheap — no LLM call).
    const hashtags = caption ? extractHashtags(caption) : [];
    // Relevance score — simple presence match against keywords would need
    // the keywords here; we set it null and let the LLM enrichment refine it.
    out.push({
      url,
      caption,
      authorHandle: author,
      authorName: author,
      externalId,
      platform,
      mediaType: null,
      thumbnailUrl: (e.thumbnailUrl ?? e.thumbnail ?? e.image ?? null) as string | null,
      hashtags,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      views: null,
      engagementRate: null,
      relevanceScore: null,
      postedAt: safeDate((e.published ?? e.date ?? null) as string | null),
    });
    if (out.length >= max) break;
  }
  return out;
}

function inferPlatform(url?: string, source?: string): string | null {
  const s = `${url ?? ""} ${source ?? ""}`.toLowerCase();
  if (s.includes("instagram")) return "instagram";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("linkedin")) return "linkedin";
  if (s.includes("youtube") || s.includes("youtu.be")) return "youtube";
  if (s.includes("facebook")) return "facebook";
  return null;
}

function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  const re = /#([\p{L}\d_]{2,40})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.add("#" + m[1]);
  }
  return Array.from(out).slice(0, 12);
}

function safeDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  try {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ── LLM enrichment for one post ──────────────────────────────────────────
// Asks the model to produce a JSON object with: summary, contentAngle,
// hashtags, estimated metrics (likes/comments/views/engagementRate), media
// type, author info. Falls back to plain-text parsing when the LLM ignores
// the JSON instruction.
export type EnrichedPost = {
  summary: string | null;
  contentAngle: string | null;
  hashtags: string[];
  engagementRate: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  authorHandle: string | null;
  authorName: string | null;
  authorFollowers: number | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
};

async function enrichPost(
  item: NormalizedItem,
  ctx: { platforms: string[]; keywords: string[]; sector: string; competitors: string[]; language: string }
): Promise<EnrichedPost> {
  const watchCtx = [
    `Mots-clés surveillés: ${ctx.keywords.join(", ") || "(aucun)"}`,
    `Secteur: ${ctx.sector || "(non précisé)"}`,
    `Plateformes: ${ctx.platforms.join(", ") || "(toutes)"}`,
    ctx.competitors.length ? `Concurrents: ${ctx.competitors.join(", ")}` : null,
    `Langue: ${ctx.language}`,
  ].filter(Boolean).join("\n");
  const postCtx = [
    `URL: ${item.url ?? "(inconnue)"}`,
    `Plateforme (détectée): ${item.platform ?? "(inconnue)"}`,
    `Auteur: ${item.authorHandle ?? "(inconnu)"}`,
    `Caption: ${(item.caption ?? "").slice(0, 600)}`,
    `Hashtags extraits: ${item.hashtags.join(", ") || "(aucun)"}`,
  ].join("\n");

  const system =
    "Tu es un analyste de tendances sociales. À partir d'un post ou d'un article découvert " +
    "via une recherche web, tu produis une analyse concise et un angle marketing réutilisable. " +
    "Réponds UNIQUEMENT en JSON valide avec ce schéma : " +
    '{"summary": "...", "contentAngle": "...", "hashtags": ["..."], "engagementRate": 0.0, ' +
    '"likes": 0, "comments": 0, "shares": 0, "saves": 0, "views": 0, ' +
    '"authorHandle": "...", "authorName": "...", "authorFollowers": 0, ' +
    '"mediaType": "image|video|carousel|reel|article", "thumbnailUrl": "...", "postedAt": "ISO"}';

  const user =
    `Contexte de la veille:\n${watchCtx}\n\nPost découvert:\n${postCtx}\n\n` +
    `Tâches:\n` +
    `1) summary — pourquoi ce post performe (1-2 phrases, en ${ctx.language === "fr" ? "français" : "anglais"}).\n` +
    `2) contentAngle — l'angle marketing réutilisable pour notre marque (1 phrase, en ${ctx.language === "fr" ? "français" : "anglais"}).\n` +
    `3) hashtags — table des hashtags pertinents (avec #).\n` +
    `4) engagementRate, likes, comments, shares, saves, views — estime ces métriques quand elles ne sont pas dans la source (0 sinon).\n` +
    `5) authorHandle, authorName, authorFollowers — quand tu peux les inférer.\n` +
    `6) mediaType — image|video|carousel|reel|article.\n` +
    `7) thumbnailUrl — quand tu en vois une.\n` +
    `8) postedAt — ISO 8601 quand tu peux l'inférer.\n`;

  const res = await textChat({ system, messages: [{ role: "user", content: user }] });
  const text = res.content?.trim() ?? "";
  const parsed = parseLenientJSON(text);
  if (parsed == null) {
    return {
      summary: text.slice(0, 280) || null,
      contentAngle: null,
      hashtags: [],
      engagementRate: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      views: null,
      authorHandle: null,
      authorName: null,
      authorFollowers: null,
      mediaType: null,
      thumbnailUrl: null,
      postedAt: null,
    };
  }
  const o = parsed;
  return {
    summary: typeof o.summary === "string" ? o.summary.slice(0, 400) : null,
    contentAngle: typeof o.contentAngle === "string" ? o.contentAngle.slice(0, 280) : null,
    hashtags: Array.isArray(o.hashtags) ? (o.hashtags as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 12) : [],
    engagementRate: typeof o.engagementRate === "number" ? o.engagementRate : null,
    likes: typeof o.likes === "number" ? o.likes : null,
    comments: typeof o.comments === "number" ? o.comments : null,
    shares: typeof o.shares === "number" ? o.shares : null,
    saves: typeof o.saves === "number" ? o.saves : null,
    views: typeof o.views === "number" ? o.views : null,
    authorHandle: typeof o.authorHandle === "string" ? o.authorHandle : null,
    authorName: typeof o.authorName === "string" ? o.authorName : null,
    authorFollowers: typeof o.authorFollowers === "number" ? o.authorFollowers : null,
    mediaType: typeof o.mediaType === "string" ? o.mediaType : null,
    thumbnailUrl: typeof o.thumbnailUrl === "string" ? o.thumbnailUrl : null,
    postedAt: typeof o.postedAt === "string" ? o.postedAt : null,
  };
}

// Lenient JSON parse: strip ```json fences, then try JSON.parse from the
// first balanced { or [.
function parseLenientJSON(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      try {
        return JSON.parse(s.slice(i)) as Record<string, unknown>;
      } catch {
        // continue searching for a later balanced position
      }
    }
  }
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
