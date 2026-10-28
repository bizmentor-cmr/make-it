// Make It — POST /api/validation/[contentId]/submit
// Submits the content for CDP validation (draft → pending_cdp).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { submitForCdpValidation } from "@/server/modules/validation/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  const { contentId } = await params;
  if (!contentId) return badRequest("contentId requis");

  try {
    const v = await submitForCdpValidation(contentId, user.id);
    return ok(v, { workspaceId: ctx.workspaceId }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("Transition impossible")) {
      return badRequest(msg);
    }
    return serverError("Échec de la soumission", { error: msg });
  }
}
