// Make It — GET /api/billing/invoices
// Returns CreditPurchase history as "invoices" (mock). Real invoices (Stripe /
// Mobile Money provider receipts) would slot here.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";

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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);

  try {
    const [total, items] = await Promise.all([
      db.creditPurchase.count({ where: { workspaceId: ctx.workspaceId } }),
      db.creditPurchase.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Look up pack names for any purchases that referenced a packId.
    const packIds = items.map((i) => i.packId).filter((x): x is string => Boolean(x));
    const packs =
      packIds.length > 0
        ? await db.creditPack.findMany({ where: { id: { in: packIds } }, select: { id: true, name: true } })
        : [];
    const packNameById = new Map(packs.map((p) => [p.id, p.name]));

    return ok(
      {
        invoices: items.map((p) => ({
          id: p.id,
          workspaceId: p.workspaceId,
          packId: p.packId,
          packName: p.packId ? packNameById.get(p.packId) ?? null : null,
          credits: p.credits,
          amountCents: p.amountCents,
          currency: "EUR",
          provider: p.provider,
          status: p.status,
          createdAt: p.createdAt,
          // Mocked invoice URL — in production this would point to the
          // Stripe / Mobile Money provider-hosted PDF receipt.
          invoiceUrl: null,
        })),
      },
      {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des factures", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
