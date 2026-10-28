// Make It — GET / POST /api/content/[id]/versions
// List ContentVersion; POST creates a new version.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { listVersions, createVersion } from "@/server/modules/content/service";

type CtxParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { id } = await params;
  const versions = await listVersions(ctx.workspaceId, id);
  if (versions === null) return notFound("Contenu introuvable");
  return ok(versions, { count: versions.length, contentId: id });
}

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  try {
    const v = await createVersion(ctx.workspaceId, id, {
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      contentData: (body.contentData as Record<string, unknown>) ?? {},
      createdById: user.id,
    });
    if (!v) return notFound("Contenu introuvable");
    return ok(v, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de la création de version", { error: msg });
  }
}
