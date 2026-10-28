// Make It — POST /api/trends/[id]/sync
// Triggers a synchronous sync of one trend watch. Returns the discovered +
// inserted posts so the UI can render them immediately. The sync cap is 10
// results (see service.ts — overridable via `?maxResults=N` up to 20) so the
// synchronous call stays under ~15s even when web_search is slow.

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { syncTrendWatch } from "@/server/modules/trends/service";
import { db } from "@/lib/db";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

type CtxParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");
  const { id } = await params;

  // Verify the watch belongs to this workspace.
  const watch = await db.trendWatch.findUnique({
    where: { id },
    select: { workspaceId: true, name: true },
  });
  if (!watch || watch.workspaceId !== ctx.workspaceId) {
    return notFound("Veille introuvable");
  }

  // Allow the caller to ask for fewer results (faster) via `?maxResults=N`.
  const url = new URL(req.url);
  const maxParam = url.searchParams.get("maxResults");
  const maxResults = maxParam ? Math.max(3, Math.min(20, Number.parseInt(maxParam, 10) || 10)) : 10;

  try {
    const result = await syncTrendWatch(id, { maxResults });
    if (!result) return notFound("Veille introuvable");

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "trends.watch.sync",
      entity: "TrendWatch",
      entityId: id,
      metadata: {
        name: watch.name,
        discovered: result.discovered,
        inserted: result.inserted,
        skipped: result.skipped,
        failed: result.failed,
        maxResults,
      },
      ip: clientIp(req),
    });

    return ok(result, {
      watchId: id,
      syncedAt: result.syncedAt.toISOString(),
      synchronous: true,
    });
  } catch (e) {
    return serverError("Échec de la synchronisation de la veille", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
