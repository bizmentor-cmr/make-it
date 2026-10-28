// Make It — GET/PATCH/DELETE /api/social/[id]
// GET    : account details (no tokens).
// PATCH  : update status / handle (manager+).
// DELETE : disconnect (status="disconnected", keep the record) — manager+.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";

const ALLOWED_STATUSES = new Set([
  "connected",
  "disconnected",
  "expired",
  "error",
]);

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function toPublicAccount(a: {
  id: string;
  workspaceId: string;
  platform: string;
  accountName: string | null;
  handle: string | null;
  externalAccountId: string | null;
  status: string;
  tokenExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    platform: a.platform,
    accountName: a.accountName,
    handle: a.handle,
    externalAccountId: a.externalAccountId,
    status: a.status,
    tokenExpiry: a.tokenExpiry,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
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

  const account = await db.socialAccount.findUnique({
    where: { id },
  });
  if (!account || account.workspaceId !== wsCtx.workspaceId) {
    return notFound("Compte social introuvable");
  }

  return ok({ account: toPublicAccount(account) });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant");
  const { id } = await ctx.params;

  const account = await db.socialAccount.findUnique({ where: { id } });
  if (!account || account.workspaceId !== wsCtx.workspaceId) {
    return notFound("Compte social introuvable");
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const data: { status?: string; handle?: string | null } = {};
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return badRequest("Statut invalide", { status: body.status });
    }
    data.status = body.status;
  }
  if (body.handle !== undefined) {
    data.handle = asString(body.handle);
  }

  if (Object.keys(data).length === 0) {
    return badRequest("Aucun champ à mettre à jour (status, handle)");
  }

  try {
    const updated = await db.socialAccount.update({
      where: { id },
      data,
    });

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "social.update",
      entity: "SocialAccount",
      entityId: id,
      metadata: { fields: Object.keys(data), ...data },
      ip: clientIp(req),
    });

    return ok({ account: toPublicAccount(updated) }, { updated: true });
  } catch (e) {
    return serverError("Impossible de mettre à jour le compte social", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant");
  const { id } = await ctx.params;

  const account = await db.socialAccount.findUnique({ where: { id } });
  if (!account || account.workspaceId !== wsCtx.workspaceId) {
    return notFound("Compte social introuvable");
  }

  // Disconnect: keep the row, mark as disconnected, clear encrypted tokens.
  const updated = await db.socialAccount.update({
    where: { id },
    data: {
      status: "disconnected",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
    },
  });

  await audit({
    workspaceId: wsCtx.workspaceId,
    userId: user.id,
    action: "social.disconnect",
    entity: "SocialAccount",
    entityId: id,
    metadata: { platform: account.platform, handle: account.handle },
    ip: clientIp(req),
  });

  return ok({ account: toPublicAccount(updated) }, { disconnected: true });
}
