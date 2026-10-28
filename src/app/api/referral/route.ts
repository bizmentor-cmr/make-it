// Make It — GET / POST /api/referral
// GET  : returns the authenticated user's referral stats (code, link, clicks,
//        signups, conversions, creditsEarned, pendingReferrals, recentReferrals).
//        Auto-creates a code on first call so the stats are never empty.
// POST : regenerate the user's active referral code. The previous code is
//        deactivated — any previously shared /ref/{old} link stops working.

import { NextRequest } from "next/server";
import { ok, unauthorized, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import {
  getReferralStats,
  regenerateReferralCode,
} from "@/server/modules/referral/service";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  try {
    const stats = await getReferralStats(user.id);
    return ok(stats, { userId: user.id });
  } catch (e) {
    return serverError("Échec de lecture des stats de parrainage", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }
  // Require explicit confirmation — regenerating invalidates the previous
  // link (any shared /ref/{old} URL stops working). The frontend should
  // confirm via an AlertDialog; we double-check here.
  if (body.confirm !== true && body.regenerate !== true) {
    return badRequest("Confirmation requise", {
      hint: "Envoyer { confirm: true } pour régénérer votre code.",
    });
  }

  try {
    const result = await regenerateReferralCode(user.id);
    return ok(
      { code: result.code, id: result.id, createdAt: result.createdAt },
      { regenerated: true }
    );
  } catch (e) {
    return serverError("Impossible de régénérer le code", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
