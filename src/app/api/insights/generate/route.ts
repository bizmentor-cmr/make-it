// Make It — POST /api/insights/generate
// Async LLM insight generation via AIJob. Returns { jobId } HTTP 202.
// MUST import "@/server/modules/ai/runners" at the top (side-effect registration).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { createAIJob } from "@/server/core/ai-job";
import "@/server/modules/ai/runners"; // side-effect: registers insight runner

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

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "insight",
      operation: "insight",
      input: { metrics: null, platforms: null, history: null, source: "manual" },
      quantity: 1,
    });
    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: job.status ?? 402 });
    }
    const jobId = (job as { jobId: string }).jobId;
    const estimated = (job as { estimated: number }).estimated;

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "insight.generate",
      entity: "AIJob",
      entityId: jobId,
      metadata: { operation: "insight", estimated },
      ip: clientIp(req),
    });

    return ok({ jobId, estimated }, { operation: "insight", workspaceId: ctx.workspaceId }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du job IA", { error: msg });
  }
}
