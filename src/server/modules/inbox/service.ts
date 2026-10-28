// Make It — Inbox domain service.
// Conversation + Message + Interaction helpers used by the inbox routes.
//
// Pipeline (documented for future subagents):
//   listConversations(ws, {platform, intent, prioritize}) → ConversationRow[]
//   getConversation(ws, id)                                → { conversation, messages }
//   sendMessage(ws, id, {body, authoredByAi})               → MessageRow (outbound)
//   analyzeMessage(ws, {message, platform, messageId, conversationId}) → AnalysisResult
//   prioritizeConversations(rows)                          → ConversationRow[] sorted by intent weight
//
// Intent priority weights used when `prioritize=1`:
//   purchase > question > praise > support > spam
//
// AI analysis is synchronous: estimates cost via estimateCost("message_analysis", 1) (≈3 credits),
// checks available balance, calls textChat with the "message_analysis" prompt template
// (brand-voice aware via buildBrandContext), parses lenient JSON, persists the analysis on the
// Message row (intent/sentiment/suggestedReply/aiAnalyzed=true), and consumes the credits
// synchronously (no reservation — the call is short and synchronous).

import { db } from "@/lib/db";
import { textChat } from "@/server/core/ai";
import { getPrompt, renderTemplate } from "@/server/core/prompts";
import { estimateCost } from "@/server/core/ai-cost";
import { getWallet, availableBalance, consumeCredits } from "@/server/core/credits";
import { jsonStringify } from "@/server/core/types";
import { buildBrandContext } from "@/server/modules/ai/orchestrator";
import { logger } from "@/server/core/logger";

// ── Types ────────────────────────────────────────────────────────────

export type ConversationRow = {
  id: string;
  platform: string;
  socialAccountId: string | null;
  externalId: string | null;
  participantName: string | null;
  participantHandle: string | null;
  participantAvatarUrl: string | null;
  intent: string | null;
  sentiment: string | null;
  priority: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  externalId: string | null;
  direction: string;
  body: string;
  intent: string | null;
  sentiment: string | null;
  suggestedReply: string | null;
  aiAnalyzed: boolean;
  authoredByAi: boolean;
  createdAt: Date;
};

export type InteractionRow = {
  id: string;
  workspaceId: string;
  type: string;
  platform: string;
  externalId: string | null;
  contentId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  body: string | null;
  intent: string | null;
  sentiment: string | null;
  suggestedReply: string | null;
  status: string;
  createdAt: Date;
};

export type AnalysisResult = {
  intent: string;
  sentiment: string;
  priority: string;
  suggestedReply: string | null;
  confidence: number;
  consumedCredits: number;
};

// ── Constants ────────────────────────────────────────────────────────

export const INTENT_PRIORITY: Record<string, number> = {
  purchase: 100,
  question: 80,
  praise: 60,
  support: 40,
  complaint: 30,
  info_request: 25,
  spam: 5,
};

const ALLOWED_INTENTS = new Set([
  "purchase",
  "question",
  "praise",
  "support",
  "complaint",
  "info_request",
  "spam",
]);
const ALLOWED_PRIORITIES = new Set(["high", "medium", "low"]);
const ALLOWED_SENTIMENTS = new Set(["positive", "neutral", "negative"]);

// ── Helpers ──────────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function normalizeIntent(v: string | null): string | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  return ALLOWED_INTENTS.has(lower) ? lower : null;
}
function normalizeSentiment(v: string | null): string | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  return ALLOWED_SENTIMENTS.has(lower) ? lower : null;
}
function normalizePriority(v: string | null): string | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  return ALLOWED_PRIORITIES.has(lower) ? lower : null;
}

// Lenient JSON parse: strip ```json fences, try/parse, fallback to plain text.
function parseLenient<T = unknown>(raw: string): T | string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      try {
        return JSON.parse(s.slice(i)) as T;
      } catch {
        // try next position
      }
    }
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return s;
  }
}

