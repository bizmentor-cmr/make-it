// Make It — GET /api/jobs
// List AI jobs for the active workspace (paginated, filterable by status/type), newest first.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { JOB_STATUSES, type JobStatus } from "@/server/core/types";

const ALLOWED_STATUSES = new Set<string>(JOB_STATUSES);
const ALLOWED_TYPES = new Set<string>([
  "text_generation",
  "image_generation",
  "video_generation",
  "video_analysis",
  "style_analysis",
  "image_edit",
  "video_render",
  "social_adaptation",
  "transcription",
  "chat",
  "embedding",
  "atomize",
  "calendar_generate",
  "message_analysis",
  "report",
  "insight",
  "adapt",
]);

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");

  const where: { workspaceId: string; status?: string; type?: string } = {
    workspaceId: ctx.workspaceId,
  };
  if (status) {
    if (!ALLOWED_STATUSES.has(status)) {
      return badRequest("Statut invalide", { status });
    }
    where.status = status as JobStatus;
  }
  if (type) {
    if (!ALLOWED_TYPES.has(type)) {
      return badRequest("Type de job invalide", { type });
    }
    where.type = type;
  }

  const [total, items] = await Promise.all([
    db.aIJob.count({ where }),
    db.aIJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { logs: true } },
      },
    }),
  ]);

  return ok(
    {
      items: items.map((j) => ({
        id: j.id,
        workspaceId: j.workspaceId,
        userId: j.userId,
        type: j.type,
        status: j.status,
        progress: j.progress,
        currentStep: j.currentStep,
        estimatedCredits: j.estimatedCredits,
        reservedCredits: j.reservedCredits,
        consumedCredits: j.consumedCredits,
        outputId: j.outputId,
        error: j.error,
        attempts: j.attempts,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        logCount: j._count.logs,
      })),
    },
    {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      workspaceId: ctx.workspaceId,
    }
  );
}
