// Make It — GET /api/content/[id]/compare?a=vid1&b=vid2
// Returns both contentData so the frontend can diff.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, notFound } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { getVersion } from "@/server/modules/content/service";

type CtxParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { id } = await params;
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b) return badRequest("Paramètres `a` et `b` requis (ids de versions)");

  const va = await getVersion(ctx.workspaceId, id, a);
  const vb = await getVersion(ctx.workspaceId, id, b);
  if (!va || !vb) return notFound("Version introuvable");

  return ok({ a: va, b: vb }, { contentId: id });
}
