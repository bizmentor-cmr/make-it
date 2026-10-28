// Make It — GET/DELETE /api/jobs/[id]
// GET    : one AI job, scoped to the active workspace.
// DELETE : cancel a pending/started job (calls cancelAIJob).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { cancelAIJob, getAIJob } from "@/server/core/ai-job";
import { audit } from "@/server/core/audit";
import { db } from "@/lib/db";

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
  const { id: jobId } = await ctx.params;

  const job = await getAIJob(jobId, wsCtx.workspaceId);
  if (!job) return notFound("Job introuvable");

  // Pull latest logs (limited) for client polling UX.
  const logs = await db.aIJobLog.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return ok({
    job: {
      id: job.id,
      workspaceId: job.workspaceId,
      userId: job.userId,
      type: job.type,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      estimatedCredits: job.estimatedCredits,
      reservedCredits: job.reservedCredits,
      consumedCredits: job.consumedCredits,
      input: job.input,
      output: job.output,
      outputId: job.outputId,
      error: job.error,
      attempts: job.attempts,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    logs: logs
      .slice()
      .reverse()
      .map((l) => ({
        id: l.id,
        level: l.level,
        step: l.step,
        message: l.message,
        meta: l.meta,
        createdAt: l.createdAt,
      })),
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
  const { id: jobId } = await ctx.params;

  const job = await getAIJob(jobId, wsCtx.workspaceId);
  if (!job) return notFound("Job introuvable");

  if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
    return badRequest("Le job ne peut plus être annulé", { status: job.status });
  }

  const canceled = await cancelAIJob(jobId, wsCtx.workspaceId);
  if (!canceled) return badRequest("Annulation impossible", { status: job.status });

  await audit({
    workspaceId: wsCtx.workspaceId,
    userId: user.id,
    action: "job.cancel",
    entity: "AIJob",
    entityId: jobId,
    metadata: { type: job.type, previousStatus: job.status },
    ip: clientIp(req),
  });

  return ok({ canceled: true, jobId, status: "canceled" });
}
