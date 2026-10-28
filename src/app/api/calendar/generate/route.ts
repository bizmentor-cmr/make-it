// Make It — POST /api/calendar/generate
// Enqueue a calendar_generate AI job. The runner (registered in
// `@/server/modules/calendar/service`) loads brand + platform DNA + performance
// context, calls the calendar_generate prompt, parses JSON {items:[...]}, and
// persists an EditorialPlan + N EditorialItem rows. Returns {jobId} with 202.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  fail,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { createAIJob } from "@/server/core/ai-job";
import { PLATFORMS } from "@/server/core/types";

// MUST import runners.ts to ensure all 11 AI job runners are registered
// (side-effect import — registers the base calendar_generate runner etc.).
import "@/server/modules/ai/runners";
// Importing the calendar service overrides the calendar_generate runner with the
// persisting version (last writer wins — documented in runners.ts header).
import "@/server/modules/calendar/service";

const ALLOWED_HORIZONS = new Set([30, 60, 90]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const horizonRaw = typeof body.horizon === "number" ? body.horizon : Number.parseInt(asString(body.horizon as string) ?? "30", 10);
  if (!ALLOWED_HORIZONS.has(horizonRaw)) {
    return badRequest("Horizon invalide (30|60|90)", { horizon: horizonRaw });
  }
  const horizon = horizonRaw as 30 | 60 | 90;

  const objective = asString(body.objective);
  const frequency = asString(body.frequency);
  const platforms = Array.isArray(body.platforms)
    ? (body.platforms as unknown[])
        .filter((x): x is string => typeof x === "string")
        .filter((p) => new Set<string>(PLATFORMS).has(p.toLowerCase()))
        .map((p) => p.toLowerCase())
    : undefined;

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "calendar_generate",
      operation: "calendar_generate",
      input: {
        horizon,
        objective: objective ?? "engagement",
        frequency: frequency ?? "3/semaine",
        platforms: platforms ?? ["instagram", "tiktok", "facebook"],
      },
      quantity: 1,
    });

    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: 402 });
    }

    const jobId = (job as { jobId: string }).jobId;
    const estimated = (job as { estimated: number }).estimated;

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "calendar.generate",
      entity: "AIJob",
      entityId: jobId,
      metadata: { horizon, objective, frequency, platforms },
      ip: clientIp(req),
    });

    return ok(
      { jobId, estimated },
      { queued: true },
      { status: 202 }
    );
  } catch (e) {
    return serverError("Échec de l'enqueue du job calendrier", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
