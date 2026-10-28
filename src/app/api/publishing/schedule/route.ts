// Make It — POST /api/publishing/schedule
// Schedule a publication: create Publication (status "pending") + enqueue a
// publishing job that runs at scheduledAt (mock: setTimeout until that instant).

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
import { schedulePublication } from "@/server/modules/publishing/service";

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
  const socialAccountId = asString(body.socialAccountId);
  if (!contentId) return badRequest("Champ `contentId` requis");
  if (!socialAccountId) return badRequest("Champ `socialAccountId` requis");

  let scheduledAt: Date | null = null;
  if (typeof body.scheduledAt === "string") {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) return badRequest("Date `scheduledAt` invalide");
    scheduledAt = d;
  }

  try {
    const publication = await schedulePublication(ctx.workspaceId, {
      contentId,
      socialAccountId,
      scheduledAt,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "publishing.schedule",
      entity: "Publication",
      entityId: publication.id,
      metadata: { contentId, socialAccountId, scheduledAt },
      ip: clientIp(req),
    });

    return ok(
      { publicationId: publication.id, status: publication.status },
      { queued: true },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("introuvable") || msg.includes("non connecté") || msg.includes("Validation requise")) {
      return badRequest(msg);
    }
    return serverError("Échec de la planification", { error: msg });
  }
}
