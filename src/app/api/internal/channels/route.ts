// Make It — GET/POST /api/internal/channels
// GET  : list channels + DMs. Scope:
//        - `?scope=agency` (or X-Agency-Id header) → agency-scoped channels
//          (#général-agence + per-client #client-{name} channels + DMs).
//        - otherwise → workspace-scoped channels (solo mode, auto-seeds #général).
// POST : create a channel. Body:
//        - Agency scope: { agencyId, name, type?, memberIds?, topic? }
//        - Workspace scope: { name, type?, memberIds?, topic? }
//
// Both modes return `{ channels, dms }` for the user's accessible channels.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, resolveAgency } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  listChannels,
  listDirectMessages,
  createChannel,
  listAgencyChannels,
  createAgencyChannel,
  type Attachment,
} from "@/server/modules/messaging/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isAgencyScope(req: NextRequest): boolean {
  const url = new URL(req.url);
  return (
    url.searchParams.get("scope") === "agency" ||
    !!req.headers.get("x-agency-id") ||
    url.searchParams.has("agencyId")
  );
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  if (isAgencyScope(req)) {
    const ctx = await resolveAgency(req);
    if (!ctx) return forbidden("Accès agence requis");
    try {
      const { channels, dms } = await listAgencyChannels(ctx.agencyId, user.id);
      return ok(
        { channels, dms },
        { agencyId: ctx.agencyId, userId: user.id, scope: "agency" }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return serverError("Échec de lecture des canaux d'agence", { error: msg });
    }
  }

  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  try {
    const [channels, dms] = await Promise.all([
      listChannels({ workspaceId: ctx.workspaceId }, user.id),
      listDirectMessages({ workspaceId: ctx.workspaceId }, user.id),
    ]);
    return ok(
      { channels, dms },
      { workspaceId: ctx.workspaceId, userId: user.id, scope: "workspace" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture des canaux", { error: msg });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = asString(body.name);
  if (!name) return badRequest("Champ `name` requis");
  const type = body.type === "dm" ? "dm" : "channel";
  const topic = asString(body.topic);
  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  // Agency scope: explicit `agencyId` in body OR `?scope=agency` / X-Agency-Id header.
  const agencyIdFromBody = asString(body.agencyId);
  const wantsAgency =
    agencyIdFromBody || isAgencyScope(req);

  if (wantsAgency) {
    // Resolve the agency from header/query OR fall back to the body agencyId.
    let agencyId = agencyIdFromBody;
    if (!agencyId) {
      const ctx = await resolveAgency(req);
      if (!ctx) return forbidden("Accès agence requis");
      agencyId = ctx.agencyId;
    }
    try {
      const channel = await createAgencyChannel(agencyId, user.id, {
        name,
        type,
        memberIds,
        topic,
      });
      await audit({
        userId: user.id,
        action: "internal.channel.create",
        entity: "InternalChannel",
        entityId: channel.id,
        metadata: {
          agencyId,
          name,
          type,
          members: memberIds.length,
          topic: topic ?? null,
          scope: "agency",
        },
        ip: clientIp(req),
      });
      return ok(
        { channel },
        { created: true, scope: "agency", agencyId },
        { status: 201 }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("refusé") || msg.includes("agence")) return forbidden(msg);
      if (msg.includes("requis") || msg.includes("long") || msg.includes("vide")) {
        return badRequest(msg);
      }
      return serverError("Échec de création du canal d'agence", { error: msg });
    }
  }

  // Workspace scope (solo mode).
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  // The creator is always a member.
  if (!memberIds.includes(user.id)) memberIds.push(user.id);

  try {
    const channel = await createChannel(
      { workspaceId: ctx.workspaceId },
      name,
      type,
      memberIds,
      topic
    );
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "internal.channel.create",
      entity: "InternalChannel",
      entityId: channel.id,
      metadata: { name, type, members: memberIds.length, topic: topic ?? null },
      ip: clientIp(req),
    });
    return ok({ channel }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("long") || msg.includes("vide")) {
      return badRequest(msg);
    }
    return serverError("Échec de création du canal", { error: msg });
  }
}

export type { Attachment };