function toConversationRow(c: {
  id: string;
  platform: string;
  socialAccountId: string | null;
  externalId: string | null;
  participantName: string | null;
  participantHandle: string | null;
  participantAvatarUrl: string | null;
  intent: string | null;
  sentiment: string | null;
  priority: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: { body: string; createdAt: Date }[];
}): ConversationRow {
  const lastMsg = c.messages && c.messages.length > 0 ? c.messages[0] : null;
  return {
    id: c.id,
    platform: c.platform,
    socialAccountId: c.socialAccountId,
    externalId: c.externalId,
    participantName: c.participantName,
    participantHandle: c.participantHandle,
    participantAvatarUrl: c.participantAvatarUrl,
    intent: c.intent,
    sentiment: c.sentiment,
    priority: c.priority,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: lastMsg ? lastMsg.body.slice(0, 280) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function toMessageRow(m: {
  id: string;
  conversationId: string;
  externalId: string | null;
  direction: string;
  body: string;
  intent: string | null;
  sentiment: string | null;
  suggestedReply: string | null;
  aiAnalyzed: boolean;
  authoredByAi: boolean;
  createdAt: Date;
}): MessageRow {
  return {
    id: m.id,
    conversationId: m.conversationId,
    externalId: m.externalId,
    direction: m.direction,
    body: m.body,
    intent: m.intent,
    sentiment: m.sentiment,
    suggestedReply: m.suggestedReply,
    aiAnalyzed: m.aiAnalyzed,
    authoredByAi: m.authoredByAi,
    createdAt: m.createdAt,
  };
}

// ── listConversations ───────────────────────────────────────────────

export async function listConversations(
  workspaceId: string,
  opts: { platform?: string | null; intent?: string | null; prioritize?: boolean } = {}
): Promise<ConversationRow[]> {
  const where: {
    workspaceId: string;
    platform?: string;
    intent?: string;
  } = { workspaceId };
  if (opts.platform && opts.platform.length > 0) where.platform = opts.platform;
  if (opts.intent && opts.intent.length > 0) {
    const intent = normalizeIntent(opts.intent);
    if (!intent) throw new Error("Intent invalide");
    where.intent = intent;
  }

  const rows = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });

  const mapped = rows.map(toConversationRow);
  if (opts.prioritize) return prioritizeConversations(mapped);
  return mapped;
}

// ── prioritizeConversations ──────────────────────────────────────────
// Sort by (unread DESC, intent weight DESC, lastMessageAt DESC).
// Intent weights: purchase > question > praise > support > spam.

export function prioritizeConversations(rows: ConversationRow[]): ConversationRow[] {
  const weighted = rows.map((r) => ({
    row: r,
    score:
      (r.unreadCount > 0 ? 1000 : 0) +
      (INTENT_PRIORITY[r.intent ?? ""] ?? 0) +
      (r.priority === "high" ? 50 : r.priority === "medium" ? 25 : 0) +
      Math.min(100, (r.lastMessageAt ? Date.now() - r.lastMessageAt.getTime() : Date.now()) === 0 ? 100 : 0),
  }));
  // Secondary sort key: more recent first (lower timestamp offset = newer)
  weighted.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const at = a.row.lastMessageAt?.getTime() ?? 0;
    const bt = b.row.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
  return weighted.map((w) => w.row);
}

// ── getConversation ──────────────────────────────────────────────────

export async function getConversation(workspaceId: string, id: string) {
  const conv = await db.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      socialAccount: { select: { id: true, platform: true, handle: true, accountName: true } },
    },
  });
  if (!conv || conv.workspaceId !== workspaceId) return null;
  return {
    conversation: toConversationRow(conv),
    messages: conv.messages.map(toMessageRow),
    socialAccount: conv.socialAccount,
  };
}

// ── updateConversationMetadata ───────────────────────────────────────

