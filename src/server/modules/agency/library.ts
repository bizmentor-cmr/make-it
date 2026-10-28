// Make It — Agency Library domain service (P5).
//
// The agency library is the "treasure chest" of the agency's best content —
// assets copied from individual client libraries (text posts, images, videos,
// carousels, templates) that have proven reusable across clients. Each asset
// tracks:
//   - origin (which client workspace + content id it was copied from)
//   - reuseCount (how many times it was forked into a client library)
//   - performanceScore (avg performance when reused — 0-100)
//
// Pipeline:
//   listAgencyLibrary(agencyId, {kind?, search?, tags?, sort?})
//     → { assets, summary }
//   copyToAgencyLibrary(agencyId, workspaceId, {contentId?, mediaId?, kind,
//                                                title, content, thumb, tags?})
//     → AgencyLibraryAsset (records originWorkspaceId + originContentId)
//   forkFromAgencyLibrary(agencyId, targetWorkspaceId, assetId, userId)
//     → { content: ContentRow } | { media: MediaAsset } (created in target)
//   updateAgencyLibraryAsset(agencyId, assetId, {title?, tags?, content?})
//     → AgencyLibraryAsset
//   deleteAgencyLibraryAsset(agencyId, assetId)
//     → boolean
//   trackReuse(agencyId, assetId)
//     → AgencyLibraryAsset (increments reuseCount, called automatically by fork)
//
// All operations are tenant-aware (scoped by agencyId) and verify the caller's
// agency membership + (for fork) the target client access.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import {
  AGENCY_ROLE_RANK,
  type AgencyRole,
} from "@/server/core/rbac";

// ─────────────────────────── types ───────────────────────────

export type AssetKind = "text" | "image" | "video" | "carousel" | "template";

export const ASSET_KINDS: readonly AssetKind[] = [
  "text",
  "image",
  "video",
  "carousel",
  "template",
] as const;

export type AgencyLibraryAssetRow = {
  id: string;
  agencyId: string;
  kind: AssetKind;
  title: string;
  originWorkspaceId: string | null;
  originContentId: string | null;
  originClientName: string | null;
  content: Record<string, unknown> | null;
  thumb: string | null;
  tags: string[];
  performanceScore: number | null;
  reuseCount: number;
  createdAt: string;
};

export type AgencyLibrarySummary = {
  totalAssets: number;
  totalReuses: number;
  avgPerformance: number | null;
  mostReused: {
    id: string;
    title: string;
    reuseCount: number;
  } | null;
};

export type AgencyLibraryList = {
  assets: AgencyLibraryAssetRow[];
  summary: AgencyLibrarySummary;
};

export type CopyToLibraryInput = {
  contentId?: string | null;
  mediaId?: string | null;
  kind: AssetKind;
  title: string;
  content?: Record<string, unknown> | null;
  thumb?: string | null;
  tags?: string[];
};

export type ForkResult =
  | { kind: "content"; contentId: string; workspaceId: string }
  | { kind: "media"; mediaId: string; workspaceId: string };

// ─────────────────────────── helpers ───────────────────────────

function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === "string" && (ASSET_KINDS as readonly string[]).includes(v);
}

