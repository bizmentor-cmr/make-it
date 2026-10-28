// Make It — GET/POST /api/internal/channels/[id]/messages
// GET  : paginated messages (newest last). ?limit=50&beforeId=... for older.
// POST : send a message (body, attachments?, mentions?, replyToId?).
//        Persists + emits `chat:message` to the channel's scope room + notifies
//        mentioned users (workspace scope only — agency scope relies on the
//        realtime event since notifications require a workspaceId).
//
// Scope-aware: works for both workspace and agency channels. The user must be
// a channel member OR a co-member of the channel's workspace/agency.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import {
  resolveWorkspace,
  getAgencyContext,
} from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  listMessages,
  postMessage,
  getChannel,
  type Attachment,
} from "@/server/modules/messaging/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeAttachments(v: unknown): Attachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Attachment[] = [];
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (
      typeof o.kind === "string" &&
      typeof o.name === "string" &&
      typeof o.url === "string"
    ) {
      out.push({
        kind: o.kind as Attachment["kind"],
        name: o.name,
        url: o.url,
        size: typeof o.size === "number" ? o.size : undefined,
        mime: typeof o.mime === "string" ? o.mime : undefined,
      });
    }
  }
  return out;
}

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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
  const beforeId = url.searchParams.get("beforeId");

  const scopeCheck = await verifyChannelScope(id, user.id, req);
  if (scopeCheck === "notfound") return notFound("Canal introuvable");
  if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");

  try {
    const messages = await listMessages(id, user.id, {
      limit,
      beforeId: beforeId || null,
    });
    return ok({ messages }, { channelId: id, count: messages.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture des messages", { error: msg });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  const attachments = normalizeAttachments(body.attachments);
  const mentions = Array.isArray(body.mentions)
    ? body.mentions.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const replyToId =
    typeof body.replyToId === "string" && body.replyToId.length > 0
      ? body.replyToId
      : null;

  if (!text && (!attachments || attachments.length === 0)) {
    return badRequest("Champ `body` ou `attachments` requis");
  }

  const scopeCheck = await verifyChannelScope(id, user.id, req);
  if (scopeCheck === "notfound") return notFound("Canal introuvable");
  if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");

  // Peek the channel again to capture workspaceId / agencyId for the audit log.
  const peek = await getChannel(id, user.id);

  try {
    const message = await postMessage(id, user.id, text, {
      attachments,
      mentions,
      replyToId,
    });
    await audit({
      workspaceId: peek?.channel.workspaceId ?? undefined,
      userId: user.id,
      action: "internal.message.post",
      entity: "InternalMessage",
      entityId: message.id,
      metadata: {
        channelId: id,
        length: text.length,
        attachments: attachments?.length ?? 0,
        mentions: mentions.length,
        replyToId,
        scope: peek?.channel.agencyId ? "agency" : "workspace",
        agencyId: peek?.channel.agencyId ?? null,
      },
      ip: clientIp(req),
    });
    return ok({ message }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("vide") ||
      msg.includes("long") ||
      msg.includes("refusé") ||
      msg.includes("introuvable")
    ) {
      if (msg.includes("refusé")) return forbidden(msg);
      if (msg.includes("introuvable")) return notFound(msg);
      return badRequest(msg);
    }
    return serverError("Échec de l'envoi du message", { error: msg });
  }
}
