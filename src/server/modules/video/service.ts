// Make It — Video project service.
// CRUD + render orchestration for the Montage editor.
// A VideoProject stores the full editData JSON (layers/clips/transitions) so the
// frontend can save/load sessions. Render is async (mock for the MVP — real ffmpeg
// workers would slot in via the queue).

import { db } from "@/lib/db";
import { enqueue, registerHandler } from "@/server/core/queue";
import { emitRealtime } from "@/server/core/realtime";
import { logger } from "@/server/core/logger";

export type EditData = {
  layers: Layer[];
  duration: number;
  fps?: number;
  background?: string;
};

export type Layer = {
  id: string;
  kind: "image" | "video" | "text" | "shape" | "audio" | "sticker";
  name: string;
  x: number; // % of canvas
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  // timing (seconds) — for timeline clips
  start: number;
  end: number;
  // visual
  filters?: {
    brightness?: number; // 1 = normal
    contrast?: number;
    saturate?: number;
    blur?: number; // px
    grayscale?: number; // 0..1
    sepia?: number;
    hueRotate?: number; // deg
  };
  // per-kind
  src?: string; // image/video url (object URL or media path)
  thumb?: string;
  // text
  text?: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  backgroundColor?: string;
  // shape / sticker
  shape?: "rect" | "circle" | "line" | "triangle";
  fill?: string;
  emoji?: string;
  // audio
  volume?: number; // 0..1
  muted?: boolean;
  // [key: string]: unknown; // forward-compat
};

let renderHandlerRegistered = false;
function ensureRenderHandler() {
  if (renderHandlerRegistered) return;
  renderHandlerRegistered = true;
  registerHandler("video-render", async (qjob) => {
    const { projectId, workspaceId } = qjob.payload as { projectId: string; workspaceId: string };
    const project = await db.videoProject.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) {
      return { ok: false, error: "Project not found", retryable: false };
    }
    await db.videoProject.update({ where: { id: projectId }, data: { status: "rendering" } });
    await emitRealtime({ room: workspaceId, event: "render:progress", data: { projectId, status: "rendering", progress: 10 } });
    // Mock render: produce a downloadable URL representing the project poster.
    // Real implementation would invoke ffmpeg in a worker.
    await new Promise((r) => setTimeout(r, 2500));
    await emitRealtime({ room: workspaceId, event: "render:progress", data: { projectId, status: "rendering", progress: 60 } });
    await new Promise((r) => setTimeout(r, 1500));
    const renderUrl = `/uploads/workspace/${workspaceId}/exports/${project.id}.png`;
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "rendered", renderUrl },
    });
    await emitRealtime({ room: workspaceId, event: "render:progress", data: { projectId, status: "completed", progress: 100, renderUrl } });
    logger.info("video:render:done", { projectId });
    return { ok: true };
  });
}

export async function listVideoProjects(workspaceId: string) {
  return db.videoProject.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, aspectRatio: true, duration: true, status: true,
      renderUrl: true, contentId: true, createdAt: true, updatedAt: true,
    },
  });
}

export async function getVideoProject(id: string, workspaceId: string) {
  const p = await db.videoProject.findUnique({ where: { id } });
  if (!p || p.workspaceId !== workspaceId) return null;
  return {
    ...p,
    editData: p.editData ? JSON.parse(p.editData) : null,
  };
}

export async function createVideoProject(workspaceId: string, data: { name: string; aspectRatio?: string; editData?: EditData }) {
  return db.videoProject.create({
    data: {
      workspaceId,
      name: data.name,
      aspectRatio: data.aspectRatio ?? "9:16",
      editData: data.editData ? JSON.stringify(data.editData) : null,
      status: "draft",
    },
  });
}

export async function updateVideoProject(id: string, workspaceId: string, data: Partial<{ name: string; aspectRatio: string; duration: number; editData: EditData; status: string; renderUrl: string }>) {
  const patch: Record<string, unknown> = { ...data };
  if (data.editData) patch.editData = JSON.stringify(data.editData);
  const updated = await db.videoProject.updateMany({ where: { id, workspaceId }, data: patch });
  if (updated.count === 0) return null;
  return getVideoProject(id, workspaceId);
}

export async function deleteVideoProject(id: string, workspaceId: string) {
  const r = await db.videoProject.deleteMany({ where: { id, workspaceId } });
  return r.count > 0;
}

export async function renderVideoProject(id: string, workspaceId: string) {
  ensureRenderHandler();
  const p = await db.videoProject.findUnique({ where: { id } });
  if (!p || p.workspaceId !== workspaceId) return null;
  await db.videoProject.update({ where: { id }, data: { status: "queued" } });
  enqueue({ type: "video-render", payload: { projectId: id, workspaceId } });
  return { id, status: "queued" };
}
