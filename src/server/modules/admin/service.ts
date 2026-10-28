// Make It — Admin service.
// `isAdmin(userEmail)` — MVP admin gate (allow only `demo@makeit.app`).
// `globalStats()` — global stats across all workspaces:
//   - users count
//   - workspaces count
//   - subscriptions (active count, by plan)
//   - credits (total purchased, total consumed across all wallets)
//   - AI jobs (by status)
//   - costs (sum of consumed credits as a proxy; per-operation breakdown)
//   - providers usage (mock — we only have the in-house provider)
//   - errors (failed jobs count + recent failed jobs)
//   - usage by feature (AI job type counts)

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

export const ADMIN_EMAIL = "demo@makeit.app";

export function isAdmin(userEmail: string | null | undefined): boolean {
  if (!userEmail) return false;
  return userEmail.toLowerCase() === ADMIN_EMAIL;
}

// ── globalStats ──────────────────────────────────────────────────────

export type GlobalStats = {
  users: { total: number };
  workspaces: { total: number; byPlan: Record<string, number> };
  subscriptions: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
    byPlan: Record<string, number>;
  };
  credits: {
    totalPurchased: number;
    totalConsumed: number;
    totalReserved: number;
    totalSubscription: number;
  };
  aiJobs: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    failedRecent: number;
  };
  costs: {
    consumedCreditsTotal: number;
    byOperation: Record<string, number>;
  };
  providers: {
    usage: Record<string, number>;
  };
  errors: {
    failedJobs: number;
    recentErrors: Array<{ id: string; type: string; error: string | null; createdAt: Date }>;
    recentAuditErrors: Array<{ id: string; action: string; metadata: string | null; createdAt: Date }>;
  };
  usageByFeature: Record<string, number>;
};

export async function globalStats(): Promise<GlobalStats> {
  const [
    usersCount,
    workspaces,
    subscriptions,
    wallets,
    aiJobStatusGroups,
    aiJobTypeGroups,
    failedJobs,
    recentFailedJobs,
    recentAuditErrors,
    costTxByOp,
  ] = await Promise.all([
    db.user.count(),
    db.workspace.findMany({ select: { plan: true } }),
    db.subscription.findMany({ select: { status: true, planId: true, plan: { select: { name: true } } } }),
    db.creditWallet.findMany({ select: { subscriptionCredits: true, purchasedCredits: true, reservedCredits: true, totalConsumed: true } }),
    db.aIJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.aIJob.groupBy({ by: ["type"], _count: { _all: true } }),
    db.aIJob.count({ where: { status: "failed" } }),
    db.aIJob.findMany({
      where: { status: "failed" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, error: true, createdAt: true },
    }),
    db.auditLog.findMany({
      where: { action: { contains: "error" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, metadata: true, createdAt: true },
    }),
    db.creditTransaction.groupBy({
      by: ["operation"],
      where: { type: "consumption" },
      _sum: { amount: true },
    }),
  ]);

  // ── Workspaces by plan ──
  const byPlan: Record<string, number> = {};
  for (const w of workspaces) byPlan[w.plan] = (byPlan[w.plan] ?? 0) + 1;

  // ── Subscriptions ──
  const byStatus: Record<string, number> = {};
  const subByPlan: Record<string, number> = {};
  let activeCount = 0;
  for (const s of subscriptions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === "active") activeCount++;
    const planName = s.plan?.name ?? "unknown";
    subByPlan[planName] = (subByPlan[planName] ?? 0) + 1;
  }

  // ── Wallets aggregate ──
  let totalPurchased = 0;
  let totalConsumed = 0;
  let totalReserved = 0;
  let totalSubscription = 0;
  for (const w of wallets) {
    totalPurchased += w.purchasedCredits;
    totalConsumed += w.totalConsumed;
    totalReserved += w.reservedCredits;
    totalSubscription += w.subscriptionCredits;
  }

  // ── AI jobs ──
  const byStatusJobs: Record<string, number> = {};
  for (const g of aiJobStatusGroups) byStatusJobs[g.status] = g._count._all;
  const byTypeJobs: Record<string, number> = {};
  for (const g of aiJobTypeGroups) byTypeJobs[g.type] = g._count._all;

  // ── Cost by operation (sum of negative `amount`s on consumption transactions) ──
  const byOp: Record<string, number> = {};
  for (const g of costTxByOp) {
    const op = g.operation ?? "unknown";
    const sum = Math.abs(g._sum.amount ?? 0);
    byOp[op] = (byOp[op] ?? 0) + sum;
  }

  return {
    users: { total: usersCount },
    workspaces: { total: workspaces.length, byPlan },
    subscriptions: {
      total: subscriptions.length,
      active: activeCount,
      byStatus,
      byPlan: subByPlan,
    },
    credits: {
      totalPurchased,
      totalConsumed,
      totalReserved,
      totalSubscription,
    },
    aiJobs: {
      total: aiJobStatusGroups.reduce((acc, g) => acc + g._count._all, 0),
      byStatus: byStatusJobs,
      byType: byTypeJobs,
      failedRecent: failedJobs,
    },
    costs: {
      consumedCreditsTotal: totalConsumed,
      byOperation: byOp,
    },
    providers: {
      usage: { "zai-web-dev-sdk": totalConsumed },
    },
    errors: {
      failedJobs: failedJobs,
      recentErrors: recentFailedJobs,
      recentAuditErrors,
    },
    usageByFeature: byTypeJobs,
  };
}

