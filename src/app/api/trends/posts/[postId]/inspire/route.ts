// Make It — POST /api/trends/posts/[postId]/inspire
// Creates a Content row inspired by this trend post (type=text, status=idea,
// title=post.contentAngle, description=post.summary, metadata records the
// inspiration source + post url + platform + engagement). Links the post
// back via inspiredContentId. Returns { contentId } so the UI can navigate
// to the Create section with the idea pre-filled. creator+ write; scoped by
// workspaceId (via the watch relation).

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
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { inspireContentFromPost } from "@/server/modules/trends/service";
import { db } from "@/lib/db";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

type CtxParams = { params: Promise<{ postId: string }> };

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { postId } = await params;

  // Verify the post belongs to this workspace's watches.
  const existing = await db.trendPost.findUnique({
    where: { id: postId },
    include: { watch: { select: { workspaceId: true } } },
  });
  if (!existing || existing.watch.workspaceId !== ctx.workspaceId) {
    return notFound("Post introuvable");
  }
  if (existing.inspiredContentId) {
    return badRequest("Ce post a déjà inspiré un contenu", {
      contentId: existing.inspiredContentId,
    });
  }

  try {
    const result = await inspireContentFromPost(postId, ctx.workspaceId);
    if (!result) return notFound("Post introuvable");
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "trends.post.inspire",
      entity: "TrendPost",
      entityId: postId,
      metadata: { contentId: result.contentId, url: existing.url, platform: existing.platform },
      ip: clientIp(req),
    });
    return ok(result, { created: true, contentId: result.contentId }, { status: 201 });
  } catch (e) {
    return serverError("Échec de la création du contenu inspiré", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
