// Make It — GET /api/billing/packs
// List all active CreditPacks. Public-ish read (any member).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const packs = await db.creditPack.findMany({
      where: { active: true },
      orderBy: [{ popular: "desc" }, { priceCents: "asc" }],
    });

    return ok(
      {
        packs: packs.map((p) => ({
          id: p.id,
          name: p.name,
          credits: p.credits,
          priceCents: p.priceCents,
          active: p.active,
          popular: p.popular,
        })),
      },
      { count: packs.length, workspaceId: ctx.workspaceId }
    );
  } catch (e) {
    return serverError("Échec de lecture des packs", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