export async function updateConversationMetadata(
  workspaceId: string,
  id: string,
  patch: { priority?: string | null; intent?: string | null }
) {
  const existing = await db.conversation.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;

  const data: Record<string, unknown> = {};
  if (patch.priority !== undefined) {
    const norm = patch.priority === null ? null : normalizePriority(patch.priority);
    if (norm === null && patch.priority !== null) throw new Error("Priorité invalide");
    data.priority = norm;
  }
  if (patch.intent !== undefined) {
    const norm = patch.intent === null ? null : normalizeIntent(patch.intent);
    if (norm === null && patch.intent !== null) throw new Error("Intent invalide");
    data.intent = norm;
  }
  if (Object.keys(data).length === 0) return toConversationRow(existing);

  const updated = await db.conversation.update({ where: { id }, data });
  return toConversationRow(updated);
}

// ── sendMessage ──────────────────────────────────────────────────────
// Creates an outbound Message + bumps the conversation's lastMessageAt.

export async function sendMessage(
  workspaceId: string,
  conversationId: string,
  input: { body: string; authoredByAi?: boolean }
): Promise<MessageRow | null> {
  const body = input.body?.trim();
  if (!body) throw new Error("Message vide");
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.workspaceId !== workspaceId) return null;

  const created = await db.message.create({
    data: {
      conversationId,
      direction: "outbound",
      body,
      authoredByAi: Boolean(input.authoredByAi),
    },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: created.createdAt, unreadCount: 0 },
  });
  return toMessageRow(created);
}

// ── listInteractions ─────────────────────────────────────────────────

export async function listInteractions(
  workspaceId: string,
  opts: { type?: string | null; intent?: string | null; status?: string | null; limit?: number } = {}
): Promise<InteractionRow[]> {
  const where: {
    workspaceId: string;
    type?: string;
    intent?: string;
    status?: string;
  } = { workspaceId };
  if (opts.type && opts.type.length > 0) where.type = opts.type;
  if (opts.intent && opts.intent.length > 0) {
    const intent = normalizeIntent(opts.intent);
    if (!intent) throw new Error("Intent invalide");
    where.intent = intent;
  }
  if (opts.status && opts.status.length > 0) {
    const allowed = new Set(["new", "handled", "ignored"]);
    if (!allowed.has(opts.status)) throw new Error("Statut d'interaction invalide");
    where.status = opts.status;
  }

  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 100)));
  const rows = await db.interaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    type: r.type,
    platform: r.platform,
    externalId: r.externalId,
    contentId: r.contentId,
    authorName: r.authorName,
    authorHandle: r.authorHandle,
    body: r.body,
    intent: r.intent,
    sentiment: r.sentiment,
    suggestedReply: r.suggestedReply,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

// ── getInteraction ───────────────────────────────────────────────────

export async function getInteraction(workspaceId: string, id: string): Promise<InteractionRow | null> {
  const r = await db.interaction.findUnique({ where: { id } });
  if (!r || r.workspaceId !== workspaceId) return null;
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    type: r.type,
    platform: r.platform,
    externalId: r.externalId,
    contentId: r.contentId,
    authorName: r.authorName,
    authorHandle: r.authorHandle,
    body: r.body,
    intent: r.intent,
    sentiment: r.sentiment,
    suggestedReply: r.suggestedReply,
    status: r.status,
    createdAt: r.createdAt,
  };
}

export async function updateInteractionStatus(
  workspaceId: string,
  id: string,
  status: string
): Promise<InteractionRow | null> {
  const allowed = new Set(["new", "handled", "ignored"]);
  if (!allowed.has(status)) throw new Error("Statut d'interaction invalide");
  const existing = await db.interaction.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;
  const updated = await db.interaction.update({ where: { id }, data: { status } });
  return {
    id: updated.id,
    workspaceId: updated.workspaceId,
    type: updated.type,
    platform: updated.platform,
    externalId: updated.externalId,
    contentId: updated.contentId,
    authorName: updated.authorName,
    authorHandle: updated.authorHandle,
    body: updated.body,
    intent: updated.intent,
    sentiment: updated.sentiment,
    suggestedReply: updated.suggestedReply,
    status: updated.status,
    createdAt: updated.createdAt,
  };
}

