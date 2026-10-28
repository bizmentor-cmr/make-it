// Make It — POST /api/client-portal/validations/[contentId]
// Client-side validation action: validate or refuse the content.
// Body: { action: "validate"|"refuse", comment?, reason? }
// Records the clientUserId on the ContentValidation row.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { db } from "@/lib/db";
import { clientValidate, clientRefuse } from "@/server/modules/validation/service";
import { audit } from "@/server/core/audit";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

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

  const comment = asString(body.comment) ?? undefined;
  const reason = asString(body.reason) ?? undefined;

  // Verify the content belongs to the client's workspace.
  const content = await db.content.findUnique({
    where: { id: contentId },
    select: { workspaceId: true, title: true },
  });
  if (!content || content.workspaceId !== ctx.workspace.id) {
    return forbidden("Ce contenu n'appartient pas à votre workspace");
  }

  try {
    const fwd = req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;

    const result =
      action === "validate"
        ? await clientValidate(contentId, ctx.clientUser.id, { comment })
        : await clientRefuse(contentId, ctx.clientUser.id, { reason });

    await audit({
      workspaceId: ctx.workspace.id,
      // NOTE: clientUser.id is a ClientUser id, not a User id — do NOT pass as `userId`.
      action:
        action === "validate"
          ? "client_portal.validation.validate"
          : "client_portal.validation.refuse",
      entity: "ContentValidation",
      entityId: result.id,
      metadata: {
        clientUserId: ctx.clientUser.id,
        clientEmail: ctx.clientUser.email,
        contentId,
        contentTitle: content.title,
        comment: comment ?? null,
        reason: reason ?? null,
        ip,
      },
    });

    return ok(result, { contentId, action, auth: "client-portal" }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("Transition impossible")) {
      return badRequest(msg);
    }
    return serverError("Échec de l'action de validation", { error: msg });
  }
}
