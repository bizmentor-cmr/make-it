// Make It — GET / PATCH /api/inbox/[id]
// GET   : one conversation with messages (ordered by createdAt asc).
// PATCH : update metadata (priority, intent).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getConversation, updateConversationMetadata } from "@/server/modules/inbox/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  const result = await getConversation(wsCtx.workspaceId, id);
  if (!result) return notFound("Conversation introuvable");

  return ok(result, { workspaceId: wsCtx.workspaceId });
}

export async function PATCH(
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

  const patch: { priority?: string | null; intent?: string | null } = {};
  if (body.priority !== undefined) patch.priority = body.priority === null ? null : asString(body.priority);
  if (body.intent !== undefined) patch.intent = body.intent === null ? null : asString(body.intent);

  if (Object.keys(patch).length === 0) {
    return badRequest("Aucun champ à mettre à jour (priority, intent)");
  }

  try {
    const updated = await updateConversationMetadata(wsCtx.workspaceId, id, patch);
    if (!updated) return notFound("Conversation introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "inbox.conversation.update",
      entity: "Conversation",
      entityId: id,
      metadata: { patch },
      ip: clientIp(req),
    });

    return ok({ conversation: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}
