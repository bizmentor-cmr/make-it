// Make It — Content domain service.
// `listContent`, `createContent`, `updateContent`, `duplicateContent`, `createVersion`, `restoreVersion`.
// All operations are scoped by workspaceId.

import { db } from "@/lib/db";
import { jsonParse, jsonStringify } from "@/server/core/types";

// ── List with filters + pagination ──────────────────────────────────────
export type ListContentFilters = {
  type?: string;
  status?: string;
  objective?: string;
  campaignId?: string;
  parentContentId?: string | null;
  search?: string;
  page: number;
  limit: number;
};

export type ContentRow = {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  description: string | null;
  objective: string | null;
  pillar: string | null;
  campaignId: string | null;
  status: string;
  aiGenerated: boolean;
  sourceContentId: string | null;
  parentContentId: string | null;
  platforms: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  versionCount: number;
};

function toRow(c: {
  id: string; workspaceId: string; type: string; title: string; description: string | null;
  objective: string | null; pillar: string | null; campaignId: string | null; status: string;
  aiGenerated: boolean; sourceContentId: string | null; parentContentId: string | null;
  platforms: string | null; metadata: string | null; createdAt: Date; updatedAt: Date;
  _count?: { versions: number };
}): ContentRow {
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    type: c.type,
    title: c.title,
    description: c.description,
    objective: c.objective,
    pillar: c.pillar,
    campaignId: c.campaignId,
    status: c.status,
    aiGenerated: c.aiGenerated,
    sourceContentId: c.sourceContentId,
    parentContentId: c.parentContentId,
    platforms: jsonParse<string[]>(c.platforms, []),
    metadata: jsonParse<Record<string, unknown>>(c.metadata, {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    versionCount: c._count?.versions ?? 0,
  };
}

export async function listContent(workspaceId: string, filters: ListContentFilters) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.objective) where.objective = filters.objective;
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.parentContentId !== undefined) where.parentContentId = filters.parentContentId;
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { description: { contains: filters.search } },
    ];
  }

  const [total, items] = await Promise.all([
    db.content.count({ where }),
    db.content.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      include: { _count: { select: { versions: true } } },
    }),
  ]);
  return {
    items: items.map(toRow),
    total,
    page: filters.page,
    limit: filters.limit,
    pages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

// ── Create ──────────────────────────────────────────────────────────────
export type CreateContentInput = {
  type: string;
  title: string;
  description?: string | null;
  objective?: string | null;
  pillar?: string | null;
  campaignId?: string | null;
  status?: string;
  aiGenerated?: boolean;
  platforms?: string[];
  metadata?: Record<string, unknown>;
  parentContentId?: string | null;
};

export async function createContent(workspaceId: string, input: CreateContentInput) {
  const c = await db.content.create({
    data: {
      workspaceId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      objective: input.objective ?? null,
      pillar: input.pillar ?? null,
      campaignId: input.campaignId ?? null,
      status: input.status ?? "draft",
      aiGenerated: input.aiGenerated ?? false,
      parentContentId: input.parentContentId ?? null,
      platforms: jsonStringify(input.platforms ?? []),
      metadata: jsonStringify(input.metadata ?? {}),
    },
  });
  return toRow({ ...c, _count: { versions: 0 } });
}

// ── Get single ──────────────────────────────────────────────────────────
export async function getContent(workspaceId: string, id: string): Promise<ContentRow | null> {
  const c = await db.content.findUnique({
    where: { id },
    include: { _count: { select: { versions: true } } },
  });
  if (!c || c.workspaceId !== workspaceId) return null;
  return toRow(c);
}

// ── Update ──────────────────────────────────────────────────────────────
export type UpdateContentInput = Partial<CreateContentInput>;

export async function updateContent(workspaceId: string, id: string, patch: UpdateContentInput): Promise<ContentRow | null> {
  const existing = await db.content.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;
  const data: Record<string, unknown> = {};
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description ?? null;
  if (patch.objective !== undefined) data.objective = patch.objective ?? null;
  if (patch.pillar !== undefined) data.pillar = patch.pillar ?? null;
  if (patch.campaignId !== undefined) data.campaignId = patch.campaignId ?? null;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.aiGenerated !== undefined) data.aiGenerated = patch.aiGenerated;
  if (patch.platforms !== undefined) data.platforms = jsonStringify(patch.platforms ?? []);
  if (patch.metadata !== undefined) data.metadata = jsonStringify(patch.metadata ?? {});
  if (patch.parentContentId !== undefined) data.parentContentId = patch.parentContentId ?? null;
  const c = await db.content.update({ where: { id }, data, include: { _count: { select: { versions: true } } } });
  return toRow(c);
}

