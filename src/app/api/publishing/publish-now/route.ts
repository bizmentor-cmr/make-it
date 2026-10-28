// Make It — POST /api/publishing/publish-now
// Multi-platform immediate publish. Body: { contentId, socialAccountIds: [] }.
// Creates N publications + publishes immediately (mock publisher), returns
// {published: [{publicationId, platform, status, ...}]}.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { publishNow } from "@/server/modules/publishing/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const contentId = asString(body.contentId);
  if (!contentId) return badRequest("Champ `contentId` requis");

  const socialAccountIds = Array.isArray(body.socialAccountIds)
    ? (body.socialAccountIds as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  if (socialAccountIds.length === 0) {
    return badRequest("Champ `socialAccountIds` (non vide) requis");
  }

  try {
    const result = await publishNow(ctx.workspaceId, { contentId, socialAccountIds });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "publishing.publish_now",
      entity: "Content",
      entityId: contentId,
      metadata: {
        socialAccountIds,
        published: result.published.map((r) => ({
          publicationId: r.publicationId,
          platform: r.platform,
          status: r.status,
        })),
      },
      ip: clientIp(req),
    });

    return ok(
      result,
      {
        count: result.published.length,
        succeeded: result.published.filter((r) => r.status === "published").length,
        failed: result.published.filter((r) => r.status !== "published").length,
      },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("requis") || msg.includes("Validation requise")) {
      return badRequest(msg);
    }
    return serverError("Échec de la publication multi-plateforme", { error: msg });
  }
}
