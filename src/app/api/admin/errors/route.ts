// Make It — GET /api/admin/errors
// Recent failed AI jobs + error audit logs (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { isAdmin, recentErrors } from "@/server/modules/admin/service";

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
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);

  try {
    const res = await recentErrors({ limit });
    return ok(
      { failedJobs: res.failedJobs, auditErrors: res.auditErrors },
      {
        count: res.failedJobs.length + res.auditErrors.length,
        limit,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des erreurs", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
