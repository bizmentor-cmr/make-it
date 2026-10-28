// Make It — POST /api/referral/track  (PUBLIC — no auth required)
// Records a click on a referral code: increments the code's `clicks` counter
// and creates a `ReferralClick` row with the visitor's IP + user agent (best-
// effort). Idempotent at the row level — every visit is recorded. Returns
// 200 even for unknown codes (no leak).

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/server/core/api-response";
import { trackClick } from "@/server/modules/referral/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON invalide");
  }

  const code =
    typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!code) return badRequest("Champ `code` requis");

  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const result = await trackClick(code, { ip, userAgent });
    return ok(result, { recorded: result.recorded });
  } catch (e) {
    // Don't leak errors to the public — return a 200 with recorded=false.
    return ok({ recorded: false, referrerName: null });
  }
}