function parseTags(v: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseContent(v: string | null): Record<string, unknown> | null {
  if (!v) return null;
  try {
    const obj = JSON.parse(v) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function toRow(
  a: {
    id: string;
    agencyId: string;
    kind: string;
    title: string;
    originWorkspaceId: string | null;
    originContentId: string | null;
    content: string | null;
    thumb: string | null;
    tags: string | null;
    performanceScore: number | null;
    reuseCount: number;
    createdAt: Date;
  },
  originClientName: string | null
): AgencyLibraryAssetRow {
  return {
    id: a.id,
    agencyId: a.agencyId,
    kind: isAssetKind(a.kind) ? a.kind : "text",
    title: a.title,
    originWorkspaceId: a.originWorkspaceId,
    originContentId: a.originContentId,
    originClientName,
    content: parseContent(a.content),
    thumb: a.thumb,
    tags: parseTags(a.tags),
    performanceScore: a.performanceScore,
    reuseCount: a.reuseCount,
    createdAt: a.createdAt.toISOString(),
  };
}

async function resolveOriginClientName(
  originWorkspaceId: string | null
): Promise<string | null> {
  if (!originWorkspaceId) return null;
  const ws = await db.workspace.findUnique({
    where: { id: originWorkspaceId },
    select: { name: true },
  });
  return ws?.name ?? null;
}

// ─────────────────────────── listAgencyLibrary ───────────────────────────

export async function listAgencyLibrary(
  agencyId: string,
  opts: {
    kind?: AssetKind | null;
    search?: string | null;
    tags?: string[] | null;
    sort?: "recent" | "most-reused" | "best-performance";
  } = {}
): Promise<AgencyLibraryList> {
  const where: {
    agencyId: string;
    kind?: string;
    OR?: Array<Record<string, unknown>>;
  } = { agencyId };
  if (opts.kind && isAssetKind(opts.kind)) where.kind = opts.kind;
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { title: { contains: q } },
      { tags: { contains: q } },
    ];
  }

  // Tag filter (best-effort substring match on the JSON array — SQLite doesn't
  // have a native array-contains op, so we use `contains` on the raw JSON).
  if (opts.tags && opts.tags.length > 0) {
    const tagClauses = opts.tags.map((t) => ({ tags: { contains: `"${t}"` } }));
    where.OR = [...(where.OR ?? []), ...tagClauses];
  }

  const sort = opts.sort ?? "recent";
  const orderBy: Record<string, "desc" | "asc"> =
    sort === "most-reused"
      ? { reuseCount: "desc" }
      : sort === "best-performance"
      ? { performanceScore: "desc" }
      : { createdAt: "desc" };

  const rows = await db.agencyLibraryAsset.findMany({
    where,
    orderBy,
  });

  // Resolve origin client names in one batched query.
  const originIds = Array.from(
    new Set(rows.map((r) => r.originWorkspaceId).filter((x): x is string => !!x))
  );
  const workspaces = originIds.length
    ? await db.workspace.findMany({
        where: { id: { in: originIds } },
        select: { id: true, name: true },
      })
    : [];
  const wsMap = new Map(workspaces.map((w) => [w.id, w.name]));

  const assets = rows.map((r) => toRow(r, r.originWorkspaceId ? wsMap.get(r.originWorkspaceId) ?? null : null));

  // Summary.
  const totalAssets = assets.length;
  const totalReuses = assets.reduce((s, a) => s + a.reuseCount, 0);
  const perfScores = assets
    .map((a) => a.performanceScore)
    .filter((x): x is number => x !== null && Number.isFinite(x));
  const avgPerformance =
    perfScores.length > 0
      ? Math.round(perfScores.reduce((s, x) => s + x, 0) / perfScores.length)
      : null;
  const mostReused =
    assets.length > 0
      ? assets.reduce((m, a) => (a.reuseCount > m.reuseCount ? a : m))
      : null;

  return {
    assets,
    summary: {
      totalAssets,
      totalReuses,
      avgPerformance,
      mostReused: mostReused
        ? {
            id: mostReused.id,
            title: mostReused.title,
            reuseCount: mostReused.reuseCount,
          }
        : null,
    },
  };
}

// ─────────────────────────── copyToAgencyLibrary ───────────────────────────
// Copies an asset from a client's library into the agency library. Records
// originWorkspaceId + originContentId (for traceability). Idempotent — if the
// same contentId is already in the agency library, returns the existing row.

export async function copyToAgencyLibrary(
  agencyId: string,
  workspaceId: string,
  input: CopyToLibraryInput
): Promise<AgencyLibraryAssetRow> {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("Titre requis");
  if (!isAssetKind(input.kind)) throw new Error("Type d'asset invalide");

  // Verify the origin workspace belongs to the agency (tenant isolation).
  const client = await db.agencyClient.findUnique({
    where: { workspaceId },
    select: { id: true, agencyId: true },
  });
  if (!client || client.agencyId !== agencyId) {
    throw new Error("Workspace ne appartient pas à cette agence");
  }

  // Idempotent: if the same contentId was already copied, return the existing row.
  if (input.contentId) {
    const existing = await db.agencyLibraryAsset.findFirst({
      where: {
        agencyId,
        originContentId: input.contentId,
        originWorkspaceId: workspaceId,
      },
    });
    if (existing) {
      const originName = await resolveOriginClientName(existing.originWorkspaceId);
      return toRow(existing, originName);
    }
  }

  const created = await db.agencyLibraryAsset.create({
    data: {
      agencyId,
      kind: input.kind,
      title: title.slice(0, 200),
      originWorkspaceId: workspaceId,
      originContentId: input.contentId ?? null,
      content: input.content ? JSON.stringify(input.content) : null,
      thumb: input.thumb ?? null,
      tags: JSON.stringify(Array.from(new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean)))),
      performanceScore: null,
      reuseCount: 0,
    },
  });

  logger.info("agency.library: copied asset", {
    agencyId,
    workspaceId,
    assetId: created.id,
    kind: created.kind,
    title: created.title,
  });

  return toRow(created, await resolveOriginClientName(created.originWorkspaceId));
}