// ── Delete ───────────────────────────────────────────────────────────────
export async function deleteContent(workspaceId: string, id: string): Promise<boolean> {
  const existing = await db.content.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return false;
  await db.content.delete({ where: { id } });
  return true;
}

// ── Duplicate ────────────────────────────────────────────────────────────
// New id, status draft, title + " (copie)".
export async function duplicateContent(workspaceId: string, id: string): Promise<ContentRow | null> {
  const existing = await db.content.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;
  const dup = await db.content.create({
    data: {
      workspaceId,
      type: existing.type,
      title: `${existing.title} (copie)`,
      description: existing.description,
      objective: existing.objective,
      pillar: existing.pillar,
      campaignId: existing.campaignId,
      status: "draft",
      aiGenerated: existing.aiGenerated,
      sourceContentId: existing.id,
      parentContentId: existing.parentContentId,
      platforms: existing.platforms,
      metadata: existing.metadata,
    },
    include: { _count: { select: { versions: true } } },
  });
  return toRow(dup);
}

// ── Versions ─────────────────────────────────────────────────────────────
export type VersionRow = {
  id: string;
  contentId: string;
  version: number;
  prompt: string | null;
  contentData: Record<string, unknown>;
  createdById: string | null;
  createdAt: Date;
};

function toVersion(v: {
  id: string; contentId: string; version: number; prompt: string | null;
  contentData: string | null; createdById: string | null; createdAt: Date;
}): VersionRow {
  return {
    ...v,
    contentData: jsonParse<Record<string, unknown>>(v.contentData, {}),
  };
}

export async function listVersions(workspaceId: string, contentId: string): Promise<VersionRow[] | null> {
  const c = await db.content.findUnique({ where: { id: contentId } });
  if (!c || c.workspaceId !== workspaceId) return null;
  const versions = await db.contentVersion.findMany({
    where: { contentId },
    orderBy: { version: "desc" },
  });
  return versions.map(toVersion);
}

export async function createVersion(
  workspaceId: string,
  contentId: string,
  data: { prompt?: string; contentData?: Record<string, unknown>; createdById?: string }
): Promise<VersionRow | null> {
  const c = await db.content.findUnique({ where: { id: contentId } });
  if (!c || c.workspaceId !== workspaceId) return null;
  const latest = await db.contentVersion.findFirst({
    where: { contentId },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  const v = await db.contentVersion.create({
    data: {
      contentId,
      version: nextVersion,
      prompt: data.prompt ?? null,
      contentData: jsonStringify(data.contentData ?? {}),
      createdById: data.createdById ?? null,
    },
  });
  return toVersion(v);
}

export async function getVersion(workspaceId: string, contentId: string, versionId: string): Promise<VersionRow | null> {
  const c = await db.content.findUnique({ where: { id: contentId } });
  if (!c || c.workspaceId !== workspaceId) return null;
  const v = await db.contentVersion.findUnique({ where: { id: versionId } });
  if (!v || v.contentId !== contentId) return null;
  return toVersion(v);
}

// Restore a version: creates a NEW version copying the old contentData.
export async function restoreVersion(
  workspaceId: string,
  contentId: string,
  versionId: string,
  createdById?: string
): Promise<VersionRow | null> {
  const old = await getVersion(workspaceId, contentId, versionId);
  if (!old) return null;
  return createVersion(workspaceId, contentId, { prompt: old.prompt ?? undefined, contentData: old.contentData, createdById });
}
