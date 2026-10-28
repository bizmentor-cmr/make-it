// Make It — GET /api/workspaces/active
// Resolves the active workspace for the current request using resolveWorkspace(req).
// Returns the workspace context (id, name, plan, role, slug, wallet summary).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { getWallet, availableBalance } from "@/server/core/credits";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const ws = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });
  const wallet = await getWallet(ctx.workspaceId);

  return ok({
    workspace: {
      id: ctx.workspaceId,
      name: ctx.workspaceName,
      slug: ws?.slug ?? "",
      plan: ctx.plan,
      role: ctx.role,
    },
    wallet: {
      subscriptionCredits: wallet.subscriptionCredits,
      purchasedCredits: wallet.purchasedCredits,
      reservedCredits: wallet.reservedCredits,
      totalConsumed: wallet.totalConsumed,
      available: availableBalance(wallet),
    },
  });
}
