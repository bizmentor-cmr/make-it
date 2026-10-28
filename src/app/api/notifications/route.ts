// Make It — GET /api/notifications
// List notifications (filterable by read, level, type; paginated; newest first).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { listNotifications, type NotificationLevel } from "@/server/modules/notifications/service";

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

const ALLOWED_LEVELS = new Set<string>(["info", "success", "warning", "danger"]);

function parseRead(v: string | null): boolean | null {
  if (v === null) return null;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const read = parseRead(url.searchParams.get("read"));
  const level = asString(url.searchParams.get("level"));
  if (level && !ALLOWED_LEVELS.has(level)) return badRequest("Niveau invalide", { level });
  const type = asString(url.searchParams.get("type"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);

  try {
    const res = await listNotifications(ctx.workspaceId, {
      read,
      level: level as NotificationLevel | null,
      type,
      page,
      limit,
    });
    return ok(
      { notifications: res.items },
      {
        page: res.page,
        limit: res.limit,
        total: res.total,
        pages: res.pages,
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des notifications", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
