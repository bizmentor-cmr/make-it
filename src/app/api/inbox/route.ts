// Make It — GET /api/inbox
// List conversations (filterable by platform, intent; AI-prioritize via ?prioritize=1).
// Returns { conversations: [{id, platform, participantName, participantHandle, intent,
// sentiment, priority, unreadCount, lastMessageAt, lastMessagePreview}] }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { listConversations } from "@/server/modules/inbox/service";

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const platform = asString(url.searchParams.get("platform"));
  const intent = asString(url.searchParams.get("intent"));
  const prioritize = url.searchParams.get("prioritize") === "1" || url.searchParams.get("prioritize") === "true";

  try {
    const conversations = await listConversations(ctx.workspaceId, {
      platform,
      intent,
      prioritize,
    });
    return ok({ conversations }, { count: conversations.length, workspaceId: ctx.workspaceId, prioritize });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de lecture des conversations", { error: msg });
  }
}
