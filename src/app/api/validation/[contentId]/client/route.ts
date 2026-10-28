// Make It — POST /api/validation/[contentId]/client
// Client portal action: validate (pending_client → validated) or refuse.
// Body: { action: "validate"|"refuse", comment?, reason?, clientUserId }.
//
// The clientUserId must reference a ClientUser row belonging to the agency client
// that owns this content's workspace. We verify ownership before allowing the
// transition. (P4 will wire the actual client portal auth; for now, the agency
// UI can call this endpoint on behalf of a client by passing clientUserId.)

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { clientValidate, clientRefuse } from "@/server/modules/validation/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

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
  const clientUserId = asString(body.clientUserId);
  if (!clientUserId) return badRequest("`clientUserId` requis");

  // Verify the ClientUser belongs to the agency client owning this workspace.
  const client = await db.agencyClient.findUnique({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!client) return forbidden("Ce workspace n'est pas un client d'agence");
  const clientUser = await db.clientUser.findUnique({
    where: { id: clientUserId },
  });
  if (!clientUser || clientUser.agencyClientId !== client.id) {
    return forbidden("ClientUser invalide pour ce client");
  }

  const comment = typeof body.comment === "string" ? body.comment : undefined;
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  try {
    const v =
      action === "validate"
        ? await clientValidate(contentId, clientUserId, { comment })
        : await clientRefuse(contentId, clientUserId, { reason });
    return ok(v, { workspaceId: ctx.workspaceId }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("Transition impossible")) {
      return badRequest(msg);
    }
    return serverError("Échec de l'action client", { error: msg });
  }
}
