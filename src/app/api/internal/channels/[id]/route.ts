// Make It — GET/PATCH/DELETE /api/internal/channels/[id]
// GET    : one channel with members + unread count.
// PATCH  : rename / set topic (members only).
// DELETE : admin+ only (workspace) / manager+ only (agency).
//
// Scope-aware: workspace channels require an active workspace; agency channels
// require the user to be a member of the channel's agency.

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
  resolveAgency,
  getAgencyContext,
} from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  getChannel,
  updateChannel,
  deleteChannel,
} from "@/server/modules/messaging/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

async function verifyChannelScope(
  channel: {
    workspaceId: string | null;
    agencyId: string | null;
  } | null,
  req: NextRequest,
  userId: string
): Promise<"ok" | "notfound" | "forbidden"> {
  if (!channel) return "notfound";
  if (channel.workspaceId) {
    const ctx = await resolveWorkspace(req);
    if (!ctx) return "forbidden";
    if (channel.workspaceId !== ctx.workspaceId) return "notfound";
    return "ok";
  }
  if (channel.agencyId) {
    const ctx = await getAgencyContext(channel.agencyId, userId);
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

  try {
    const channel = await getChannel(id, user.id);
    if (!channel) return notFound("Canal introuvable");
    const scopeCheck = await verifyChannelScope(channel.channel, req, user.id);
    if (scopeCheck === "notfound") return notFound("Canal introuvable");
    if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");
    return ok(channel, {
      scope: channel.channel.agencyId ? "agency" : "workspace",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture du canal", { error: msg });
  }
}

export async function PATCH(
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

  const patch: { name?: string; topic?: string | null } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return badRequest("`name` doit être une chaîne");
    patch.name = body.name;
  }
  if (body.topic !== undefined) {
    patch.topic = body.topic === null ? null : asString(body.topic);
    if (patch.topic === null && body.topic !== null) return badRequest("`topic` invalide");
  }

  if (Object.keys(patch).length === 0) {
    return badRequest("Aucun champ à mettre à jour (name, topic)");
  }

  try {
    const updated = await updateChannel(id, user.id, patch);
    if (!updated) return notFound("Canal introuvable");
    const scopeCheck = await verifyChannelScope(updated, req, user.id);
    if (scopeCheck === "notfound") return notFound("Canal introuvable");
    if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");
    await audit({
      workspaceId: updated.workspaceId ?? undefined,
      userId: user.id,
      action: "internal.channel.update",
      entity: "InternalChannel",
      entityId: id,
      metadata: {
        patch,
        scope: updated.agencyId ? "agency" : "workspace",
        agencyId: updated.agencyId ?? null,
      },
      ip: clientIp(req),
    });
    return ok({ channel: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("long")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  // For agency-scope deletion, we need to know the agency first to authorize.
  // We peek at the channel via getChannel — if it's an agency channel, ensure
  // the user is an agency member. The actual role check happens inside
  // deleteChannel (admin+ for workspace, manager+ for agency).
  const peek = await getChannel(id, user.id);
  if (!peek) return notFound("Canal introuvable");
  const scopeCheck = await verifyChannelScope(peek.channel, req, user.id);
  if (scopeCheck === "notfound") return notFound("Canal introuvable");
  if (scopeCheck === "forbidden") return forbidden("Accès refusé à ce canal");

  try {
    const deleted = await deleteChannel(id, user.id);
    if (!deleted) return notFound("Canal introuvable");
    await audit({
      workspaceId: peek.channel.workspaceId ?? undefined,
      userId: user.id,
      action: "internal.channel.delete",
      entity: "InternalChannel",
      entityId: id,
      metadata: {
        scope: peek.channel.agencyId ? "agency" : "workspace",
        agencyId: peek.channel.agencyId ?? null,
      },
      ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Rôle insuffisant")) return forbidden(msg);
    return serverError("Échec de la suppression", { error: msg });
  }
}
