// Make It — Internal messaging domain service (Slack-lite).
//
// Channels live at the workspace level (solo mode) OR the agency level
// (agency mode — agencyId set, workspaceId null). In agency mode, channels
// (#général-agence + per-client #client-{name} channels + DMs) are visible
// across all clients — team conversations happen at the agency level.
//
// Pipeline:
//   listChannels(scope, userId)               → ChannelRow[] (auto-seeds #général / #général-agence)
//   getChannel(id, userId)                    → { channel, members, unread }
//   createChannel(scope, name, type, members) → ChannelRow
//   updateChannel(id, userId, patch)          → ChannelRow (rename / topic)
//   deleteChannel(id, userId)                 → void (admin+)
//   listMessages(channelId, userId, pag)      → MessageRow[] (newest last)
//   postMessage(channelId, userId, body, ...) → MessageRow (emits chat:message + mentions)
//   markRead(channelId, userId)               → InternalChannelMember
//   listDirectMessages(scope, userId)         → ChannelRow[] (DMs the user is part of)
//   findOrCreateDM(scope, userIdA, userIdB)   → ChannelRow
//   listWorkspaceMembers(workspaceId)         → MemberRow[]
//   listAgencyMembers(agencyId)               → MemberRow[]
//   listAgencyChannels(agencyId, userId)      → ChannelRow[] (alias for listChannels({agencyId}))
//   createAgencyChannel(agencyId, userId, ...)→ ChannelRow
//   seedClientChannel(agencyId, clientName)   → ChannelRow | null (idempotent)
//
// Unread count = messages where createdAt > member.lastReadAt (or member has
// never read the channel). Used by listChannels + getChannel.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { emitChatMessage } from "@/server/core/realtime";

// ── Types ────────────────────────────────────────────────────────────

export type Scope = { workspaceId?: string | null; agencyId?: string | null };

export type Attachment = {
  kind: "image" | "video" | "audio" | "doc" | "file";
  name: string;
  url: string;
  size?: number;
  mime?: string;
};

export type ChannelRow = {
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  name: string;
  type: string; // channel | dm
  topic: string | null;
  memberCount: number;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  // For DM channels: the OTHER participant (so the UI can render their avatar/name).
  dmWith?: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  channelId: string;
  userId: string;
  userName: string | null;
  userAvatarUrl: string | null;
  body: string;
  attachments: Attachment[];
  mentions: string[];
  replyToId: string | null;
  replyTo?: {
    id: string;
    body: string;
    userName: string | null;
  } | null;
  createdAt: Date;
};

export type MemberRow = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
};

// ── Helpers ──────────────────────────────────────────────────────────

function parseAttachments(v: string | null): Attachment[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((a): a is Attachment => {
      if (!a || typeof a !== "object") return false;
      const o = a as Record<string, unknown>;
      return (
        typeof o.kind === "string" &&
        typeof o.name === "string" &&
        typeof o.url === "string"
      );
    });
  } catch {
    return [];
  }
}

