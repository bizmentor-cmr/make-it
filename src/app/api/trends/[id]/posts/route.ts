// Make It — GET /api/trends/[id]/posts
// Lists the discovered TrendPost rows for a single watch. Filterable by
// platform + savedOnly, sortable by engagementRate / relevanceScore /
// discoveredAt, paginated. Scoped by workspaceId (via the watch relation).

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
import { resolveWorkspace } from "@/server/core/rbac";
import { listTrendPosts } from "@/server/modules/trends/service";
import { db } from "@/lib/db";

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

const SORT_BY = new Set(["engagementRate", "relevanceScore", "discoveredAt"]);

type CtxParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { id } = await params;

  // Verify the watch belongs to this workspace.
  const watch = await db.trendWatch.findUnique({
    where: { id },
    select: { workspaceId: true },
  });
  if (!watch || watch.workspaceId !== ctx.workspaceId) {
    return notFound("Veille introuvable");
  }

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 50);
  const platform = url.searchParams.get("platform") ?? undefined;
  const savedOnly = url.searchParams.get("savedOnly") === "true";
  let sortBy = url.searchParams.get("sortBy") ?? "discoveredAt";
  if (!SORT_BY.has(sortBy)) {
    return badRequest("sortBy invalide", { allowed: Array.from(SORT_BY) });
  }
  // Defensive — narrow the union.
  const sortByTyped: "engagementRate" | "relevanceScore" | "discoveredAt" =
    sortBy as "engagementRate" | "relevanceScore" | "discoveredAt";

  try {
    const res = await listTrendPosts({
      watchId: id,
      platform,
      savedOnly,
      sortBy: sortByTyped,
      page,
      limit,
    });
    return ok(res.items, {
      page: res.page,
      limit: res.limit,
      total: res.total,
      pages: res.pages,
      workspaceId: ctx.workspaceId,
      watchId: id,
    });
  } catch (e) {
    return serverError("Échec de la lecture des posts", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
