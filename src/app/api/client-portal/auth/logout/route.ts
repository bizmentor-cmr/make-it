// Make It — POST /api/client-portal/auth/logout
// Stateless JWT — server just acknowledges logout (the client drops the token
// from localStorage / cookie). Returns ok.

import { NextRequest } from "next/server";
import { ok } from "@/server/core/api-response";
import { audit } from "@/server/core/audit";
import { requireClientPortal } from "@/server/modules/client-portal/auth";

export async function POST(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (ctx) {
    await audit({
      workspaceId: ctx.workspace.id,
      // NOTE: clientUser.id is a ClientUser id, not a User id — do NOT pass as `userId`.
      action: "client_portal.logout",
      entity: "ClientUser",
      entityId: ctx.clientUser.id,
      metadata: { clientUserId: ctx.clientUser.id, email: ctx.clientUser.email },
    });
  }
  // Stateless: nothing to invalidate server-side.
  return ok({ loggedOut: true });
}
