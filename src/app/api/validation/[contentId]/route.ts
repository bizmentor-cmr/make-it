// Make It — GET /api/validation/[contentId]
// Returns the validation state for a content piece. Lazily creates a draft row
// if none exists. Resolves the workspace from the request.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { getValidation } from "@/server/modules/validation/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const { contentId } = await params;
  if (!contentId) return badRequest("contentId requis");

  try {
    const v = await getValidation(contentId, ctx.workspaceId);
    return ok(v, { workspaceId: ctx.workspaceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable")) return badRequest(msg);
    return serverError("Échec de lecture de la validation", { error: msg });
  }
}
