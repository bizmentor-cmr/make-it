// Make It — POST /api/content/[id]/duplicate
// Duplicates a content (new id, status draft, title + " (copie)").

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { duplicateContent } from "@/server/modules/content/service";

type CtxParams = { params: Promise<{ id: string }> };

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;
  try {
    const dup = await duplicateContent(ctx.workspaceId, id);
    if (!dup) return notFound("Contenu introuvable");
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "content.duplicate",
      entity: "Content",
      entityId: dup.id,
      metadata: { sourceId: id },
      ip: clientIp(req),
    });
    return ok(dup, { duplicated: true, sourceId: id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la duplication", { error: msg });
  }
}
