// Make It — POST /api/agency/library/[assetId]/fork
// Fork an agency library asset into a target client's library.
// Body: { targetWorkspaceId }
// Returns { kind: "content"|"media", contentId|mediaId, workspaceId }.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { forkFromAgencyLibrary } from "@/server/modules/agency/library";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agCtx = await resolveAgency(req);
  if (!agCtx) return forbidden("Accès agence requis");
  const { assetId } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const targetWorkspaceId = asString(body.targetWorkspaceId);
  if (!targetWorkspaceId) return badRequest("Champ `targetWorkspaceId` requis");

  try {
    const result = await forkFromAgencyLibrary(
      agCtx.agencyId,
      targetWorkspaceId,
      assetId,
      user.id
    );
    await audit({
      userId: user.id,
      action: "agency.library.fork",
      entity: "AgencyLibraryAsset",
      entityId: assetId,
      metadata: {
        agencyId: agCtx.agencyId,
        targetWorkspaceId,
        resultKind: result.kind,
        resultId: result.kind === "content" ? result.contentId : result.mediaId,
      },
      ip: clientIp(req),
    });
    return ok({ result }, { forked: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("refusé") || msg.includes("insuffisant")) return forbidden(msg);
    if (msg.includes("introuvable") || msg.includes("appartient")) return notFound(msg);
    if (msg.includes("requis")) return badRequest(msg);
    return serverError("Échec du fork", { error: msg });
  }
}
