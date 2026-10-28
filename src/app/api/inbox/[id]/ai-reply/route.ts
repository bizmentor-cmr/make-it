// Make It — POST /api/inbox/[id]/ai-reply
// Synchronous AI message analysis + suggested reply.
// Body: { messageId? } → loads the latest inbound message (or the one given),
// calls `analyzeMessage` which uses the "message_analysis" prompt + brand voice,
// reserves + consumes ~3 credits (message_analysis). Persists analysis on the
// inbound Message row. Returns { intent, sentiment, priority, suggestedReply, confidence }.
// If insufficient → 402.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { db } from "@/lib/db";
import { analyzeMessage } from "@/server/modules/inbox/service";
import "@/server/modules/ai/runners"; // side-effect: ensures message_analysis runner registered

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  // Resolve the conversation + scope
  const conv = await db.conversation.findUnique({ where: { id } });
  if (!conv || conv.workspaceId !== wsCtx.workspaceId) {
    return notFound("Conversation introuvable");
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Body optional — defaults to latest inbound message
    body = {};
  }

  const messageId =
    typeof body.messageId === "string" && body.messageId.trim().length > 0
      ? body.messageId.trim()
      : null;

  // Pick the message to analyse
  let messageRow: { id: string; body: string; direction: string } | null = null;
  if (messageId) {
    messageRow = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, body: true, direction: true },
    });
    if (!messageRow) return notFound("Message introuvable");
  } else {
    messageRow = await db.message.findFirst({
      where: { conversationId: id, direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { id: true, body: true, direction: true },
    });
    if (!messageRow) return badRequest("Aucun message entrant à analyser dans cette conversation");
  }

  try {
    const result = await analyzeMessage(wsCtx.workspaceId, {
      message: messageRow.body,
      platform: conv.platform,
      conversationId: id,
      messageId: messageRow.id,
    });

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "inbox.ai.reply",
      entity: "Message",
      entityId: messageRow.id,
      metadata: {
        conversationId: id,
        intent: result.intent,
        sentiment: result.sentiment,
        priority: result.priority,
        confidence: result.confidence,
        consumedCredits: result.consumedCredits,
      },
      ip: clientIp(req),
    });

    return ok(
      {
        intent: result.intent,
        sentiment: result.sentiment,
        priority: result.priority,
        suggestedReply: result.suggestedReply,
        confidence: result.confidence,
        consumedCredits: result.consumedCredits,
      },
      { messageId: messageRow.id, conversationId: id, workspaceId: wsCtx.workspaceId }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INSUFFICIENT_CREDITS") {
      return fail("Crédits insuffisants pour l'analyse de message.", {
        code: "insufficient_credits",
        status: 402,
      });
    }
    if (msg.includes("vide") || msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de l'analyse IA", { error: msg });
  }
}
