// Make It — POST /api/notifications/read-all
// Mark all unread notifications as read for the active workspace.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { markAllRead } from "@/server/modules/notifications/service";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const res = await markAllRead(ctx.workspaceId);
    return ok({ updated: res.updated, markedRead: true }, { workspaceId: ctx.workspaceId });
  } catch (e) {
    return serverError("Échec du marquage", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
