// Make It — GET /api/admin/jobs
// List all AI jobs across all workspaces (admin only), with filters + pagination.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { isAdmin, listAllJobs } from "@/server/modules/admin/service";

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");

  const url = new URL(req.url);
  const status = asString(url.searchParams.get("status"));
  const type = asString(url.searchParams.get("type"));
  const workspaceId = asString(url.searchParams.get("workspaceId"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);

  try {
    const res = await listAllJobs({ status, type, workspaceId, page, limit });
    return ok(
      { jobs: res.items },
      {
        page: res.page,
        limit: res.limit,
        total: res.total,
        pages: res.pages,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des jobs", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
