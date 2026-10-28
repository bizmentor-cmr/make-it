// Make It — POST /api/media/[id]/process
// Enqueue media processing job (mock: updates optimizedPath/metadata).
// Real workers (compression/transcoding/resize/crop/audio extraction/transcription/
// subtitle generation/background removal/image processing/video rendering) would run
// on the queue. Returns { jobId }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { db } from "@/lib/db";
import { enqueue, registerHandler } from "@/server/core/queue";
import { logger } from "@/server/core/logger";

const ALLOWED_OPS = new Set([
  "thumbnail",
  "transcode",
  "resize",
  "crop",
  "audio_extract",
  "transcribe",
  "bg_remove",
  "subtitle",
]);

const registered = new Set<string>();
function ensureMediaHandler() {
  if (registered.has("media:process")) return;
  registered.add("media:process");
  registerHandler("media:process", async (qjob) => {
    const p = qjob.payload as { mediaId: string; workspaceId: string; operation: string };
    try {
      // Mock: update optimizedPath/metadata after a short wait
      await new Promise((r) => setTimeout(r, 200));
      const asset = await db.mediaAsset.findUnique({ where: { id: p.mediaId } });
      if (!asset || asset.workspaceId !== p.workspaceId) return { ok: false, error: "not found" };
      // Best-effort update — real workers (sharp/ffmpeg/whisper) would do the actual work.
      await db.mediaAsset.update({
        where: { id: p.mediaId },
        data: {
          optimizedPath: `${asset.storagePath}?processed=${p.operation}`,
          metadata: JSON.stringify({ ...(JSON.parse(asset.metadata ?? "{}") as Record<string, unknown>), processed: p.operation, processedAt: new Date().toISOString() }),
        },
      });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("media:process", { mediaId: p.mediaId, error: msg });
      return { ok: false, error: msg, retryable: true };
    }
  });
}

type CtxParams = { params: Promise<{ id: string }> };

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  const operation = typeof body.operation === "string" ? body.operation : "";
  if (!ALLOWED_OPS.has(operation)) {
    return badRequest("Opération invalide", { operation, allowed: Array.from(ALLOWED_OPS) });
  }

  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.workspaceId !== ctx.workspaceId) return notFound("Média introuvable");

  try {
    ensureMediaHandler();
    const jobId = enqueue({
      type: "media:process",
      payload: { mediaId: id, workspaceId: ctx.workspaceId, operation },
    });
    await db.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: user.id,
        action: "media.process",
        entity: "MediaAsset",
        entityId: id,
        metadata: JSON.stringify({ operation, jobId }),
        ip: clientIp(req),
      },
    });
    return ok({ jobId, mediaId: id, operation }, { status: "queued", workspaceId: ctx.workspaceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de l'enqueue du traitement média", { error: msg });
  }
}
