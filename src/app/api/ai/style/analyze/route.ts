// Make It — POST /api/ai/style/analyze
// Enqueues a style_analysis job. Runner uses visionChat with a style-DNA extraction prompt,
// parses palette/composition/lighting/typography/etc., stores StyleReference + StyleDNA.
// Uses ContentCache to skip re-analyzing the same URL/asset (anti-waste engine).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { createAIJob } from "@/server/core/ai-job";
import "@/server/modules/ai/runners"; // side-effect: registers all 11 runners

const ALLOWED_SOURCE_TYPES = new Set(["image", "video", "url"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const sourceType = asString(body.sourceType);
  if (!sourceType || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
    return badRequest("sourceType invalide (image | video | url)", { sourceType });
  }
  const sourceUrl = asString(body.sourceUrl);
  const assetId = asString(body.assetId);
  if (!sourceUrl && !assetId) {
    return badRequest("Champ `sourceUrl` ou `assetId` requis pour analyser un style");
  }

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "style_analysis",
      operation: "style_analysis",
      input: { sourceType, sourceUrl, assetId },
      quantity: 1,
    });
    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: job.status ?? 402 });
    }
    return ok({ jobId: (job as { jobId: string }).jobId, estimated: (job as { estimated: number }).estimated }, { sourceType, workspaceId: ctx.workspaceId }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du job d'analyse de style", { error: msg });
  }
}