// ─────────────────────────── forkFromAgencyLibrary ───────────────────────────
// Copies an agency library asset INTO a target client's library — creates a
// new Content (for text/carousel/template kinds) OR a new MediaAsset (for
// image/video kinds) in the target workspace, ready to edit. Increments the
// asset's reuseCount + updates performanceScore (best-effort).

export async function forkFromAgencyLibrary(
  agencyId: string,
  targetWorkspaceId: string,
  assetId: string,
  userId: string
): Promise<ForkResult> {
  // Verify agency membership.
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
  });
  if (!member) throw new Error("Accès refusé à cette agence");

  // Verify the asset belongs to the agency.
  const asset = await db.agencyLibraryAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.agencyId !== agencyId) {
    throw new Error("Asset introuvable dans cette agence");
  }

  // Verify the target workspace is an agency client the user has access to.
  const client = await db.agencyClient.findUnique({
    where: { workspaceId: targetWorkspaceId },
    include: { accesses: { select: { userId: true } } },
  });
  if (!client || client.agencyId !== agencyId) {
    throw new Error("Workspace cible ne appartient pas à cette agence");
  }
  const role = (member.role as AgencyRole) ?? "creative";
  const hasAccess =
    role === "admin" ||
    role === "manager" ||
    client.accesses.some((a) => a.userId === userId);
  if (!hasAccess) {
    throw new Error("Accès refusé à ce client");
  }

  // Determine the content type for the target workspace.
  // text/carousel/template → Content; image/video → Content with appropriate
  // type (we keep the asset's body / prompt inside Content.metadata).
  const contentTypeMap: Record<AssetKind, string> = {
    text: "text",
    image: "image",
    video: "video",
    carousel: "carousel",
    template: "text",
  };
  const contentType = contentTypeMap[isAssetKind(asset.kind) ? asset.kind : "text"];

  // Create the Content row in the target workspace.
  const content = await db.content.create({
    data: {
      workspaceId: targetWorkspaceId,
      type: contentType,
      title: `${asset.title} (copie agence)`,
      status: "draft",
      aiGenerated: false,
      sourceContentId: asset.originContentId ?? null,
      platforms: JSON.stringify([]),
      metadata: asset.content ?? JSON.stringify({ fromAgencyLibrary: true, agencyAssetId: asset.id }),
    },
  });

  // If the asset has a thumb (image url), attach a MediaAsset too (best-effort).
  let mediaId: string | null = null;
  if (asset.thumb && (asset.kind === "image" || asset.kind === "video")) {
    try {
      const media = await db.mediaAsset.create({
        data: {
          workspaceId: targetWorkspaceId,
          kind: asset.kind,
          filename: asset.title.slice(0, 60) || "agency-asset",
          mimeType: asset.kind === "image" ? "image/jpeg" : "video/mp4",
          storagePath: asset.thumb,
          contentId: content.id,
        },
      });
      mediaId = media.id;
    } catch (e) {
      logger.warn("agency.library: fork media attach failed", {
        assetId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Increment reuseCount + (best-effort) refresh performanceScore.
  await trackReuse(agencyId, assetId);

  logger.info("agency.library: forked asset", {
    agencyId,
    assetId,
    targetWorkspaceId,
    contentId: content.id,
    mediaId,
    userId,
  });

  if (mediaId) {
    return { kind: "media", mediaId, workspaceId: targetWorkspaceId };
  }
  return { kind: "content", contentId: content.id, workspaceId: targetWorkspaceId };
}

// ─────────────────────────── trackReuse ───────────────────────────

export async function trackReuse(
  agencyId: string,
  assetId: string
): Promise<void> {
  try {
    await db.agencyLibraryAsset.update({
      where: { id: assetId },
      data: { reuseCount: { increment: 1 } },
    });
  } catch (e) {
    logger.warn("agency.library: trackReuse failed", {
      assetId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ─────────────────────────── updateAgencyLibraryAsset ───────────────────────────

export async function updateAgencyLibraryAsset(
  agencyId: string,
  assetId: string,
  patch: {
    title?: string;
    tags?: string[];
    content?: Record<string, unknown> | null;
    performanceScore?: number | null;
  },
  userId: string,
  userRole: AgencyRole
): Promise<AgencyLibraryAssetRow> {
  // Admins + managers can edit; creatives can't.
  if (AGENCY_ROLE_RANK[userRole] < AGENCY_ROLE_RANK.manager) {
    throw new Error("Rôle insuffisant (manager+ requis)");
  }
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
  });
  if (!member) throw new Error("Accès refusé à cette agence");

  const asset = await db.agencyLibraryAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.agencyId !== agencyId) {
    throw new Error("Asset introuvable");
  }

  const data: {
    title?: string;
    tags?: string;
    content?: string | null;
    performanceScore?: number | null;
  } = {};
  if (typeof patch.title === "string") {
    const t = patch.title.trim();
    if (!t) throw new Error("Titre requis");
    data.title = t.slice(0, 200);
  }
  if (Array.isArray(patch.tags)) {
    data.tags = JSON.stringify(
      Array.from(new Set(patch.tags.map((s) => s.trim()).filter(Boolean)))
    );
  }
  if (patch.content !== undefined) {
    data.content = patch.content === null ? null : JSON.stringify(patch.content);
  }
  if (patch.performanceScore !== undefined) {
    data.performanceScore =
      patch.performanceScore === null
        ? null
        : Math.max(0, Math.min(100, Math.round(patch.performanceScore)));
  }

  if (Object.keys(data).length === 0) {
    return toRow(asset, await resolveOriginClientName(asset.originWorkspaceId));
  }

  const updated = await db.agencyLibraryAsset.update({
    where: { id: assetId },
    data,
  });
  return toRow(updated, await resolveOriginClientName(updated.originWorkspaceId));
}

// ─────────────────────────── deleteAgencyLibraryAsset ───────────────────────────

export async function deleteAgencyLibraryAsset(
  agencyId: string,
  assetId: string,
  userId: string,
  userRole: AgencyRole
): Promise<boolean> {
  // Only admins can delete agency library assets.
  if (userRole !== "admin") {
    throw new Error("Rôle insuffisant (admin requis)");
  }
  const member = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
  });
  if (!member) throw new Error("Accès refusé à cette agence");

  const asset = await db.agencyLibraryAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.agencyId !== agencyId) return false;

  await db.agencyLibraryAsset.delete({ where: { id: assetId } });
  return true;
}

// ─────────────────────────── getAgencyLibraryAsset ───────────────────────────

export async function getAgencyLibraryAsset(
  agencyId: string,
  assetId: string
): Promise<AgencyLibraryAssetRow | null> {
  const asset = await db.agencyLibraryAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.agencyId !== agencyId) return null;
  return toRow(asset, await resolveOriginClientName(asset.originWorkspaceId));
}

