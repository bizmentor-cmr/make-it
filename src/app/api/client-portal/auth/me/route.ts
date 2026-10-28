// Make It — GET /api/client-portal/auth/me
// Returns the current client portal context (clientUser, agencyClient, workspace, branding).
// 401 if the bearer token is missing/invalid.

import { NextRequest } from "next/server";
import { ok, unauthorized } from "@/server/core/api-response";
import { requireClientPortal } from "@/server/modules/client-portal/auth";

export async function GET(req: NextRequest) {
  const ctx = await requireClientPortal(req);
  if (!ctx) return unauthorized("Token client invalide ou expiré");
  return ok(ctx, { auth: "client-portal" });
}