// ── analyzeMessage ───────────────────────────────────────────────────
// Synchronous AI message analysis. Reserve + consume ~3 credits (message_analysis).
// Returns { intent, sentiment, priority, suggestedReply, confidence }.
// Persists analysis on the inbound Message row (when messageId given).

export async function analyzeMessage(
  workspaceId: string,
  input: { message: string; platform?: string; conversationId?: string | null; messageId?: string | null }
): Promise<AnalysisResult> {
  const message = (input.message ?? "").trim();
  if (!message) throw new Error("Message vide");

  const platform = input.platform ?? "instagram";

  // Estimate + check credits
  const estimate = await estimateCost("message_analysis", 1);
  const wallet = await getWallet(workspaceId);
  const avail = availableBalance(wallet);
  if (avail < estimate.estimated) {
    throw new Error("INSUFFICIENT_CREDITS");
  }

  const tpl = await getPrompt("message_analysis", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { message, platform, brand_voice: brand })
    : `Message : ${message}\nPlateforme : ${platform}\nVoix de marque : ${brand}`;

  const res = await textChat({
    system:
      tpl?.systemPrompt ??
      "Tu analyses un message entrant. Réponds en JSON : {\"intent\":...,\"sentiment\":...,\"priority\":...,\"suggested_reply\":...,\"confidence\":0..1}",
    messages: [{ role: "user", content: user }],
  });

  const parsed = parseLenient<{
    intent?: string;
    sentiment?: string;
    priority?: string;
    suggested_reply?: string;
    confidence?: number;
  }>(res.content ?? "{}");

  const out: AnalysisResult =
    typeof parsed === "string"
      ? {
          intent: "question",
          sentiment: "neutral",
          priority: "low",
          suggestedReply: parsed.slice(0, 2000),
          confidence: 0.5,
          consumedCredits: estimate.estimated,
        }
      : {
          intent: normalizeIntent(parsed.intent ?? "question") ?? "question",
          sentiment: normalizeSentiment(parsed.sentiment ?? "neutral") ?? "neutral",
          priority: normalizePriority(parsed.priority ?? "low") ?? "low",
          suggestedReply: asString(parsed.suggested_reply) ?? null,
          confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
          consumedCredits: estimate.estimated,
        };

  // Persist on the Message row when an id is provided
  if (input.messageId) {
    try {
      const msg = await db.message.findUnique({ where: { id: input.messageId } });
      if (msg) {
        await db.message.update({
          where: { id: input.messageId },
          data: {
            intent: out.intent,
            sentiment: out.sentiment,
            suggestedReply: out.suggestedReply,
            aiAnalyzed: true,
          },
        });
      }
    } catch (e) {
      logger.warn("inbox.analyzeMessage: persist failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Bump conversation intent + priority when conversationId given
  if (input.conversationId) {
    try {
      const conv = await db.conversation.findUnique({ where: { id: input.conversationId } });
      if (conv && conv.workspaceId === workspaceId) {
        await db.conversation.update({
          where: { id: input.conversationId },
          data: {
            intent: conv.intent ?? out.intent,
            sentiment: conv.sentiment ?? out.sentiment,
            priority: conv.priority ?? out.priority,
          },
        });
      }
    } catch (e) {
      logger.warn("inbox.analyzeMessage: conv update failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Consume credits synchronously (no reservation — short call)
  const refId = `msg_analysis_${Date.now()}`;
  await consumeCredits(workspaceId, estimate.estimated, estimate.estimated, "message_analysis", refId);

  return out;
}

// Re-exports used by routes (jsonStringify for serialising nested bodies when needed)
export { jsonStringify };
