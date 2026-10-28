// Make It — POST /api/atomizer
// { idea, platforms: ["instagram", ...], objective } → enqueue an atomize job.
// Runner calls "atomize" prompt, parses JSON { variants: [...] }, creates parent Content
// (idea, type text, status idea) + N child Content rows (parentContentId=parent,
// aiGenerated true). Section 20: never copy-paste; each adapted.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { createAIJob } from "@/server/core/ai-job";
import "@/server/modules/ai/runners"; // side-effect: registers all 11 runners

const ALLOWED_PLATFORMS = new Set(["instagram", "facebook", "tiktok", "linkedin", "youtube", "google", "whatsapp"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
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
  const idea = asString(body.idea);
  if (!idea) return badRequest("Champ `idea` requis");
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) {
    return badRequest("Champ `platforms` (tableau non vide) requis");
  }
  const platforms = (body.platforms as unknown[])
    .filter((p): p is string => typeof p === "string")
    .filter((p) => ALLOWED_PLATFORMS.has(p));
  if (platforms.length === 0) {
    return badRequest("Aucune plateforme valide", { allowed: Array.from(ALLOWED_PLATFORMS) });
  }
  const objective = asString(body.objective) ?? "engagement";

  try {
    const job = await createAIJob({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      type: "atomize",
      operation: "atomize",
      input: { idea, platforms, objective },
      quantity: Math.max(1, platforms.length),
    });
    if ("error" in job && job.error) {
      return fail(job.error, { code: "insufficient_credits", status: job.status ?? 402 });
    }
    return ok({ jobId: (job as { jobId: string }).jobId, estimated: (job as { estimated: number }).estimated }, { platforms, objective, workspaceId: ctx.workspaceId }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de l'enqueue du job d'atomisation", { error: msg });
  }
}
