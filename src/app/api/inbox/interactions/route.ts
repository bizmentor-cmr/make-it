// Make It — GET /api/inbox/interactions
// List interactions (filterable by type, intent, status).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { listInteractions } from "@/server/modules/inbox/service";

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const type = asString(url.searchParams.get("type"));
  const intent = asString(url.searchParams.get("intent"));
  const status = asString(url.searchParams.get("status"));
  const limit = parsePositiveInt(url.searchParams.get("limit"), 100, 200);

  try {
    const interactions = await listInteractions(ctx.workspaceId, { type, intent, status, limit });
    return ok({ interactions }, { count: interactions.length, workspaceId: ctx.workspaceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de lecture des interactions", { error: msg });
  }
}
