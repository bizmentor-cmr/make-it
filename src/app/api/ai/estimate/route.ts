// Make It — POST /api/ai/estimate
// Pre-confirm endpoint — lets the frontend show "≈420 crédits, solde après ≈860"
// BEFORE the user accepts a generation. Returns { estimated, available, sufficient, balanceAfter }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { estimateCost } from "@/server/core/ai-cost";
import { getWallet, availableBalance } from "@/server/core/credits";

const TYPE_TO_OPERATION: Record<string, string> = {
  text: "text_generation",
  image: "image_generation",
  atomize: "atomize",
  adapt: "adapt",
  calendar: "calendar_generate",
  message_analysis: "message_analysis",
  report: "report",
  insight: "insight",
  chat: "chat",
};

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

  const type = asString(body.type);
  if (!type || !TYPE_TO_OPERATION[type]) {
    return badRequest("Type invalide", { type, allowed: Object.keys(TYPE_TO_OPERATION) });
  }
  const operation = TYPE_TO_OPERATION[type];

  // Quantity: for atomize = platforms count, for chat = 1, etc.
  let quantity = 1;
  if (type === "atomize" && Array.isArray(body.platforms)) {
    quantity = Math.max(1, (body.platforms as unknown[]).length);
  } else if (typeof body.quantity === "number" && Number.isFinite(body.quantity)) {
    quantity = Math.max(1, Math.floor(body.quantity));
  }

  const estimate = await estimateCost(operation, quantity);
  const wallet = await getWallet(ctx.workspaceId);
  const available = availableBalance(wallet);
  const sufficient = available >= estimate.estimated;
  const balanceAfter = Math.max(0, available - estimate.estimated);

  return ok({
    estimated: estimate.estimated,
    operation,
    quantity,
    available,
    sufficient,
    balanceAfter,
    ruleId: estimate.ruleId,
  }, { workspaceId: ctx.workspaceId });
}
