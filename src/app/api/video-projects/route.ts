// Make It — GET/POST /api/video-projects
// List the workspace's video projects (montage sessions) OR create a new one.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";
import { listVideoProjects, createVideoProject, type EditData } from "@/server/modules/video/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  try {
    const items = await listVideoProjects(ctx.workspaceId);
    return ok(items, { workspaceId: ctx.workspaceId });
  } catch (e) {
    logger.error("video-projects:list:error", { error: String(e) });
    return serverError("Échec de lecture des projets");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  let body: { name?: string; aspectRatio?: string; editData?: EditData };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON invalide");
  }
  const name = body.name?.trim();
  if (!name) return badRequest("Le nom du projet est requis");
  try {
    const project = await createVideoProject(ctx.workspaceId, {
      name,
      aspectRatio: body.aspectRatio,
      editData: body.editData,
    });
    await audit({ workspaceId: ctx.workspaceId, userId: user.id, action: "video_project.create", entity: "VideoProject", entityId: project.id });
    return ok(project, undefined, { status: 201 });
  } catch (e) {
    logger.error("video-projects:create:error", { error: String(e) });
    return serverError("Échec de création du projet");
  }
}
