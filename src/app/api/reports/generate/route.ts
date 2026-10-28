// Make It — POST /api/reports/generate
// Async LLM report generation via AIJob. Returns { jobId } HTTP 202.
// Body: { type: "weekly" | "monthly" | "campaign", refId? }.
// MUST `import "@/server/modules/ai/runners"` first (registers B6's report runner)
// then `import "@/server/modules/reports/runner"` (re-registers the wrapper that
// adds the `report_available` notification — last writer wins).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { createAIJob } from "@/server/core/ai-job";
import { db } from "@/lib/db";
import "@/server/modules/ai/runners"; // side-effect: register base 11 runners
import "@/server/modules/reports/runner"; // side-effect: re-register report runner wrapper

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

const ALLOWED_TYPES = new Set(["weekly", "monthly", "campaign"]);

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

  const type = asString(body.type);
  if (!type || !ALLOWED_TYPES.has(type)) {
    return badRequest("Champ `type` requis (weekly | monthly | campaign)", { type });
  }
  const refId = asString(body.refId);

  // If a campaign report is requested, verify the campaign belongs to the workspace.
  if (type === "campaign" && refId) {
    const campaign = await db.campaign.findUnique({ where: { id: refId }, select: { id: true, workspaceId: true } });
    if (!campaign || campaign.workspaceId !== ctx.workspaceId) {
      return badRequest("Campagne introuvable pour ce workspace", { refId });
    }
  }

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "report",
      operation: "report",
      input: {
        type,
        refId,
        period: type === "weekly" ? "7j" : type === "monthly" ? "30j" : "campaign",
        metrics: null,
        top: null,
        flops: null,
      },
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
      action: "report.generate",
      entity: "AIJob",
      entityId: jobId,
      metadata: { type, refId, operation: "report", estimated },
      ip: clientIp(req),
    });

    return ok(
      { jobId, estimated },
      { type, operation: "report", workspaceId: ctx.workspaceId, refId },
      { status: 202 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du job IA", { error: msg });
  }
}
