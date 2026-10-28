// Make It — POST /api/agency/switch/[clientId]
// Switch the active client. Verifies the user has access (via AgencyClientAccess
// OR is an agency admin/manager — admins/managers can access any client).
// Returns the workspace context for that client — the frontend uses this to
// pin the active workspace (setActiveClientId + setWorkspaceHeader).

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { switchClient } from "@/server/modules/agency/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { clientId } = await ctx.params;
  if (!clientId) return badRequest("clientId requis");

  try {
    const result = await switchClient({ clientId, userId: user.id });
    return ok(
      result,
      {
        agencyId: result.client.agencyId,
        workspaceId: result.client.workspaceId,
        role: result.client.role,
        ip: clientIp(req),
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CLIENT_NOT_FOUND") return notFound("Client introuvable");
    if (msg === "CLIENT_ARCHIVED") return badRequest("Ce client est archivé");
    if (msg === "NO_ACCESS") return forbidden("Vous n'avez pas accès à ce client");
    return serverError("Échec du changement de client", { error: msg });
  }
}
