// Make It — GET /api/credits/transactions
// Paginated CreditTransaction history (filterable by type, operation; newest first).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, badRequest } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";

const ALLOWED_TYPES = new Set([
  "consumption",
  "allocation",
  "purchase",
  "refund",
  "bonus",
  "expiration",
  "reservation",
  "release",
]);

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
  const type = url.searchParams.get("type");
  const operation = url.searchParams.get("operation");

  if (type && !ALLOWED_TYPES.has(type)) {
    return badRequest("Type de transaction invalide", { type, allowed: Array.from(ALLOWED_TYPES) });
  }

  const where: { workspaceId: string; type?: string; operation?: string } = { workspaceId: ctx.workspaceId };
  if (type) where.type = type;
  if (operation) where.operation = operation;

  const [total, items] = await Promise.all([
    db.creditTransaction.count({ where }),
    db.creditTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return ok(
    {
      items: items.map((t) => ({
        id: t.id,
        workspaceId: t.workspaceId,
        userId: t.userId,
        type: t.type,
        operation: t.operation,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        referenceId: t.referenceId,
        note: t.note,
        createdAt: t.createdAt,
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
}
