// Make It — POST /api/validation/[contentId]/cdp
// CDP action: validate (pending_cdp → pending_client|validated) or refuse.
// Body: { action: "validate"|"refuse", comment?, reason? }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { cdpValidate, cdpRefuse } from "@/server/modules/validation/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  // CDP = manager+ role (CDP is the "chef de projet" within the agency).
  if (!hasRole(ctx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");

  const { contentId } = await params;
  if (!contentId) return badRequest("contentId requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const action = body.action;
  if (action !== "validate" && action !== "refuse") {
    return badRequest("`action` doit être 'validate' ou 'refuse'");
  }
  const comment = typeof body.comment === "string" ? body.comment : undefined;
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  try {
    const v =
      action === "validate"
        ? await cdpValidate(contentId, user.id, { comment })
        : await cdpRefuse(contentId, user.id, { reason });
    return ok(v, { workspaceId: ctx.workspaceId }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("Transition impossible")) {
      return badRequest(msg);
    }
    return serverError("Échec de l'action CDP", { error: msg });
  }
}
