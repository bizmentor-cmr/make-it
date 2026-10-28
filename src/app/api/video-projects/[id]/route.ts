// Make It — GET/PATCH/DELETE /api/video-projects/[id]
import { NextResponse } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";
import {
  getVideoProject,
  updateVideoProject,
  deleteVideoProject,
  type EditData,
} from "@/server/modules/video/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  const { id } = await params;
  const p = await getVideoProject(id, ctx.workspaceId);
  if (!p) return notFound("Projet introuvable");
  return ok(p);
}

export async function PATCH(req: Request, { params }: Params): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  const { id } = await params;
  let body: Partial<{ name: string; aspectRatio: string; duration: number; editData: EditData; status: string }>;
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON invalide");
  }
  try {
    const updated = await updateVideoProject(id, ctx.workspaceId, body);
    if (!updated) return notFound("Projet introuvable");
    await audit({ workspaceId: ctx.workspaceId, userId: user.id, action: "video_project.update", entity: "VideoProject", entityId: id });
    return ok(updated);
  } catch (e) {
    logger.error("video-projects:update:error", { error: String(e) });
    return serverError("Échec de mise à jour");
  }
}

export async function DELETE(req: Request, { params }: Params): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace accessible");
  const { id } = await params;
  const deleted = await deleteVideoProject(id, ctx.workspaceId);
  if (!deleted) return notFound("Projet introuvable");
  await audit({ workspaceId: ctx.workspaceId, userId: user.id, action: "video_project.delete", entity: "VideoProject", entityId: id });
  return ok({ ok: true });
}
