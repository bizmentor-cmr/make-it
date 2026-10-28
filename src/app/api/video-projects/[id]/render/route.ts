// Make It — POST /api/video-projects/[id]/render
// Kicks off an async render job (mock ffmpeg) and returns the queued status.
// Progress is delivered via socket.io `render:progress` events ({projectId, status, progress, renderUrl}).
import { NextResponse } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";
import { renderVideoProject } from "@/server/modules/video/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  const { id } = await params;
  try {
    const r = await renderVideoProject(id, ctx.workspaceId);
    if (!r) return notFound("Projet introuvable");
    await audit({ workspaceId: ctx.workspaceId, userId: user.id, action: "video_project.render", entity: "VideoProject", entityId: id });
    return ok(r, undefined, { status: 202 });
  } catch (e) {
    logger.error("video-projects:render:error", { error: String(e) });
    return serverError("Échec du lancement du rendu");
  }
}
