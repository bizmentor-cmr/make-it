// Make It — GET /api/client-portal/content
// Returns the client's content (filterable by status). Includes the validation
// stage for each content. Read-only.

import { NextRequest } from "next/server";
import { ok, unauthorized, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";
import { listPendingValidations, type ValidationStage } from "@/server/modules/validation/service";

const STATUS_FILTERS = new Set(["draft", "idea", "ready", "scheduled", "published", "failed"]);

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const status = statusParam && STATUS_FILTERS.has(statusParam) ? statusParam : undefined;

    const [contentItems, pendingValidations] = await Promise.all([
      db.content.findMany({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          objective: true,
          pillar: true,
          platforms: true,
          metadata: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      listPendingValidations(workspaceId).catch(() => []),
    ]);

    const stageMap = new Map<string, ValidationStage>();
    for (const v of pendingValidations) {
      stageMap.set(v.contentId, v.stage);
    }

    // Resolve the latest ContentVersion's contentData for preview.
    const contentIds = contentItems.map((c) => c.id);
    const versions = await db.contentVersion.findMany({
      where: { contentId: { in: contentIds } },
      orderBy: { version: "desc" },
      distinct: ["contentId"],
      select: { contentId: true, contentData: true, version: true },
    });
    const versionMap = new Map(versions.map((v) => [v.contentId, v]));

    const items = contentItems.map((c) => {
      const version = versionMap.get(c.id);
      let preview: { hook?: string; body?: string; cta?: string; hashtags?: string[]; mediaUrl?: string } | null = null;
      if (version?.contentData) {
        preview = jsonParse<Record<string, unknown>>(version.contentData, {}) as {
          hook?: string;
          body?: string;
          cta?: string;
          hashtags?: string[];
          mediaUrl?: string;
        };
      }
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        status: c.status,
        objective: c.objective,
        pillar: c.pillar,
        platforms: jsonParse<string[]>(c.platforms, []),
        updatedAt: c.updatedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        validationStage: stageMap.get(c.id) ?? null,
        preview,
        version: version?.version ?? null,
      };
    });

    return ok(
      { items },
      {
        count: items.length,
        filterStatus: status ?? null,
        workspaceId,
        auth: "client-portal",
      }
    );
  } catch (e) {
    return serverError("Échec de lecture du contenu client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
