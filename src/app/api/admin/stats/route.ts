// Make It — GET /api/admin/stats
// Global admin stats: users, workspaces, subscriptions, credits, AI jobs, costs,
// providers usage, errors, usage by feature.
// Gate: allow only if `user.email === "demo@makeit.app"` (MVP admin). 403 otherwise.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { globalStats, isAdmin } from "@/server/modules/admin/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) {
    return forbidden("Accès administrateur requis");
  }

  try {
    const stats = await globalStats();
    return ok({ stats }, { adminEmail: user.email });
  } catch (e) {
    return serverError("Échec du chargement des statistiques admin", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
