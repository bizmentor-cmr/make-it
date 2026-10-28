// Make It — POST /api/content/[id]/versions/[vid] (restore)
// Restores an old version by creating a NEW version copying the old contentData.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { restoreVersion } from "@/server/modules/content/service";

type CtxParams = { params: Promise<{ id: string; vid: string }> };

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id, vid } = await params;

  try {
    const v = await restoreVersion(ctx.workspaceId, id, vid, user.id);
    if (!v) return notFound("Version ou contenu introuvable");
    return ok(v, { restored: true, contentId: id, versionId: vid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la restauration", { error: msg });
  }
}
