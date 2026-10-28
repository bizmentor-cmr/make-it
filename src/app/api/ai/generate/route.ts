// Make It — POST /api/ai/generate
// Enqueues an AI job by type and returns { jobId, estimated } HTTP 202.
// type → operation mapping: text→text_generation, image→image_generation,
// atomize→atomize, adapt→adapt, calendar→calendar_generate, message_analysis→message_analysis,
// report→report, insight→insight.
// CRITICAL: imports "@/server/modules/ai/runners" at the top so all 11 runners register.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { createAIJob } from "@/server/core/ai-job";
import "@/server/modules/ai/runners"; // side-effect: registers all 11 runners

const TYPE_TO_OPERATION: Record<string, string> = {
  text: "text_generation",
  image: "image_generation",
  atomize: "atomize",
  adapt: "adapt",
  calendar: "calendar_generate",
  message_analysis: "message_analysis",
  report: "report",
  insight: "insight",
};

const ALLOWED_TYPES = new Set(Object.keys(TYPE_TO_OPERATION));

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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

  const type = asString(body.type);
  if (!type || !ALLOWED_TYPES.has(type)) {
    return badRequest("Type de génération invalide", { type, allowed: Array.from(ALLOWED_TYPES) });
  }
  const operation = TYPE_TO_OPERATION[type];

  // Build the job input + compute quantity (for cost estimation)
  const input: Record<string, unknown> = {};
  let quantity = 1;
  switch (type) {
    case "text": {
      const idea = asString(body.idea) ?? asString(body.prompt);
      if (!idea) return badRequest("Champ `idea` (ou `prompt`) requis pour type=text");
      input.idea = idea;
      input.platform = asString(body.platform) ?? "instagram";
      input.objective = asString(body.objective) ?? "engagement";
      input.format = asString(body.format) ?? "post";
      input.history = Array.isArray(body.history) ? body.history : undefined;
      quantity = 1;
      break;
    }
    case "image": {
      const prompt = asString(body.prompt);
      if (!prompt) return badRequest("Champ `prompt` requis pour type=image");
      input.prompt = prompt;
      input.size = asString(body.size) ?? "1024x1024";
      input.format = asString(body.format) ?? "image";
      quantity = 1;
      break;
    }
    case "atomize": {
      const idea = asString(body.idea);
      if (!idea) return badRequest("Champ `idea` requis pour type=atomize");
      input.idea = idea;
      if (!Array.isArray(body.platforms)) return badRequest("Champ `platforms` (tableau) requis pour type=atomize");
      input.platforms = body.platforms;
      input.objective = asString(body.objective) ?? "engagement";
      quantity = Math.max(1, (body.platforms as unknown[]).length);
      break;
    }
    case "adapt": {
      input.contentId = asString(body.contentId);
      input.source = asString(body.source);
      if (!input.contentId && !input.source) return badRequest("Champ `contentId` ou `source` requis pour type=adapt");
      input.platform = asString(body.platform) ?? "instagram";
      input.objective = asString(body.objective) ?? "engagement";
      input.format = asString(body.format) ?? "post";
      quantity = 1;
      break;
    }
    case "calendar": {
      input.horizon = asNumber(body.horizon, 30);
      input.industry = asString(body.industry) ?? "";
      input.objective = asString(body.objective) ?? "engagement";
      input.pillars = Array.isArray(body.pillars) ? body.pillars : asString(body.pillars) ?? [];
      input.frequency = asString(body.frequency) ?? "3/semaine";
      input.platforms = Array.isArray(body.platforms) ? body.platforms : ["instagram", "tiktok", "facebook"];
      input.country = asString(body.country) ?? "France";
      quantity = 1;
      break;
    }
    case "message_analysis": {
      const message = asString(body.message);
      if (!message) return badRequest("Champ `message` requis pour type=message_analysis");
      input.message = message;
      input.platform = asString(body.platform) ?? "instagram";
      input.conversationId = asString(body.conversationId);
      input.messageId = asString(body.messageId);
      quantity = 1;
      break;
    }
    case "report": {
      input.period = asString(body.period) ?? "30j";
      input.metrics = body.metrics ?? null;
      input.top = body.top ?? body.topContents ?? null;
      input.flops = body.flops ?? null;
      input.campaignId = asString(body.campaignId);
      quantity = 1;
      break;
    }
    case "insight": {
      input.metrics = body.metrics ?? null;
      input.platforms = body.platforms ?? null;
      input.history = body.history ?? null;
      quantity = 1;
      break;
    }
    default:
      return badRequest("Type non géré");
  }

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: operation, // job.type === operation for routing
      operation,
      input,
      quantity,
    });
    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: job.status ?? 402 });
    }
    return ok({ jobId: (job as { jobId: string }).jobId, estimated: (job as { estimated: number }).estimated }, { type, operation, quantity, workspaceId: ctx.workspaceId }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création du job IA", { error: msg });
  }
}
