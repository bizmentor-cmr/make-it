// Make It — POST /api/internal/channels/[id]/read
// Mark a channel as read (updates lastReadAt on the membership row).
// Auto-joins the channel if the user is a workspace / agency co-member but not
// yet a channel member (Slack-lite: open channels within a workspace / agency).
//
// Scope-aware: works for both workspace and agency channels.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, getAgencyContext } from "@/server/core/rbac";
import { markRead, getChannel } from "@/server/modules/messaging/service";

async function verifyChannelScope(
  channelId: string,
  userId: string,
  req: NextRequest
): Promise<"ok" | "notfound" | "forbidden"> {
  const peek = await getChannel(channelId, userId);
  if (!peek) return "notfound";
  if (peek.channel.workspaceId) {
    const ctx = await resolveWorkspace(req);
    if (!ctx) return "forbidden";
    if (peek.channel.workspaceId !== ctx.workspaceId) return "notfound";
    return "ok";
  }
  if (peek.channel.agencyId) {
    const ctx = await getAgencyContext(peek.channel.agencyId, userId);
    if (!ctx) return "forbidden";
    return "ok";
  }
  return "notfound";
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scopeCheck = await verifyChannelScope(id, user.id, req);
  if (scopeCheck === "notfound") return notFound("Canal introuvable");
  if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");

  try {
    const updated = await markRead(id, user.id);
    if (!updated) return notFound("Canal introuvable");
    return ok({ read: true, channelId: id, lastReadAt: updated.lastReadAt ?? new Date() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de marquage lu", { error: msg });
  }
}
