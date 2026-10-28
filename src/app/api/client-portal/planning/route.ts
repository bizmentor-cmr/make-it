// Make It — GET /api/client-portal/planning
// Returns the client's editorial calendar (EditorialItems + Content scheduled/published).
// Read-only for the client — no mutations.

import { NextRequest } from "next/server";
import { ok, unauthorized, serverError } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";
import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";
import { listPendingValidations, type ValidationStage } from "@/server/modules/validation/service";

type ValidationStageMap = Map<string, ValidationStage>;

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");

  try {
    const workspaceId = ctx.workspace.id;

    // Pull editorial plans + items, plus scheduled/published content.
    const [plans, scheduledContent, pendingValidations] = await Promise.all([
      db.editorialPlan.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            orderBy: { day: "asc" },
          },
        },
      }),
      db.content.findMany({
        where: {
          workspaceId,
          status: { in: ["scheduled", "published", "ready", "draft"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          objective: true,
          platforms: true,
          updatedAt: true,
        },
      }),
      listPendingValidations(workspaceId).catch(() => []),
    ]);

    // Build a contentId → validation stage map.
    const stageMap: ValidationStageMap = new Map();
    for (const v of pendingValidations) {
      stageMap.set(v.contentId, v.stage);
    }

    const plansMapped = plans.map((p) => ({
      id: p.id,
      name: p.name,
      horizon: p.horizon,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
      objective: p.objective,
      items: p.items.map((it) => ({
        id: it.id,
        day: it.day,
        platform: it.platform,
        format: it.format,
        title: it.title,
        goal: it.goal,
        status: it.status,
        scheduledAt: it.scheduledAt ? it.scheduledAt.toISOString() : null,
        time: it.time,
        contentId: it.contentId,
        validationStage: it.contentId ? stageMap.get(it.contentId) ?? null : null,
      })),
    }));

    const contentMapped = scheduledContent.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      status: c.status,
      objective: c.objective,
      platforms: jsonParse<string[]>(c.platforms, []),
      updatedAt: c.updatedAt.toISOString(),
      validationStage: stageMap.get(c.id) ?? null,
    }));

    return ok(
      {
        plans: plansMapped,
        content: contentMapped,
      },
      {
        planCount: plansMapped.length,
        itemCount: plansMapped.reduce((acc, p) => acc + p.items.length, 0),
        contentCount: contentMapped.length,
        workspaceId,
        auth: "client-portal",
      }
    );
  } catch (e) {
    return serverError("Échec de lecture du planning client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
