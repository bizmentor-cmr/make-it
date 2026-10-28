// Make It — POST /api/internal/dm
// Find or create a DM channel with another user.
// Body: { userId, agencyId? }
//   - `agencyId` (or `?scope=agency` / X-Agency-Id header) → agency-scoped DM.
//   - otherwise → workspace-scoped DM (within the active workspace).
// Returns { channel } (with `dmWith` populated).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, resolveAgency } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { findOrCreateDM } from "@/server/modules/messaging/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isAgencyScope(req: NextRequest, body: Record<string, unknown>): boolean {
  const url = new URL(req.url);
  return (
    url.searchParams.get("scope") === "agency" ||
    !!req.headers.get("x-agency-id") ||
    url.searchParams.has("agencyId") ||
    !!asString(body.agencyId)
  );
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

  const otherUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!otherUserId) return badRequest("Champ `userId` requis");

  if (isAgencyScope(req, body)) {
    let agencyId = asString(body.agencyId);
    if (!agencyId) {
      const ctx = await resolveAgency(req);
      if (!ctx) return forbidden("Accès agence requis");
      agencyId = ctx.agencyId;
    }
    try {
      const channel = await findOrCreateDM({ agencyId }, user.id, otherUserId);
      await audit({
        userId: user.id,
        action: "internal.dm.open",
        entity: "InternalChannel",
        entityId: channel.id,
        metadata: {
          otherUserId,
          scope: "agency",
          agencyId,
          created: channel.createdAt.getTime() === channel.updatedAt.getTime(),
        },
        ip: clientIp(req),
      });
      return ok(
        { channel },
        {
          created: channel.createdAt.getTime() === channel.updatedAt.getTime(),
          scope: "agency",
        }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("introuvable") || msg.includes("vous-même")) return notFound(msg);
      if (msg.includes("requis")) return badRequest(msg);
      return serverError("Échec de l'ouverture du DM", { error: msg });
    }
  }

  // Workspace scope.
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const channel = await findOrCreateDM(
      { workspaceId: ctx.workspaceId },
      user.id,
      otherUserId
    );
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "internal.dm.open",
      entity: "InternalChannel",
      entityId: channel.id,
      metadata: {
        otherUserId,
        created: channel.createdAt.getTime() === channel.updatedAt.getTime(),
      },
      ip: clientIp(req),
    });
    return ok(
      { channel },
      { created: channel.createdAt.getTime() === channel.updatedAt.getTime() }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("vous-même")) return notFound(msg);
    if (msg.includes("requis")) return badRequest(msg);
    return serverError("Échec de l'ouverture du DM", { error: msg });
  }
}