// ── Cost rules helpers (admin) ───────────────────────────────────────

export type CostRuleInput = {
  operation: string;
  provider?: string | null;
  model?: string | null;
  baseCost?: number;
  variableCost?: number;
  unit?: string | null;
  enabled?: boolean;
};

export async function listCostRules(): Promise<Array<{
  id: string;
  operation: string;
  provider: string | null;
  model: string | null;
  baseCost: number;
  variableCost: number;
  unit: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}>> {
  const rows = await db.aICostRule.findMany({ orderBy: { operation: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    operation: r.operation,
    provider: r.provider,
    model: r.model,
    baseCost: r.baseCost,
    variableCost: r.variableCost,
    unit: r.unit,
    enabled: r.enabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createCostRule(input: CostRuleInput) {
  if (!input.operation || !input.operation.trim()) throw new Error("Champ `operation` requis");
  const created = await db.aICostRule.create({
    data: {
      operation: input.operation.trim(),
      provider: input.provider ?? null,
      model: input.model ?? null,
      baseCost: typeof input.baseCost === "number" ? Math.max(0, Math.floor(input.baseCost)) : 0,
      variableCost: typeof input.variableCost === "number" && Number.isFinite(input.variableCost)
        ? Math.max(0, input.variableCost)
        : 0,
      unit: input.unit ?? null,
      enabled: input.enabled ?? true,
    },
  });
  return created;
}

export async function updateCostRule(id: string, patch: Partial<CostRuleInput>) {
  const existing = await db.aICostRule.findUnique({ where: { id } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.baseCost !== undefined && typeof patch.baseCost === "number") {
    data.baseCost = Math.max(0, Math.floor(patch.baseCost));
  }
  if (patch.variableCost !== undefined && typeof patch.variableCost === "number" && Number.isFinite(patch.variableCost)) {
    data.variableCost = Math.max(0, patch.variableCost);
  }
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.provider !== undefined) data.provider = patch.provider;
  if (patch.model !== undefined) data.model = patch.model;
  if (patch.unit !== undefined) data.unit = patch.unit;
  if (Object.keys(data).length === 0) return existing;
  const updated = await db.aICostRule.update({ where: { id }, data });
  return updated;
}

// ── Credit packs helpers (admin) ─────────────────────────────────────

export type PackInput = {
  name: string;
  credits: number;
  priceCents: number;
  active?: boolean;
  popular?: boolean;
};

export async function listPacksAdmin() {
  return db.creditPack.findMany({ orderBy: { priceCents: "asc" } });
}

export async function createPack(input: PackInput) {
  if (!input.name || !input.name.trim()) throw new Error("Champ `name` requis");
  if (typeof input.credits !== "number" || input.credits <= 0) throw new Error("Champ `credits` invalide");
  if (typeof input.priceCents !== "number" || input.priceCents < 0) throw new Error("Champ `priceCents` invalide");
  return db.creditPack.create({
    data: {
      name: input.name.trim(),
      credits: Math.floor(input.credits),
      priceCents: Math.floor(input.priceCents),
      active: input.active ?? true,
      popular: input.popular ?? false,
    },
  });
}

export async function updatePack(id: string, patch: Partial<PackInput>) {
  const existing = await db.creditPack.findUnique({ where: { id } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.credits !== undefined) data.credits = Math.floor(patch.credits);
  if (patch.priceCents !== undefined) data.priceCents = Math.floor(patch.priceCents);
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.popular !== undefined) data.popular = patch.popular;
  if (Object.keys(data).length === 0) return existing;
  return db.creditPack.update({ where: { id }, data });
}

// ── Subscription plans helpers (admin) ───────────────────────────────

export type PlanInput = {
  name: string;
  monthlyPrice: number;
  includedCredits: number;
  storageLimitMb?: number;
  socialAccountsLimit?: number;
  teamMembersLimit?: number;
  featureFlags?: Record<string, unknown> | null;
  active?: boolean;
};

export async function listPlansAdmin() {
  return db.subscriptionPlan.findMany({ orderBy: { monthlyPrice: "asc" } });
}

export async function createPlan(input: PlanInput) {
  if (!input.name || !input.name.trim()) throw new Error("Champ `name` requis");
  if (typeof input.monthlyPrice !== "number" || input.monthlyPrice < 0) throw new Error("Champ `monthlyPrice` invalide");
  if (typeof input.includedCredits !== "number" || input.includedCredits < 0) throw new Error("Champ `includedCredits` invalide");
  return db.subscriptionPlan.create({
    data: {
      name: input.name.trim(),
      monthlyPrice: Math.floor(input.monthlyPrice),
      includedCredits: Math.floor(input.includedCredits),
      storageLimitMb: Math.floor(input.storageLimitMb ?? 500),
      socialAccountsLimit: Math.floor(input.socialAccountsLimit ?? 2),
      teamMembersLimit: Math.floor(input.teamMembersLimit ?? 1),
      featureFlags: input.featureFlags ? JSON.stringify(input.featureFlags) : JSON.stringify({}),
      active: input.active ?? true,
    },
  });
}

export async function updatePlan(id: string, patch: Partial<PlanInput>) {
  const existing = await db.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.monthlyPrice !== undefined) data.monthlyPrice = Math.floor(patch.monthlyPrice);
  if (patch.includedCredits !== undefined) data.includedCredits = Math.floor(patch.includedCredits);
  if (patch.storageLimitMb !== undefined) data.storageLimitMb = Math.floor(patch.storageLimitMb);
  if (patch.socialAccountsLimit !== undefined) data.socialAccountsLimit = Math.floor(patch.socialAccountsLimit);
  if (patch.teamMembersLimit !== undefined) data.teamMembersLimit = Math.floor(patch.teamMembersLimit);
  if (patch.featureFlags !== undefined) data.featureFlags = patch.featureFlags ? JSON.stringify(patch.featureFlags) : JSON.stringify({});
  if (patch.active !== undefined) data.active = patch.active;
  if (Object.keys(data).length === 0) return existing;
  return db.subscriptionPlan.update({ where: { id }, data });
}

// ── All jobs (admin) ──────────────────────────────────────────────────

export async function listAllJobs(opts: {
  status?: string | null;
  type?: string | null;
  workspaceId?: string | null;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, Math.min(1000, Math.floor(opts.page ?? 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
  const where: { status?: string; type?: string; workspaceId?: string } = {};
  if (opts.status && opts.status.length > 0) where.status = opts.status;
  if (opts.type && opts.type.length > 0) where.type = opts.type;
  if (opts.workspaceId && opts.workspaceId.length > 0) where.workspaceId = opts.workspaceId;

  const [total, items] = await Promise.all([
    db.aIJob.count({ where }),
    db.aIJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        workspace: { select: { id: true, name: true, plan: true } },
        _count: { select: { logs: true } },
      },
    }),
  ]);
  return {
    items: items.map((j) => ({
      id: j.id,
      workspaceId: j.workspaceId,
      workspaceName: j.workspace?.name ?? null,
      workspacePlan: j.workspace?.plan ?? null,
      userId: j.userId,
      type: j.type,
      status: j.status,
      progress: j.progress,
      currentStep: j.currentStep,
      estimatedCredits: j.estimatedCredits,
      reservedCredits: j.reservedCredits,
      consumedCredits: j.consumedCredits,
      error: j.error,
      attempts: j.attempts,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      logCount: j._count.logs,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── Recent errors (admin) ─────────────────────────────────────────────

export async function recentErrors(opts: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
  const [failedJobs, auditErrors] = await Promise.all([
    db.aIJob.findMany({
      where: { status: "failed" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { workspace: { select: { id: true, name: true } } },
    }),
    db.auditLog.findMany({
      where: { action: { contains: "error" } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return {
    failedJobs: failedJobs.map((j) => ({
      id: j.id,
      workspaceId: j.workspaceId,
      workspaceName: j.workspace?.name ?? null,
      type: j.type,
      status: j.status,
      error: j.error,
      attempts: j.attempts,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
    auditErrors: auditErrors.map((a) => ({
      id: a.id,
      workspaceId: a.workspaceId,
      userId: a.userId,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.createdAt,
    })),
  };
}

// Re-export jsonParse for callers
export { jsonParse };