// ─────────────────────────── findSimilarByTitle (anti-waste suggestion) ───────────────────────────
// Returns up to 3 agency library assets whose title overlaps with the given
// query (used by the "Similaire dans la bibliothèque agence" hint when a user
// is about to copy a new asset).

export async function findSimilarByTitle(
  agencyId: string,
  query: string,
  limit = 3
): Promise<AgencyLibraryAssetRow[]> {
  const q = (query ?? "").trim();
  if (!q) return [];
  // Pull a larger pool then rank by simple token overlap (SQLite doesn't have
  // full-text search built-in without extra setup; this is good enough for
  // the anti-waste hint).
  const pool = await db.agencyLibraryAsset.findMany({
    where: {
      agencyId,
      OR: [
        { title: { contains: q } },
        { tags: { contains: q } },
      ],
    },
    orderBy: { reuseCount: "desc" },
    take: 12,
  });

  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const scored = pool
    .map((p) => {
      const titleTokens = p.title.toLowerCase().split(/\s+/);
      const overlap = tokens.filter((t) =>
        titleTokens.some((tt) => tt.includes(t))
      ).length;
      return { p, score: overlap };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const workspaces = await db.workspace.findMany({
    where: {
      id: {
        in: Array.from(
          new Set(
            scored
              .map((x) => x.p.originWorkspaceId)
              .filter((x): x is string => !!x)
          )
        ),
      },
    },
    select: { id: true, name: true },
  });
  const wsMap = new Map(workspaces.map((w) => [w.id, w.name]));

  return scored.map((x) =>
    toRow(
      x.p,
      x.p.originWorkspaceId ? wsMap.get(x.p.originWorkspaceId) ?? null : null
    )
  );
}
