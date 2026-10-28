// Make It — GET / DELETE /api/publishing/[id]
// GET    : one publication (with content + socialAccount).
// DELETE : cancel a pending/publishing publication.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { cancelPublication } from "@/server/modules/publishing/service";

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
  const { id: publicationId } = await ctx.params;

  const pub = await db.publication.findUnique({
    where: { id: publicationId },
    include: {
      socialAccount: {
        select: { id: true, platform: true, accountName: true, handle: true },
      },
      content: { select: { id: true, title: true, type: true, objective: true } },
    },
  });
  if (!pub || pub.workspaceId !== wsCtx.workspaceId) return notFound("Publication introuvable");

  return ok({
    publication: {
      id: pub.id,
      workspaceId: pub.workspaceId,
      contentId: pub.contentId,
      socialAccountId: pub.socialAccountId,
      socialAccount: pub.socialAccount,
      content: pub.content,
      scheduledAt: pub.scheduledAt,
      publishedAt: pub.publishedAt,
      status: pub.status,
      externalPostId: pub.externalPostId,
      externalPermalink: pub.externalPermalink,
      error: pub.error,
      attempts: pub.attempts,
      createdAt: pub.createdAt,
      updatedAt: pub.updatedAt,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id: publicationId } = await ctx.params;

  const pub = await db.publication.findUnique({ where: { id: publicationId } });
  if (!pub || pub.workspaceId !== wsCtx.workspaceId) return notFound("Publication introuvable");
  if (pub.status !== "pending" && pub.status !== "publishing") {
    return badRequest("Annulation impossible (statut actuel: " + pub.status + ")");
  }

  try {
    const canceled = await cancelPublication(wsCtx.workspaceId, publicationId);
    if (!canceled) return badRequest("Annulation impossible");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "publishing.cancel",
      entity: "Publication",
      entityId: publicationId,
      ip: clientIp(req),
    });

    return ok({ canceled: true, publicationId, status: "canceled" });
  } catch (e) {
    return serverError("Échec de l'annulation", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
