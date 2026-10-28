// Make It — GET /api/auth/me
// Returns current session + active workspace + wallet summary.
// Active workspace is resolved via resolveWorkspace(req) — falls back to first membership.

import { NextRequest } from "next/server";
import { ok, unauthorized } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, listUserWorkspaces } from "@/server/core/rbac";
import { getWallet, availableBalance } from "@/server/core/credits";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const ctx = await resolveWorkspace(req);
  const workspaces = await listUserWorkspaces(user.id);

  let workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    role: string;
  } | null = null;
  let wallet: {
    subscriptionCredits: number;
    purchasedCredits: number;
    reservedCredits: number;
    totalConsumed: number;
    available: number;
  } | null = null;

  if (ctx) {
    workspace = {
      id: ctx.workspaceId,
      name: ctx.workspaceName,
      slug: workspaces.find((w) => w.id === ctx.workspaceId)?.slug ?? "",
      plan: ctx.plan,
      role: ctx.role,
    };
    const w = await getWallet(ctx.workspaceId);
    wallet = {
      subscriptionCredits: w.subscriptionCredits,
      purchasedCredits: w.purchasedCredits,
      reservedCredits: w.reservedCredits,
      totalConsumed: w.totalConsumed,
      available: availableBalance(w),
    };
  }

  return ok({
    user: { id: user.id, email: user.email, name: user.name },
    workspace,
    wallet,
    workspaces,
  });
}
