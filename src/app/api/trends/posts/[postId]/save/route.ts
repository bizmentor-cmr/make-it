// Make It — POST /api/trends/posts/[postId]/save
// Toggles the `isSaved` flag on a trend post. Pass `{ saved: true | false }`
// in the body to set an explicit state, or omit it to toggle. Returns the
// updated post. Scoped by workspaceId (via the watch relation).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { db } from "@/lib/db";
import { setTrendPostSaved } from "@/server/modules/trends/service";

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
  const { postId } = await params;

  // Resolve the current saved state + verify workspace isolation.
  const existing = await db.trendPost.findUnique({
    where: { id: postId },
    include: { watch: { select: { workspaceId: true } } },
  });
  if (!existing || existing.watch.workspaceId !== ctx.workspaceId) {
    return notFound("Post introuvable");
  }

  // Determine the target state — explicit `saved` in the body, else toggle.
  let explicit: boolean | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown> | null;
    if (body && typeof body.saved === "boolean") explicit = body.saved;
  } catch {
    /* no body — toggle */
  }
  const next = explicit === null ? !existing.isSaved : explicit;

  try {
    const row = await setTrendPostSaved(postId, ctx.workspaceId, next);
    if (!row) return notFound("Post introuvable");
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: next ? "trends.post.save" : "trends.post.unsave",
      entity: "TrendPost",
      entityId: postId,
      metadata: { url: row.url, platform: row.platform },
      ip: clientIp(req),
    });
    return ok(row, { saved: next });
  } catch (e) {
    return serverError("Échec de la sauvegarde du post", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
