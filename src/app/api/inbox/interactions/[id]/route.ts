// Make It — GET / PATCH /api/inbox/interactions/[id]
// GET   : one interaction.
// PATCH : update status (new | handled | ignored).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getInteraction, updateInteractionStatus } from "@/server/modules/inbox/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  const interaction = await getInteraction(wsCtx.workspaceId, id);
  if (!interaction) return notFound("Interaction introuvable");

  return ok({ interaction });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const status = asString(body.status);
  if (!status) return badRequest("Champ `status` requis");

  try {
    const updated = await updateInteractionStatus(wsCtx.workspaceId, id, status);
    if (!updated) return notFound("Interaction introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "inbox.interaction.update",
      entity: "Interaction",
      entityId: id,
      metadata: { status: updated.status },
      ip: clientIp(req),
    });

    return ok({ interaction: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}
