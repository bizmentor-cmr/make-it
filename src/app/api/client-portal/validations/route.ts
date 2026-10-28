// Make It — GET /api/client-portal/validations
// Returns the list of content awaiting the client's validation (stage = pending_client).
// Each item includes a preview (latest ContentVersion) so the portal can render
// a one-tap validate / refuse card.

import { NextRequest } from "next/server";
import { ok, unauthorized, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";
import {
  listPendingValidations,
  type ValidationStage,
} from "@/server/modules/validation/service";

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;

    const pending = await listPendingValidations(workspaceId, "pending_client" as ValidationStage);
    const contentIds = pending.map((p) => p.contentId);
    if (contentIds.length === 0) {
      return ok({ items: [] }, { count: 0, workspaceId, auth: "client-portal" });
    }

    const [contentItems, versions, cdpUser] = await Promise.all([
      db.content.findMany({
        where: { id: { in: contentIds } },
        select: {
          id: true,
          title: true,
          type: true,
          objective: true,
          platforms: true,
          updatedAt: true,
        },
      }),
      db.contentVersion.findMany({
        where: { contentId: { in: contentIds } },
        orderBy: { version: "desc" },
        distinct: ["contentId"],
        select: { contentId: true, contentData: true, version: true },
      }),
      Promise.all(
        pending
          .filter((p) => p.cdpValidatedById)
          .map(async (p) => {
            // cdpValidatedById can be a User id (agency member) — fetch the name.
            const u = await db.user
              .findUnique({
                where: { id: p.cdpValidatedById as string },
                select: { id: true, name: true, email: true },
              })
              .catch(() => null);
            return [p.contentId, u] as const;
          })
      ),
    ]);

    const contentMap = new Map(contentItems.map((c) => [c.id, c]));
    const versionMap = new Map(versions.map((v) => [v.contentId, v]));
    const cdpMap = new Map<string, { id: string; name: string | null; email: string } | null>(
      cdpUser.map(([cid, u]) => [cid, u])
    );

    const items = pending.map((p) => {
      const c = contentMap.get(p.contentId);
      const v = versionMap.get(p.contentId);
      let preview: {
        hook?: string;
        body?: string;
        cta?: string;
        hashtags?: string[];
        mediaUrl?: string;
      } | null = null;
      if (v?.contentData) {
        preview = jsonParse<Record<string, unknown>>(v.contentData, {}) as {
          hook?: string;
          body?: string;
          cta?: string;
          hashtags?: string[];
          mediaUrl?: string;
        };
      }
      return {
        contentId: p.contentId,
        title: c?.title ?? p.contentTitle ?? "Sans titre",
        type: c?.type ?? null,
        objective: c?.objective ?? null,
        platforms: c ? jsonParse<string[]>(c.platforms, []) : [],
        updatedAt: c?.updatedAt ? c.updatedAt.toISOString() : p.updatedAt,
        stage: p.stage,
        cdpValidatedBy: cdpMap.get(p.contentId) ?? null,
        cdpComment: p.cdpComment,
        cdpValidatedAt: p.cdpValidatedAt,
        preview,
        version: v?.version ?? null,
      };
    });

    return ok(
      { items },
      {
        count: items.length,
        workspaceId,
        auth: "client-portal",
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des validations client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
