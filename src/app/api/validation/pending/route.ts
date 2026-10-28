// Make It — GET /api/validation/pending
// Lists pending validations for the active workspace. Optional ?stage= filter.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { listPendingValidations, type ValidationStage } from "@/server/modules/validation/service";

const ALLOWED_STAGES = new Set(["draft", "pending_cdp", "pending_client", "validated", "refused"]);

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const stageParam = url.searchParams.get("stage");
  let stage: ValidationStage | undefined;
  if (stageParam) {
    if (!ALLOWED_STAGES.has(stageParam)) {
      return badRequest("`stage` invalide", { allowed: Array.from(ALLOWED_STAGES) });
    }
    stage = stageParam as ValidationStage;
  }

  try {
    const items = await listPendingValidations(ctx.workspaceId, stage);
    return ok({ items }, { workspaceId: ctx.workspaceId, count: items.length });
  } catch (e) {
    return serverError("Échec de lecture des validations en attente", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
