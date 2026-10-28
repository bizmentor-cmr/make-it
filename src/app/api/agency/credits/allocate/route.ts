// Make It — POST /api/agency/credits/allocate
// Admin/Manager sets or adjusts a credit allocation.
// Body: { scope: "manager"|"client"|"creative", agencyClientId?, userId?, quota }.

import { NextRequest } from "next/server";
import {
  ok,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { resolveAgency, isAgencyManager } from "@/server/core/rbac";
import { allocateCredits } from "@/server/modules/agency/credits";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!isAgencyManager(ctx)) return forbidden("Rôle manager+ requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const scope = body.scope;
  if (scope !== "manager" && scope !== "client" && scope !== "creative") {
    return badRequest("`scope` doit être 'manager' | 'client' | 'creative'");
  }
  const agencyClientId = asString(body.agencyClientId);
  const userId = asString(body.userId);
  const quotaRaw = body.quota;
  if (typeof quotaRaw !== "number" || !Number.isFinite(quotaRaw) || quotaRaw < 0) {
    return badRequest("`quota` doit être un entier ≥ 0");
  }

  try {
    const node = await allocateCredits(ctx.agencyId, ctx.userId, ctx.role, {
      scope,
      agencyClientId: agencyClientId ?? null,
      userId: userId ?? null,
      quota: Math.floor(quotaRaw),
    });
    return ok(node, { agencyId: ctx.agencyId }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis") || msg.includes("insuffisant") || msg.includes("admin")) {
      return forbidden(msg);
    }
    return serverError("Échec de l'allocation", { error: msg });
  }
}