function parseMentions(v: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function scopeWhere(scope: Scope): {
  workspaceId?: string;
  agencyId?: string;
} {
  if (scope.workspaceId) return { workspaceId: scope.workspaceId };
  if (scope.agencyId) return { agencyId: scope.agencyId };
  return {};
}

// Build a deterministic DM channel name from two user ids (sorted). Used as a
// uniqueness key inside a given scope.
export function dmChannelName(a: string, b: string): string {
  return [a, b].sort().join("__");
}

// ── listChannels ─────────────────────────────────────────────────────
// Auto-seeds a "#général" channel with all workspace members when none exist.

export async function listChannels(scope: Scope, userId: string): Promise<ChannelRow[]> {
  // Seed default channel for workspace scope (solo mode) or agency scope.
  if (scope.workspaceId) {
    await seedDefaultChannel(scope, userId);
  } else if (scope.agencyId) {
    await seedDefaultAgencyChannel(scope.agencyId);
  }

  const where = scopeWhere(scope);
  const channels = await db.internalChannel.findMany({
    where,
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });

  // Only include channels the user is a member of for DMs; open channels are
  // visible to everyone in the scope.
  const visible = channels.filter((c) => {
    if (c.type === "dm") {
      return c.members.some((m) => m.userId === userId);
    }
    return true;
  });

  // Compute real unread counts in one parallel pass.
  const unreadEntries = await Promise.all(
    visible.map(async (c) => {
      const membership = c.members.find((m) => m.userId === userId);
      const lastReadAt = membership?.lastReadAt ?? null;
      const unreadCount = await db.internalMessage.count({
        where: lastReadAt
          ? { channelId: c.id, createdAt: { gt: lastReadAt } }
          : { channelId: c.id },
      });
      return { id: c.id, unreadCount };
    })
  );
  const unreadMap = new Map(unreadEntries.map((u) => [u.id, u.unreadCount]));

  // Member count + DM "with" user lookup
  const dmOtherUserIds = new Set<string>();
  for (const c of visible) {
    if (c.type === "dm") {
      const other = c.members.find((m) => m.userId !== userId);
      if (other) dmOtherUserIds.add(other.userId);
    }
  }
  const dmUsers = dmOtherUserIds.size
    ? await db.user.findMany({
        where: { id: { in: Array.from(dmOtherUserIds) } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      })
    : [];
  const dmUserMap = new Map(dmUsers.map((u) => [u.id, u]));

  return visible.map((c) => {
    const membership = c.members.find((m) => m.userId === userId);
    const dmWith =
      c.type === "dm"
        ? (() => {
            const other = c.members.find((m) => m.userId !== userId);
            if (!other) return null;
            const u = dmUserMap.get(other.userId);
            return u
              ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }
              : null;
          })()
        : null;
    return toChannelRow(c, unreadMap.get(c.id) ?? 0, dmWith, membership?.lastReadAt ?? null);
  });
}

function toChannelRow(
  c: {
    id: string;
    workspaceId: string | null;
    agencyId: string | null;
    name: string;
    type: string;
    topic: string | null;
    createdAt: Date;
    updatedAt: Date;
    members: { userId: string; lastReadAt: Date | null }[];
    messages?: { body: string; createdAt: Date }[];
  },
  unreadCount: number,
  dmWith: ChannelRow["dmWith"],
  _lastReadAt: Date | null
): ChannelRow {
  const lastMsg = c.messages && c.messages.length > 0 ? c.messages[0] : null;
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    agencyId: c.agencyId,
    name: c.name,
    type: c.type,
    topic: c.topic,
    memberCount: c.members.length,
    unreadCount,
    lastMessageAt: lastMsg?.createdAt ?? null,
    lastMessagePreview: lastMsg ? lastMsg.body.slice(0, 140) : null,
    dmWith,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ── seedDefaultChannel ───────────────────────────────────────────────
// On first load: if no channels exist for the workspace, create a "#général"
// channel with all workspace members.

async function seedDefaultChannel(scope: Scope, _userId: string): Promise<void> {
  if (!scope.workspaceId) return;
  const count = await db.internalChannel.count({
    where: { workspaceId: scope.workspaceId },
  });
  if (count > 0) return;

  const members = await db.workspaceMember.findMany({
    where: { workspaceId: scope.workspaceId },
    select: { userId: true },
  });
  if (members.length === 0) return;

  try {
    const channel = await db.internalChannel.create({
      data: {
        workspaceId: scope.workspaceId,
        name: "général",
        type: "channel",
        topic: "Canal principal de l'équipe",
      },
    });
    await db.internalChannelMember.createMany({
      data: members.map((m) => ({ channelId: channel.id, userId: m.userId })),
    });
    logger.info("messaging.seed: created default #général channel", {
      workspaceId: scope.workspaceId,
      members: members.length,
    });
  } catch (e) {
    logger.warn("messaging.seed: failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── seedDefaultAgencyChannel ─────────────────────────────────────────
// On first agency access: if no channels exist for the agency, create a
// "#général-agence" channel with all agency members. Idempotent.

export async function seedDefaultAgencyChannel(agencyId: string): Promise<void> {
  const count = await db.internalChannel.count({
    where: { agencyId },
  });
  if (count > 0) return;

  const members = await db.agencyMember.findMany({
    where: { agencyId },
    select: { userId: true },
  });
  if (members.length === 0) return;

  try {
    const channel = await db.internalChannel.create({
      data: {
        agencyId,
        name: "général-agence",
        type: "channel",
        topic: "Canal principal de l'agence — toute l'équipe",
      },
    });
    await db.internalChannelMember.createMany({
      data: members.map((m) => ({ channelId: channel.id, userId: m.userId })),
    });
    logger.info("messaging.seed: created default #général-agence channel", {
      agencyId,
      members: members.length,
    });
  } catch (e) {
    logger.warn("messaging.seed: agency default failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── seedClientChannel ───────────────────────────────────────────────
// Auto-create a `#client-{name}` channel at the agency level for cross-team
// discussion about a specific client. Idempotent (returns the existing row
// if one with the same name already exists in the agency). Called by the
// agency createClient flow.

export async function seedClientChannel(
  agencyId: string,
  clientName: string,
  creatorUserId?: string
): Promise<ChannelRow | null> {
  const clean = (clientName ?? "").trim();
  if (!clean) return null;
  // Use a deterministic slugified name (e.g. "client-cafe-baobab").
  const slug = slugifyChannelName(clean);
  const name = `client-${slug}`;
  const existing = await db.internalChannel.findFirst({
    where: { agencyId, name },
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });
  if (existing) return toChannelRow(existing, 0, null, null);

  // Members: all agency members (open channel).
  const members = await db.agencyMember.findMany({
    where: { agencyId },
    select: { userId: true },
  });
  const memberIds = Array.from(new Set(members.map((m) => m.userId)));
  if (creatorUserId && !memberIds.includes(creatorUserId)) {
    memberIds.push(creatorUserId);
  }

  try {
    const channel = await db.internalChannel.create({
      data: {
        agencyId,
        name,
        type: "channel",
        topic: `Discussion transverse — ${clean}`,
      },
    });
    if (memberIds.length > 0) {
      await db.internalChannelMember.createMany({
        data: memberIds.map((userId) => ({ channelId: channel.id, userId })),
      });
    }
    logger.info("messaging.seed: created #client- channel", { agencyId, name });
    return toChannelRow(
      {
        ...channel,
        members: memberIds.map((userId) => ({ userId, lastReadAt: null })),
        messages: [],
      },
      0,
      null,
      null
    );
  } catch (e) {
    logger.warn("messaging.seed: client channel failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function slugifyChannelName(input: string): string {
  const base = (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  return base || "client";
}

// ── isAgencyMember ──────────────────────────────────────────────────
// Verifies the user is a member of the given agency. Used by getChannel /
// listMessages / postMessage for agency-scope access control (open agency
// channels are visible to all agency members — Slack-lite).

export async function isAgencyMember(agencyId: string, userId: string): Promise<boolean> {
  const m = await db.agencyMember.findUnique({
    where: { agencyId_userId: { agencyId, userId } },
    select: { userId: true },
  });
  return !!m;
}

// ── getChannel ───────────────────────────────────────────────────────

export async function getChannel(id: string, userId: string) {
  const channel = await db.internalChannel.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!channel) return null;

  // Access control: the user must be a member, OR (for workspace channels) be
  // a member of the workspace, OR (for agency channels) be a member of the
  // agency. Slack-lite: open channels within a workspace/agency.
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!isMember) {
    if (channel.workspaceId) {
      const wsMember = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: channel.workspaceId, userId },
        },
        select: { userId: true },
      });
      if (!wsMember) return null;
    } else if (channel.agencyId) {
      const agencyMember = await isAgencyMember(channel.agencyId, userId);
      if (!agencyMember) return null;
    } else {
      return null;
    }
  }

  const membership = channel.members.find((m) => m.userId === userId);
  const lastReadAt = membership?.lastReadAt ?? null;
  const unreadCount = await db.internalMessage.count({
    where: lastReadAt
      ? { channelId: id, createdAt: { gt: lastReadAt } }
      : { channelId: id },
  });

  return {
    channel: {
      id: channel.id,
      workspaceId: channel.workspaceId,
      agencyId: channel.agencyId,
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    },
    members: channel.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      lastReadAt: m.lastReadAt,
      joinedAt: m.joinedAt,
    })),
    unreadCount,
  };
}

// ── createChannel ────────────────────────────────────────────────────

export async function createChannel(
  scope: Scope,
  name: string,
  type: "channel" | "dm",
  memberIds: string[],
  topic?: string | null
): Promise<ChannelRow> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Nom de canal requis");
  if (cleanName.length > 80) throw new Error("Nom trop long (max 80 caractères)");
  if (memberIds.length === 0) throw new Error("Au moins un membre est requis");

  if (!scope.workspaceId && !scope.agencyId) {
    throw new Error("Scope requis (workspaceId ou agencyId)");
  }

  const data: {
    workspaceId?: string | null;
    agencyId?: string | null;
    name: string;
    type: string;
    topic?: string | null;
  } = {
    workspaceId: scope.workspaceId ?? null,
    agencyId: scope.agencyId ?? null,
    name: cleanName,
    type,
  };
  if (topic) data.topic = topic.trim().slice(0, 200);

  const created = await db.internalChannel.create({ data });

  // Dedupe member ids.
  const unique = Array.from(new Set(memberIds));
  if (unique.length > 0) {
    // Use createMany in chunks to avoid skipDuplicates (not supported on
    // SQLite for createMany). We've already deduplicated the ids above.
    await db.internalChannelMember.createMany({
      data: unique.map((userId) => ({ channelId: created.id, userId })),
    });
  }

  const fresh = await db.internalChannel.findUnique({
    where: { id: created.id },
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  if (!fresh) throw new Error("Canal introuvable après création");
  return toChannelRow(fresh, 0, null, null);
}

// ── updateChannel ────────────────────────────────────────────────────

export async function updateChannel(
  id: string,
  userId: string,
  patch: { name?: string; topic?: string | null }
): Promise<ChannelRow | null> {
  const existing = await db.internalChannel.findUnique({
    where: { id },
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  if (!existing) return null;
  if (!existing.members.some((m) => m.userId === userId)) return null;

  const data: { name?: string; topic?: string | null } = {};
  if (typeof patch.name === "string") {
    const n = patch.name.trim();
    if (!n) throw new Error("Nom requis");
    if (n.length > 80) throw new Error("Nom trop long");
    data.name = n;
  }
  if (patch.topic !== undefined) {
    data.topic = patch.topic === null ? null : patch.topic.trim().slice(0, 200);
  }
  if (Object.keys(data).length === 0) {
    return toChannelRow(existing, 0, null, null);
  }

  const updated = await db.internalChannel.update({
    where: { id },
    data,
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  return toChannelRow(updated, 0, null, null);
}

// ── deleteChannel ────────────────────────────────────────────────────

export async function deleteChannel(id: string, userId: string): Promise<boolean> {
  const existing = await db.internalChannel.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!existing) return false;
  if (!existing.members.some((m) => m.userId === userId)) return false;

  // Admin check: for workspace channels, the user must be admin+ in that
  // workspace. For agency channels, the user must be an agency admin/manager.
  if (existing.workspaceId) {
    const wm = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: existing.workspaceId, userId } },
      select: { role: true },
    });
    const role = wm?.role ?? "viewer";
    if (!["owner", "admin"].includes(role)) {
      throw new Error("Rôle insuffisant (admin+ requis pour supprimer un canal)");
    }
  } else if (existing.agencyId) {
    const am = await db.agencyMember.findUnique({
      where: { agencyId_userId: { agencyId: existing.agencyId, userId } },
      select: { role: true },
    });
    const role = (am?.role ?? "creative") as "admin" | "manager" | "creative";
    if (role !== "admin" && role !== "manager") {
      throw new Error("Rôle insuffisant (manager+ requis pour supprimer un canal d'agence)");
    }
  }

  await db.internalChannel.delete({ where: { id } });
  return true;
}

// ── listMessages ─────────────────────────────────────────────────────
// Returns messages oldest → newest, paginated by offset (default 50, max 200).
// ?beforeId cursor supported: only return messages with createdAt < the
// given message's createdAt (used for "load older" infinite scroll).

export async function listMessages(
  channelId: string,
  userId: string,
  opts: { limit?: number; beforeId?: string | null } = {}
): Promise<MessageRow[]> {
  const channel = await db.internalChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return [];
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!isMember && channel.workspaceId) {
    const wm = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: channel.workspaceId, userId },
      },
      select: { userId: true },
    });
    if (!wm) return [];
  } else if (!isMember && channel.agencyId) {
    const am = await isAgencyMember(channel.agencyId, userId);
    if (!am) return [];
  } else if (!isMember) {
    return [];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)));

  let cursor: { createdAt: Date } | null = null;
  if (opts.beforeId) {
    const ref = await db.internalMessage.findUnique({
      where: { id: opts.beforeId },
      select: { createdAt: true },
    });
    if (ref) cursor = { createdAt: ref.createdAt };
  }

  const rows = await db.internalMessage.findMany({
    where: {
      channelId,
      ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  // Resolve reply previews in one shot.
  const replyIds = rows
    .map((r) => r.replyToId)
    .filter((x): x is string => Boolean(x));
  const replies = replyIds.length
    ? await db.internalMessage.findMany({
        where: { id: { in: replyIds } },
        include: {
          user: { select: { name: true } },
        },
      })
    : [];
  const replyMap = new Map(replies.map((r) => [r.id, r]));

  // Reverse to oldest → newest for display.
  return rows
    .map((m) => {
      const reply = m.replyToId ? replyMap.get(m.replyToId) : null;
      return {
        id: m.id,
        channelId: m.channelId,
        userId: m.userId,
        userName: m.user.name,
        userAvatarUrl: m.user.avatarUrl,
        body: m.body,
        attachments: parseAttachments(m.attachments),
        mentions: parseMentions(m.mentions),
        replyToId: m.replyToId,
        replyTo: reply
          ? { id: reply.id, body: reply.body, userName: reply.user.name }
          : null,
        createdAt: m.createdAt,
      } satisfies MessageRow;
    })
    .reverse();
}

// ── postMessage ──────────────────────────────────────────────────────
// Persists the message, emits `chat:message` to the channel's scope room,
// and notifies mentioned users (best-effort).

export async function postMessage(
  channelId: string,
  userId: string,
  body: string,
  opts: {
    attachments?: Attachment[];
    mentions?: string[];
    replyToId?: string | null;
  } = {}
): Promise<MessageRow> {
  const text = (body ?? "").trim();
  if (!text && (!opts.attachments || opts.attachments.length === 0)) {
    throw new Error("Message vide");
  }
  if (text.length > 5000) throw new Error("Message trop long (max 5000)");

  const channel = await db.internalChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) throw new Error("Canal introuvable");

  // Access control.
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!isMember && channel.workspaceId) {
    const wm = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: channel.workspaceId, userId },
      },
      select: { userId: true },
    });
    if (!wm) throw new Error("Accès refusé à ce canal");
  } else if (!isMember && channel.agencyId) {
    const am = await isAgencyMember(channel.agencyId, userId);
    if (!am) throw new Error("Accès refusé à ce canal");
  } else if (!isMember) {
    throw new Error("Accès refusé à ce canal");
  }

  // Validate reply target.
  let replyToId: string | null = null;
  if (opts.replyToId) {
    const parent = await db.internalMessage.findUnique({
      where: { id: opts.replyToId },
      select: { id: true, channelId: true },
    });
    if (parent && parent.channelId === channelId) replyToId = parent.id;
  }

  // Sanitize mentions: must be members of the channel (or workspace / agency co-members).
  const memberSet = new Set(channel.members.map((m) => m.userId));
  let mentions = (opts.mentions ?? []).filter((id) => typeof id === "string" && id.length > 0);
  if (mentions.length && channel.workspaceId) {
    const wsMembers = await db.workspaceMember.findMany({
      where: { workspaceId: channel.workspaceId },
      select: { userId: true },
    });
    const wsSet = new Set(wsMembers.map((m) => m.userId));
    mentions = mentions.filter((id) => memberSet.has(id) || wsSet.has(id));
  } else if (mentions.length && channel.agencyId) {
    const agencyMembers = await db.agencyMember.findMany({
      where: { agencyId: channel.agencyId },
      select: { userId: true },
    });
    const agencySet = new Set(agencyMembers.map((m) => m.userId));
    mentions = mentions.filter((id) => memberSet.has(id) || agencySet.has(id));
  } else {
    mentions = mentions.filter((id) => memberSet.has(id));
  }
  // Dedupe.
  mentions = Array.from(new Set(mentions));

  const created = await db.internalMessage.create({
    data: {
      channelId,
      userId,
      body: text || "(pièce jointe)",
      attachments: JSON.stringify(opts.attachments ?? []),
      mentions: JSON.stringify(mentions),
      replyToId,
    },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  // Touch the channel's updatedAt so list ordering stays correct.
  await db.internalChannel.update({
    where: { id: channelId },
    data: { updatedAt: created.createdAt },
  });

  // Build the row + emit real-time.
  let replyTo: MessageRow["replyTo"] = null;
  if (replyToId) {
    const parent = await db.internalMessage.findUnique({
      where: { id: replyToId },
      include: { user: { select: { name: true } } },
    });
    if (parent) {
      replyTo = { id: parent.id, body: parent.body, userName: parent.user.name };
    }
  }

  const row: MessageRow = {
    id: created.id,
    channelId: created.channelId,
    userId: created.userId,
    userName: created.user.name,
    userAvatarUrl: created.user.avatarUrl,
    body: created.body,
    attachments: parseAttachments(created.attachments),
    mentions,
    replyToId: created.replyToId,
    replyTo,
    createdAt: created.createdAt,
  };

  // Emit chat:message to the workspace or agency room (best-effort).
  const scope: Scope = channel.workspaceId
    ? { workspaceId: channel.workspaceId }
    : channel.agencyId
    ? { agencyId: channel.agencyId }
    : {};
  try {
    void emitChatMessage(scope, {
      id: row.id,
      channelId: row.channelId,
      userId: row.userId,
      userName: row.userName,
      userAvatarUrl: row.userAvatarUrl,
      body: row.body,
      attachments: row.attachments,
      mentions: row.mentions,
      replyToId: row.replyToId,
      replyTo: row.replyTo,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    logger.warn("messaging.postMessage: emit failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Notify mentioned users (fire-and-forget; uses the notifications service).
  // Agency-scoped channels don't have a workspaceId, so we skip the persisted
  // notification (the realtime `chat:message` event is enough — the agency
  // room subscriber will bump the unread badge + toast).
  if (mentions.length > 0 && channel.workspaceId) {
    try {
      const { createNotification } = await import("@/server/modules/notifications/service");
      for (const mentionUserId of mentions) {
        if (mentionUserId === userId) continue; // don't notify self
        void createNotification(channel.workspaceId ?? "", {
          userId: mentionUserId,
          type: "mention",
          title: "Vous avez été mentionné",
          body: `${row.userName ?? "Quelqu'un"} vous a mentionné dans #${channel.name}`,
          level: "info",
          refId: row.id,
        });
      }
    } catch (e) {
      logger.warn("messaging.postMessage: mention notify failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return row;
}

// ── markRead ─────────────────────────────────────────────────────────

export async function markRead(channelId: string, userId: string) {
  const channel = await db.internalChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return null;
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!isMember) {
    // Auto-join (Slack-lite: open channels within a workspace / agency).
    if (channel.workspaceId) {
      const wm = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: channel.workspaceId, userId },
        },
        select: { userId: true },
      });
      if (!wm) return null;
      await db.internalChannelMember.create({
        data: { channelId, userId, lastReadAt: new Date() },
      });
      return { channelId, userId, lastReadAt: new Date() };
    } else if (channel.agencyId) {
      const am = await isAgencyMember(channel.agencyId, userId);
      if (!am) return null;
      await db.internalChannelMember.create({
        data: { channelId, userId, lastReadAt: new Date() },
      });
      return { channelId, userId, lastReadAt: new Date() };
    }
    return null;
  }

  const updated = await db.internalChannelMember.update({
    where: { channelId_userId: { channelId, userId } },
    data: { lastReadAt: new Date() },
  });
  return updated;
}

// ── listDirectMessages ───────────────────────────────────────────────

export async function listDirectMessages(scope: Scope, userId: string): Promise<ChannelRow[]> {
  const where = { ...scopeWhere(scope), type: "dm" as const };
  const channels = await db.internalChannel.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });
  const mine = channels.filter((c) => c.members.some((m) => m.userId === userId));

  const otherIds = new Set<string>();
  for (const c of mine) {
    const other = c.members.find((m) => m.userId !== userId);
    if (other) otherIds.add(other.userId);
  }
  const users = otherIds.size
    ? await db.user.findMany({
        where: { id: { in: Array.from(otherIds) } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Real unread counts
  const unreadEntries = await Promise.all(
    mine.map(async (c) => {
      const membership = c.members.find((m) => m.userId === userId);
      const lastReadAt = membership?.lastReadAt ?? null;
      const unreadCount = await db.internalMessage.count({
        where: lastReadAt
          ? { channelId: c.id, createdAt: { gt: lastReadAt } }
          : { channelId: c.id },
      });
      return { id: c.id, unreadCount };
    })
  );
  const unreadMap = new Map(unreadEntries.map((u) => [u.id, u.unreadCount]));

  return mine.map((c) => {
    const other = c.members.find((m) => m.userId !== userId);
    const u = other ? userMap.get(other.userId) : null;
    return toChannelRow(
      c,
      unreadMap.get(c.id) ?? 0,
      u
        ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }
        : null,
      null
    );
  });
}

// ── findOrCreateDM ───────────────────────────────────────────────────
// Find or create a DM channel between the current user and `otherUserId`.

export async function findOrCreateDM(
  scope: Scope,
  userId: string,
  otherUserId: string
): Promise<ChannelRow> {
  if (userId === otherUserId) throw new Error("Impossible de créer un DM avec vous-même");
  if (!scope.workspaceId && !scope.agencyId) {
    throw new Error("Scope requis (workspaceId ou agencyId)");
  }

  // Verify the other user is a co-member of the workspace/agency.
  if (scope.workspaceId) {
    const otherMember = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: scope.workspaceId, userId: otherUserId },
      },
      select: { userId: true },
    });
    if (!otherMember) throw new Error("Utilisateur introuvable dans ce workspace");
  } else if (scope.agencyId) {
    const otherMember = await db.agencyMember.findUnique({
      where: {
        agencyId_userId: { agencyId: scope.agencyId, userId: otherUserId },
      },
      select: { userId: true },
    });
    if (!otherMember) throw new Error("Utilisateur introuvable dans cette agence");
  }

  const name = dmChannelName(userId, otherUserId);
  const where = {
    ...scopeWhere(scope),
    type: "dm" as const,
    name,
  };
  const existing = await db.internalChannel.findFirst({
    where,
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  if (existing) {
    const otherUser = await db.user.findUnique({
      where: { id: otherUserId },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    return toChannelRow(existing, 0, otherUser, null);
  }

  // Create
  const created = await db.internalChannel.create({
    data: {
      workspaceId: scope.workspaceId ?? null,
      agencyId: scope.agencyId ?? null,
      name,
      type: "dm",
    },
  });
  await db.internalChannelMember.createMany({
    data: [
      { channelId: created.id, userId },
      { channelId: created.id, userId: otherUserId },
    ],
  });
  const fresh = await db.internalChannel.findUnique({
    where: { id: created.id },
    include: {
      members: { select: { userId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  const otherUser = await db.user.findUnique({
    where: { id: otherUserId },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  if (!fresh) {
    // Fallback: build a minimal ChannelRow from `created` (no members/messages
    // loaded — they were just inserted; the UI will refetch on select).
    return {
      id: created.id,
      workspaceId: created.workspaceId,
      agencyId: created.agencyId,
      name: created.name,
      type: created.type,
      topic: created.topic,
      memberCount: 2,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      dmWith: otherUser,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }
  return toChannelRow(fresh, 0, otherUser, null);
}

// ── listWorkspaceMembers / listAgencyMembers ─────────────────────────

export async function listWorkspaceMembers(workspaceId: string): Promise<MemberRow[]> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
  }));
}

export async function listAgencyMembers(agencyId: string): Promise<MemberRow[]> {
  const members = await db.agencyMember.findMany({
    where: { agencyId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
  }));
}

// ── listAgencyChannels / createAgencyChannel ─────────────────────────
// Convenience wrappers for the agency-scoped messaging UI. They verify the
// user is an agency member before returning / mutating data, then delegate
// to the existing scope-aware functions.

export async function listAgencyChannels(
  agencyId: string,
  userId: string
): Promise<{ channels: ChannelRow[]; dms: ChannelRow[] }> {
  const member = await isAgencyMember(agencyId, userId);
  if (!member) return { channels: [], dms: [] };
  const [channels, dms] = await Promise.all([
    listChannels({ agencyId }, userId),
    listDirectMessages({ agencyId }, userId),
  ]);
  return { channels, dms };
}

export async function createAgencyChannel(
  agencyId: string,
  userId: string,
  opts: {
    name: string;
    type?: "channel" | "dm";
    memberIds?: string[];
    topic?: string | null;
  }
): Promise<ChannelRow> {
  const member = await isAgencyMember(agencyId, userId);
  if (!member) throw new Error("Accès refusé à cette agence");
  // The creator is always a member.
  const memberIds = Array.from(
    new Set([...(opts.memberIds ?? []), userId])
  );
  return createChannel(
    { agencyId },
    opts.name,
    opts.type ?? "channel",
    memberIds,
    opts.topic ?? null
  );
}

export type { Scope as MessagingScope };
