// Make It — Notifications service.
// Persists a Notification row + emits `notification:new` real-time event to the workspace room.
// Used by automations, reports, publishing, and other modules to surface user-facing alerts.

import { db } from "@/lib/db";
import { emitNotification } from "@/server/core/realtime";
import { logger } from "@/server/core/logger";

export type NotificationLevel = "info" | "success" | "warning" | "danger";

export type NotificationInput = {
  userId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  level?: NotificationLevel;
  refId?: string | null;
};

export type NotificationRow = {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: string;
  title: string;
  body: string | null;
  level: string;
  read: boolean;
  refId: string | null;
  createdAt: Date;
};

const ALLOWED_LEVELS = new Set<NotificationLevel>(["info", "success", "warning", "danger"]);

function toRow(n: {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: string;
  title: string;
  body: string | null;
  level: string;
  read: boolean;
  refId: string | null;
  createdAt: Date;
}): NotificationRow {
  return {
    id: n.id,
    workspaceId: n.workspaceId,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    level: n.level,
    read: n.read,
    refId: n.refId,
    createdAt: n.createdAt,
  };
}

// ── createNotification ───────────────────────────────────────────────
// Persist + emit `notification:new` real-time (fire-and-forget, never blocks).

export async function createNotification(
  workspaceId: string,
  input: NotificationInput
): Promise<NotificationRow> {
  if (!input.title || !input.title.trim()) throw new Error("Titre requis");
  const level: NotificationLevel = input.level ?? "info";
  if (!ALLOWED_LEVELS.has(level)) throw new Error("Niveau invalide");

  const created = await db.notification.create({
    data: {
      workspaceId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title.trim(),
      body: input.body ?? null,
      level,
      refId: input.refId ?? null,
      read: false,
    },
  });
  const row = toRow(created);
  emitNotification(workspaceId, {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body ?? undefined,
    level: row.level,
  }).catch((e) => logger.warn("notifications: emit failed", { error: e instanceof Error ? e.message : String(e) }));
  return row;
}

// ── listNotifications ────────────────────────────────────────────────
// Filter by read / level / type; newest first; paginated.

export async function listNotifications(
  workspaceId: string,
  opts: {
    read?: boolean | null;
    level?: string | null;
    type?: string | null;
    page?: number;
    limit?: number;
  } = {}
): Promise<{ items: NotificationRow[]; total: number; page: number; limit: number; pages: number }> {
  const page = Math.max(1, Math.min(1000, Math.floor(opts.page ?? 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));

  const where: {
    workspaceId: string;
    read?: boolean;
    level?: string;
    type?: string;
  } = { workspaceId };
  if (opts.read !== null && opts.read !== undefined) where.read = opts.read;
  if (opts.level && ALLOWED_LEVELS.has(opts.level as NotificationLevel)) where.level = opts.level;
  if (opts.type && opts.type.length > 0) where.type = opts.type;

  const [total, items] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    items: items.map(toRow),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── markRead / markUnread ────────────────────────────────────────────

export async function setRead(workspaceId: string, id: string, read: boolean): Promise<NotificationRow | null> {
  const existing = await db.notification.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;
  const updated = await db.notification.update({ where: { id }, data: { read } });
  return toRow(updated);
}

// ── markAllRead ──────────────────────────────────────────────────────

export async function markAllRead(workspaceId: string): Promise<{ updated: number }> {
  const r = await db.notification.updateMany({
    where: { workspaceId, read: false },
    data: { read: true },
  });
  return { updated: r.count };
}

// ── deleteNotification ───────────────────────────────────────────────

export async function deleteNotification(workspaceId: string, id: string): Promise<boolean> {
  const existing = await db.notification.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return false;
  await db.notification.delete({ where: { id } });
  return true;
}
