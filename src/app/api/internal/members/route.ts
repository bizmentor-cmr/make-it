// Make It — GET /api/internal/members
// List members of the active context (workspace members OR agency members) for
// @mentions + DM creation.
//
// Scope:
//   - `?scope=agency` (or X-Agency-Id header) → agency members.
//   - otherwise → workspace members (active workspace).
//
// Returns `{ members: [{id, userId, name, email, avatarUrl, role}] }`
// (excludes the current user — no point mentioning / DM-ing yourself).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, resolveAgency } from "@/server/core/rbac";
import {
  listWorkspaceMembers,
  listAgencyMembers,
} from "@/server/modules/messaging/service";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const wantsAgency =
    url.searchParams.get("scope") === "agency" ||
    !!req.headers.get("x-agency-id") ||
    url.searchParams.has("agencyId");

  if (wantsAgency) {
    const ctx = await resolveAgency(req);
    if (!ctx) return forbidden("Accès agence requis");
    try {
      const members = await listAgencyMembers(ctx.agencyId);
      const filtered = members.filter((m) => m.userId !== user.id);
      return ok(
        { members: filtered },
        { agencyId: ctx.agencyId, scope: "agency", count: filtered.length }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return serverError("Échec de lecture des membres d'agence", { error: msg });
    }
  }

  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const members = await listWorkspaceMembers(ctx.workspaceId);
    const filtered = members.filter((m) => m.userId !== user.id);
    return ok(
      { members: filtered },
      { workspaceId: ctx.workspaceId, count: filtered.length }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de lecture des membres", { error: msg });
  }
}
