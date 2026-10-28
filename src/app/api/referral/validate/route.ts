// Make It — GET /api/referral/validate  (PUBLIC — no auth required)
// Validates a referral code and returns `{ valid, referrerName, code }`.
// Used by the public `/ref/[code]` landing page to render "Invité par [name]"
// before the visitor decides to sign up.

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/server/core/api-response";
import { validateReferralCode } from "@/server/modules/referral/service";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toLowerCase();
  if (!code) return badRequest("Paramètre `code` requis");

  const result = await validateReferralCode(code);
  return ok(result, { code });
}
