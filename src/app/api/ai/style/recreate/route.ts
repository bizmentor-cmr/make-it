// Make It — POST /api/ai/style/recreate
// Enqueues a style_recreate job. Runner loads StyleDNA, builds brand+platform context,
// calls "style_recreate" prompt, if format image calls generateImage, stores a new Content row.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { createAIJob } from "@/server/core/ai-job";
import "@/server/modules/ai/runners"; // side-effect: registers all 11 runners

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

  const styleDNAId = asString(body.styleDNAId);
  if (!styleDNAId) return badRequest("Champ `styleDNAId` requis");
  const brief = asString(body.brief);
  if (!brief) return badRequest("Champ `brief` requis");
  const format = asString(body.format) ?? "image";
  const platform = asString(body.platform) ?? "instagram";

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "style_recreate",
      operation: "image_generation",
      input: { styleDNAId, brief, format, platform },
      quantity: 1,
    });
    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: job.status ?? 402 });
    }
    return ok({ jobId: (job as { jobId: string }).jobId, estimated: (job as { estimated: number }).estimated }, { styleDNAId, format, workspaceId: ctx.workspaceId }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du job de recréation de style", { error: msg });
  }
}
