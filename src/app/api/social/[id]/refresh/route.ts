// Make It — POST /api/social/[id]/refresh
// Mock token refresh — bumps tokenExpiry +30 days and sets status to "connected".
// manager+ allowed. Real OAuth refresh would decrypt the refresh token, call
// the platform's token endpoint, and re-encrypt the new tokens.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(
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

  try {
    const newExpiry = new Date(Date.now() + THIRTY_DAYS_MS);
    const updated = await db.socialAccount.update({
      where: { id },
      data: {
        tokenExpiry: newExpiry,
        status: "connected",
      },
    });

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "social.token.refresh",
      entity: "SocialAccount",
      entityId: id,
      metadata: {
        platform: account.platform,
        previousExpiry: account.tokenExpiry,
        newExpiry,
        mocked: true,
      },
      ip: clientIp(req),
    });

    return ok(
      {
        account: {
          id: updated.id,
          platform: updated.platform,
          handle: updated.handle,
          status: updated.status,
          tokenExpiry: updated.tokenExpiry,
        },
      },
      { refreshed: true, mocked: true }
    );
  } catch (e) {
    return serverError("Impossible de rafraîchir le token", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
