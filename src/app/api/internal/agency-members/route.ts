// Make It — GET /api/internal/agency-members
// List members of the user's active agency for @mentions + DM creation in
// agency mode. Returns `{ members: [{id, userId, name, email, avatarUrl, role}] }`
// (excludes the current user).
//
// Convenience route for the agency-mode InternalMessagesSection — equivalent
// to `GET /api/internal/members?scope=agency` but explicit. Resolves the
// agency from the X-Agency-Id header / ?agencyId= query / first membership.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency } from "@/server/core/rbac";
import { listAgencyMembers } from "@/server/modules/messaging/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");

  try {
    const members = await listAgencyMembers(ctx.agencyId);
    const filtered = members.filter((m) => m.userId !== user.id);
    return ok(
      { members: filtered },
      { agencyId: ctx.agencyId, role: ctx.role, count: filtered.length }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture des membres d'agence", { error: msg });
  }
}
