// Make It — POST /api/credits/estimate
// Pre-confirm endpoint: estimate the credits needed for an operation and
// report whether the wallet has enough. Used to power "≈X crédits, solde après ≈Y" UI.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { estimateCost } from "@/server/core/ai-cost";
import { getWallet, availableBalance } from "@/server/core/credits";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const operation = asString(body.operation);
  if (!operation) return badRequest("Champ `operation` requis");

  const quantity =
    typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0
      ? Math.floor(body.quantity)
      : 1;

  try {
    const estimate = await estimateCost(operation, quantity);
    const wallet = await getWallet(ctx.workspaceId);
    const available = availableBalance(wallet);
    const sufficient = available >= estimate.estimated;
    const balanceAfter = Math.max(0, available - estimate.estimated);

    return ok(
      {
        estimated: estimate.estimated,
        operation,
        quantity,
        available,
        sufficient,
        balanceAfter,
        ruleId: estimate.ruleId,
      },
      { workspaceId: ctx.workspaceId }
    );
  } catch (e) {
    return serverError("Échec de l'estimation des crédits", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
