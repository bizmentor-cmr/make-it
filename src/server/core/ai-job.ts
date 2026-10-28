// Make It — AI Job engine.
// Creates an AIJob record, reserves credits, runs the work on the in-process queue,
// emits progress events via real-time, consumes real credits on completion (refunds surplus),
// and refunds the reservation on failure.

import { db } from "@/lib/db";
import { logger } from "./logger";
import { emitJobCompleted, emitJobProgress } from "./realtime";
import { enqueue, registerHandler } from "./queue";
import { estimateCost } from "./ai-cost";
import { consumeCredits, refundReservation, reserveCredits, getWallet, availableBalance } from "./credits";

export type JobRunner = (job: {
  id: string;
  workspaceId: string;
  input: any;
  log: (message: string, level?: "info" | "warn" | "error", step?: string, meta?: Record<string, unknown>) => Promise<void>;
  progress: (percent: number, step?: string, consumedCredits?: number) => Promise<void>;
}) => Promise<{ output?: unknown; consumedCredits?: number }>;

const runners = new Map<string, JobRunner>();
const registered = new Set<string>();

export function registerJobRunner(type: string, runner: JobRunner) {
  runners.set(type, runner);
}

function ensureQueueHandler(type: string) {
  const key = `ai:${type}`;
  if (registered.has(key)) return;
  registered.add(key);
  registerHandler(key, async (qjob) => {
    const payload = qjob.payload as { jobId: string };
    const aiJob = await db.aIJob.findUnique({ where: { id: payload.jobId } });
    if (!aiJob) return { ok: false, error: "Job not found", retryable: false };
    const runner = runners.get(aiJob.type);
    if (!runner) {
      await db.aIJob.update({ where: { id: aiJob.id }, data: { status: "failed", error: "No runner registered" } });
      await refundReservation(aiJob.workspaceId, aiJob.reservedCredits, aiJob.id);
      return { ok: false, error: "No runner registered", retryable: false };
    }

    const { workspaceId, id: jobId } = aiJob;

    const logFn = async (message: string, level: "info" | "warn" | "error" = "info", step?: string, meta?: Record<string, unknown>) => {
      await db.aIJobLog.create({
        data: { jobId, level, step: step ?? null, message, meta: meta ? JSON.stringify(meta) : null },
      });
      logger.info("aijob:log", { jobId, level, message });
    };
    const progressFn = async (percent: number, step?: string, consumedCredits?: number) => {
      await db.aIJob.update({
        where: { id: jobId },
        data: {
          progress: Math.min(100, percent),
          currentStep: step ?? aiJob.currentStep,
          status: percent >= 100 ? "validating" : "generating",
          ...(consumedCredits !== undefined ? { consumedCredits } : {}),
        },
      });
      await emitJobProgress(workspaceId, {
        id: jobId,
        status: percent >= 100 ? "validating" : "generating",
        progress: Math.min(100, percent),
        currentStep: step,
        consumedCredits: consumedCredits ?? aiJob.consumedCredits,
        estimatedRemainingCredits: Math.max(0, aiJob.estimatedCredits - (consumedCredits ?? 0)),
      });
    };

    try {
      await db.aIJob.update({ where: { id: jobId }, data: { status: "started", startedAt: new Date() } });
      await emitJobProgress(workspaceId, { id: jobId, status: "started", progress: 0, currentStep: "Démarrage" });

      const result = await runner({
        id: jobId,
        workspaceId,
        input: JSON.parse(aiJob.input ?? "{}"),
        log: logFn,
        progress: progressFn,
      });

      const consumed = result.consumedCredits ?? aiJob.estimatedCredits;
      await consumeCredits(workspaceId, aiJob.reservedCredits, consumed, aiJob.type, jobId);
      await db.aIJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          progress: 100,
          completedAt: new Date(),
          output: result.output ? JSON.stringify(result.output) : null,
          consumedCredits: consumed,
        },
      });
      await emitJobCompleted(workspaceId, { id: jobId, type: aiJob.type, status: "completed", output: result.output, consumedCredits: consumed });
      return { ok: true, output: result.output };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("aijob:failed", { jobId, error: msg });
      await db.aIJob.update({ where: { id: jobId }, data: { status: "failed", error: msg } });
      await refundReservation(workspaceId, aiJob.reservedCredits, jobId);
      await emitJobProgress(workspaceId, { id: jobId, status: "failed", progress: 0, currentStep: "Échec" });
      await emitJobCompleted(workspaceId, { id: jobId, type: aiJob.type, status: "failed" });
      return { ok: false, error: msg, retryable: true };
    }
  });
}

// Create a job, reserve credits, enqueue async processing.
export async function createAIJob(opts: {
  workspaceId: string;
  userId?: string;
  type: string;
  operation: string; // cost operation
  input: unknown;
  quantity?: number; // for cost estimation
}) {
  const { workspaceId, userId, type, operation, input, quantity } = opts;
  const estimate = await estimateCost(operation, quantity ?? 1);
  const wallet = await getWallet(workspaceId);
  const available = availableBalance(wallet);
  if (available < estimate.estimated) {
    return { error: "Crédits insuffisants pour cette opération.", status: 402 };
  }

  const job = await db.aIJob.create({
    data: {
      workspaceId,
      userId,
      type,
      status: "queued",
      estimatedCredits: estimate.estimated,
      reservedCredits: estimate.estimated,
      input: JSON.stringify(input),
    },
  });

  await reserveCredits(workspaceId, estimate.estimated, job.id);
  await emitJobProgress(workspaceId, {
    id: job.id,
    status: "queued",
    progress: 0,
    currentStep: "En attente",
  });

  ensureQueueHandler(type);
  enqueue({ type: `ai:${type}`, payload: { jobId: job.id } });

  return { jobId: job.id, estimated: estimate.estimated, sufficient: true };
}

export async function cancelAIJob(jobId: string, workspaceId: string) {
  const job = await db.aIJob.findUnique({ where: { id: jobId } });
  if (!job || job.workspaceId !== workspaceId) return false;
  if (job.status === "completed" || job.status === "failed") return false;
  await db.aIJob.update({ where: { id: jobId }, data: { status: "canceled" } });
  await refundReservation(workspaceId, job.reservedCredits, jobId);
  await emitJobProgress(workspaceId, { id: jobId, status: "canceled", progress: 0 });
  return true;
}

export async function getAIJob(jobId: string, workspaceId: string) {
  const job = await db.aIJob.findUnique({ where: { id: jobId } });
  if (!job || job.workspaceId !== workspaceId) return null;
  return {
    ...job,
    input: job.input ? JSON.parse(job.input) : null,
    output: job.output ? JSON.parse(job.output) : null,
  };
}
