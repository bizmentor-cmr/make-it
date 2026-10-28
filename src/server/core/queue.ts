// Make It — In-process async job queue (no Redis).
// Features: retry with exponential backoff, dead-letter on max attempts, worker concurrency,
// progress hooks. Used for AI jobs, media processing, publishing, analytics sync, reports.

import { logger } from "./logger";

type JobHandler<T = unknown> = (job: QueuedJob<T>) => Promise<JobResult>;

export type QueuedJob<T = unknown> = {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  onProgress?: (percent: number, step?: string, extra?: Record<string, unknown>) => void;
};

export type JobResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  retryable?: boolean;
};

type EnqueueOpts = {
  type: string;
  payload: unknown;
  maxAttempts?: number;
  onProgress?: QueuedJob["onProgress"];
};

const queue: QueuedJob[] = [];
let workers = 0;
const MAX_WORKERS = 4;
const deadLetter: QueuedJob[] = [];

function nextBackoff(attempt: number): number {
  return Math.min(30000, 1000 * 2 ** attempt); // 1s, 2s, 4s, 8s ... max 30s
}

export function enqueue(opts: EnqueueOpts): string {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: QueuedJob = {
    id,
    type: opts.type,
    payload: opts.payload,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    createdAt: new Date(),
    onProgress: opts.onProgress,
  };
  queue.push(job);
  logger.info("queue:enqueue", { id, type: opts.type });
  runWorkers();
  return id;
}

export function registerHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

const handlers = new Map<string, JobHandler>();

async function runWorkers() {
  while (workers < MAX_WORKERS && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    workers++;
    processJob(job).finally(() => {
      workers--;
      runWorkers();
    });
  }
}

async function processJob(job: QueuedJob) {
  const handler = handlers.get(job.type);
  if (!handler) {
    logger.error("queue:no-handler", { type: job.type, id: job.id });
    deadLetter.push(job);
    return;
  }
  job.attempts++;
  job.startedAt = new Date();
  try {
    const result = await handler(job);
    if (result.ok) {
      job.completedAt = new Date();
      logger.info("queue:done", { id: job.id, type: job.type });
      return;
    }
    throw new Error(result.error || "Job failed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn("queue:error", { id: job.id, type: job.type, attempt: job.attempts, error: msg });
    if (job.attempts < job.maxAttempts) {
      const delay = nextBackoff(job.attempts);
      setTimeout(() => {
        queue.push(job);
        runWorkers();
      }, delay);
    } else {
      job.failedAt = new Date();
      deadLetter.push(job);
      logger.error("queue:dead-letter", { id: job.id, type: job.type, error: msg });
    }
  }
}

export function queueStats() {
  return {
    pending: queue.length,
    workers,
    deadLetter: deadLetter.length,
    maxWorkers: MAX_WORKERS,
  };
}

export function drainDeadLetter() {
  const d = deadLetter.splice(0);
  return d;
}
