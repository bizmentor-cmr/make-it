// Make It — POST /api/inbox/[id]/messages
// Send an outbound message into a conversation.
// Body: { body, authoredByAi? } → creates an outbound Message + updates lastMessageAt.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { sendMessage } from "@/server/modules/inbox/service";

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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return badRequest("Champ `body` requis");
  if (text.length > 5000) return badRequest("Message trop long (max 5000 caractères)");

  const authoredByAi = typeof body.authoredByAi === "boolean" ? body.authoredByAi : false;

  try {
    const msg = await sendMessage(wsCtx.workspaceId, id, { body: text, authoredByAi });
    if (!msg) return notFound("Conversation introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "inbox.message.send",
      entity: "Message",
      entityId: msg.id,
      metadata: { conversationId: id, authoredByAi, length: text.length },
      ip: clientIp(req),
    });

    return ok({ message: msg }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("vide")) return badRequest(msg);
    return serverError("Échec de l'envoi", { error: msg });
  }
}
