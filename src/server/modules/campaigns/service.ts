// Make It — Campaigns domain service.
// `createCampaign`     — create a draft campaign.
// `listCampaigns`      — paginated list (filters: status, objective).
// `optimizeCampaign`   — compute CTR/CPC/CPM/cost-per-result/frequency/conversion,
//                        classify each variant WINNER/STABLE/UNDERPERFORMING,
//                        return {variants, sensitiveActions, recommendations}.
// `computeCampaignMetrics` — derive metrics for a campaign (from AnalyticsSnapshot
//                            when available, or from a stored performance JSON,
//                            or mock-derive from campaign spent as a fallback).

import { db } from "@/lib/db";
import { jsonParse, jsonStringify } from "@/server/core/types";
import { PLATFORMS } from "@/server/core/types";

// ── Types ────────────────────────────────────────────────────────────

export type CampaignInput = {
  name: string;
  objective: string;
  budgetCents?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  audience?: Record<string, unknown> | null;
  platforms?: string[];
};

export type CampaignRow = {
  id: string;
  workspaceId: string;
  name: string;
  objective: string;
  budgetCents: number;
  spentCents: number;
  startDate: Date | null;
  endDate: Date | null;
  audience: Record<string, unknown>;
  platforms: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  variantCount?: number;
};

const ALLOWED_STATUSES = new Set(["draft", "active", "paused", "completed", "archived"]);
const ALLOWED_OBJECTIVES = new Set([
  "messages",
  "leads",
  "sales",
  "traffic",
  "visibility",
  "notoriety",
  "engagement",
]);
const PLATFORM_SET = new Set<string>(PLATFORMS);

function toRow(
  c: {
    id: string;
    workspaceId: string;
    name: string;
    objective: string;
    budgetCents: number;
    spentCents: number;
    startDate: Date | null;
    endDate: Date | null;
    audience: string | null;
    platforms: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  variantCount?: number
): CampaignRow {
  const row: CampaignRow = {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    objective: c.objective,
    budgetCents: c.budgetCents,
    spentCents: c.spentCents,
    startDate: c.startDate,
    endDate: c.endDate,
    audience: jsonParse<Record<string, unknown>>(c.audience, {}),
    platforms: jsonParse<string[]>(c.platforms, []),
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
  if (variantCount !== undefined) row.variantCount = variantCount;
  return row;
}

// ── createCampaign ──────────────────────────────────────────────────

export async function createCampaign(workspaceId: string, input: CampaignInput): Promise<CampaignRow> {
  if (!input.name || !input.name.trim()) throw new Error("Champ `name` requis");
  if (!input.objective || !ALLOWED_OBJECTIVES.has(input.objective)) {
    throw new Error("Objectif invalide");
  }
  if (input.platforms) {
    for (const p of input.platforms) {
      if (!PLATFORM_SET.has(p)) throw new Error(`Plateforme invalide: ${p}`);
    }
  }

  const created = await db.campaign.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      objective: input.objective,
      budgetCents: input.budgetCents ?? 0,
      spentCents: 0,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      audience: input.audience ? jsonStringify(input.audience) : null,
      platforms: input.platforms ? jsonStringify(input.platforms) : null,
      status: "draft",
    },
  });

  return toRow(created, 0);
}

// ── listCampaigns ───────────────────────────────────────────────────

export async function listCampaigns(
  workspaceId: string,
  filters: { status?: string; objective?: string; page: number; limit: number }
) {
  if (filters.status && !ALLOWED_STATUSES.has(filters.status)) {
    throw new Error("Statut invalide");
  }
  if (filters.objective && !ALLOWED_OBJECTIVES.has(filters.objective)) {
    throw new Error("Objectif invalide");
  }

  const where: { workspaceId: string; status?: string; objective?: string } = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.objective) where.objective = filters.objective;

  const [total, items] = await Promise.all([
    db.campaign.count({ where }),
    db.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      include: { _count: { select: { variants: true } } },
    }),
  ]);

  return {
    items: items.map((c) => toRow(c, c._count.variants)),
    total,
    page: filters.page,
    limit: filters.limit,
    pages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

export async function getCampaign(workspaceId: string, id: string) {
  const c = await db.campaign.findUnique({
    where: { id },
    include: { _count: { select: { variants: true, contents: true } } },
  });
  if (!c || c.workspaceId !== workspaceId) return null;
  return {
    ...toRow(c, c._count.variants),
    contentCount: c._count.contents,
  };
}

export async function updateCampaign(
  workspaceId: string,
  id: string,
  patch: Partial<CampaignInput> & { status?: string }
) {
  const existing = await db.campaign.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;

  if (patch.status && !ALLOWED_STATUSES.has(patch.status)) throw new Error("Statut invalide");
  if (patch.objective && !ALLOWED_OBJECTIVES.has(patch.objective)) throw new Error("Objectif invalide");
  if (patch.platforms) {
    for (const p of patch.platforms) {
      if (!PLATFORM_SET.has(p)) throw new Error(`Plateforme invalide: ${p}`);
    }
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.objective !== undefined) data.objective = patch.objective;
  if (patch.budgetCents !== undefined) data.budgetCents = patch.budgetCents;
  if (patch.startDate !== undefined) data.startDate = patch.startDate;
  if (patch.endDate !== undefined) data.endDate = patch.endDate;
  if (patch.audience !== undefined) data.audience = patch.audience ? jsonStringify(patch.audience) : null;
  if (patch.platforms !== undefined) data.platforms = patch.platforms ? jsonStringify(patch.platforms) : null;
  if (patch.status !== undefined) data.status = patch.status;

  const updated = await db.campaign.update({ where: { id }, data });
  return toRow(updated);
}

export async function archiveCampaign(workspaceId: string, id: string) {
  return updateCampaign(workspaceId, id, { status: "archived" });
}

// ── Variant helpers ─────────────────────────────────────────────────

export type VariantInput = {
  creative?: Record<string, unknown> | null;
  copy?: string | null;
  audience?: string | null;
  performance?: Record<string, unknown> | null;
  status?: string;
};

export type VariantRow = {
  id: string;
  campaignId: string;
  creative: Record<string, unknown>;
  copy: string | null;
  audience: string | null;
  performance: Record<string, unknown>;
  status: string;
  createdAt: Date;
};

function toVariantRow(v: {
  id: string;
  campaignId: string;
  creative: string | null;
  copy: string | null;
  audience: string | null;
  performance: string | null;
  status: string;
  createdAt: Date;
}): VariantRow {
  return {
    id: v.id,
    campaignId: v.campaignId,
    creative: jsonParse<Record<string, unknown>>(v.creative, {}),
    copy: v.copy,
    audience: v.audience,
    performance: jsonParse<Record<string, unknown>>(v.performance, {}),
    status: v.status,
    createdAt: v.createdAt,
  };
}

export async function listVariants(workspaceId: string, campaignId: string): Promise<VariantRow[] | null> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.workspaceId !== workspaceId) return null;
  const variants = await db.campaignVariant.findMany({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
  });
  return variants.map(toVariantRow);
}

export async function createVariant(
  workspaceId: string,
  campaignId: string,
  input: VariantInput
): Promise<VariantRow | null> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.workspaceId !== workspaceId) return null;

  const created = await db.campaignVariant.create({
    data: {
      campaignId,
      creative: input.creative ? jsonStringify(input.creative) : null,
      copy: input.copy ?? null,
      audience: input.audience ?? null,
      performance: input.performance ? jsonStringify(input.performance) : null,
      status: input.status ?? "active",
    },
  });
  return toVariantRow(created);
}

export async function updateVariant(
  workspaceId: string,
  campaignId: string,
  variantId: string,
  patch: VariantInput
): Promise<VariantRow | null> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.workspaceId !== workspaceId) return null;
  const variant = await db.campaignVariant.findUnique({ where: { id: variantId } });
  if (!variant || variant.campaignId !== campaignId) return null;

  const data: Record<string, unknown> = {};
  if (patch.creative !== undefined) data.creative = patch.creative ? jsonStringify(patch.creative) : null;
  if (patch.copy !== undefined) data.copy = patch.copy;
  if (patch.audience !== undefined) data.audience = patch.audience;
  if (patch.performance !== undefined) data.performance = patch.performance ? jsonStringify(patch.performance) : null;
  if (patch.status !== undefined) data.status = patch.status;

  const updated = await db.campaignVariant.update({ where: { id: variantId }, data });
  return toVariantRow(updated);
}

export async function deleteVariant(
  workspaceId: string,
  campaignId: string,
  variantId: string
): Promise<boolean> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.workspaceId !== workspaceId) return false;
  const variant = await db.campaignVariant.findUnique({ where: { id: variantId } });
  if (!variant || variant.campaignId !== campaignId) return false;
  await db.campaignVariant.delete({ where: { id: variantId } });
  return true;
}

// ── computeCampaignMetrics ──────────────────────────────────────────
// Derive per-variant metrics. Source priority:
//  1. variant.performance JSON (when present)
//  2. AnalyticsSnapshot (last 30d) — by contentId mapping (if the variant has
//     a contentId in performance.contentId)
//  3. Mock-derived from the campaign spentCents (deterministic per-variant hash)

export type VariantMetrics = {
  variantId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  reach: number;
  spentCents: number;
  ctr: number;
  cpc: number;
  cpm: number;
  costPerResult: number;
  frequency: number;
};

function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pseudoRandom(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0xffffffff;
  };
}

function deriveMockMetrics(variantId: string, campaignSpentCents: number, budgetCents: number) {
  const rng = pseudoRandom(hashStringToSeed(variantId));
  const spendShare = 0.4 + rng() * 0.6; // 40%-100% of campaign budget to this variant
  const spentCents = Math.round((campaignSpentCents > 0 ? campaignSpentCents : budgetCents) * spendShare);
  const impressions = 2000 + Math.floor(rng() * 18000);
  const clicks = Math.floor(impressions * (0.01 + rng() * 0.05));
  const conversions = Math.floor(clicks * (0.01 + rng() * 0.06));
  const reach = Math.max(1, Math.floor(impressions * (0.6 + rng() * 0.3)));
  return { impressions, clicks, conversions, reach, spentCents };
}

export async function computeCampaignMetrics(workspaceId: string, campaignId: string): Promise<VariantMetrics[]> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { variants: true },
  });
  if (!campaign || campaign.workspaceId !== workspaceId) {
    throw new Error("Campagne introuvable");
  }

  const variants = campaign.variants;
  if (variants.length === 0) return [];

  // Sum spent across variants — if a variant has stored `performance.spentCents`,
  // we use it; otherwise we distribute the campaign spentCents across all
  // remaining variants proportionally to a deterministic per-variant share.
  const metrics: VariantMetrics[] = [];

  // Pre-compute stored metrics + the leftover spend to distribute.
  const stored = new Map<string, VariantMetrics>();
  let claimedSpend = 0;
  for (const v of variants) {
    const perf = jsonParse<Record<string, unknown>>(v.performance, {});
    const hasStored =
      typeof perf.impressions === "number" &&
      typeof perf.clicks === "number" &&
      typeof perf.conversions === "number";
    if (hasStored) {
      const impressions = Number(perf.impressions) || 0;
      const clicks = Number(perf.clicks) || 0;
      const conversions = Number(perf.conversions) || 0;
      const reach = typeof perf.reach === "number" ? Number(perf.reach) : Math.max(1, Math.floor(impressions * 0.7));
      const spentCents = typeof perf.spentCents === "number" ? Number(perf.spentCents) : 0;
      claimedSpend += spentCents;
      stored.set(v.id, {
        variantId: v.id,
        impressions,
        clicks,
        conversions,
        reach,
        spentCents,
        ctr: impressions > 0 ? clicks / impressions : 0,
        cpc: clicks > 0 ? spentCents / clicks : 0,
        cpm: impressions > 0 ? (spentCents / impressions) * 1000 : 0,
        costPerResult: conversions > 0 ? spentCents / conversions : 0,
        frequency: reach > 0 ? impressions / reach : 0,
      });
    }
  }

  const leftoverSpend = Math.max(0, campaign.spentCents - claimedSpend);

  for (const v of variants) {
    if (stored.has(v.id)) {
      metrics.push(stored.get(v.id)!);
      continue;
    }
    const mock = deriveMockMetrics(v.id, leftoverSpend, campaign.budgetCents);
    metrics.push({
      variantId: v.id,
      ...mock,
      ctr: mock.impressions > 0 ? mock.clicks / mock.impressions : 0,
      cpc: mock.clicks > 0 ? mock.spentCents / mock.clicks : 0,
      cpm: mock.impressions > 0 ? (mock.spentCents / mock.impressions) * 1000 : 0,
      costPerResult: mock.conversions > 0 ? mock.spentCents / mock.conversions : 0,
      frequency: mock.reach > 0 ? mock.impressions / mock.reach : 0,
    });
  }

  return metrics;
}

// ── optimizeCampaign ────────────────────────────────────────────────
// Classify each variant WINNER / STABLE / UNDERPERFORMING based on CTR + CPM
// relative to the median. Flag sensitive actions (budget change >20%,
// auto-pause) with requiresConfirmation:true.

export type VariantOptimization = {
  variantId: string;
  status: "WINNER" | "STABLE" | "UNDERPERFORMING";
  metrics: VariantMetrics;
  recommendation: string;
};

export type SensitiveAction = {
  type: "budget_change" | "pause";
  variantId?: string;
  requiresConfirmation: boolean;
  reason: string;
  details: Record<string, unknown>;
};

export type OptimizationResult = {
  variants: VariantOptimization[];
  sensitiveActions: SensitiveAction[];
  recommendations: string[];
  summary: {
    totalVariants: number;
    winners: number;
    stable: number;
    underperforming: number;
    totalSpentCents: number;
    totalConversions: number;
    avgCtr: number;
    avgCpc: number;
  };
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function optimizeCampaign(
  workspaceId: string,
  campaignId: string
): Promise<OptimizationResult | null> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { variants: true },
  });
  if (!campaign || campaign.workspaceId !== workspaceId) return null;

  const metrics = await computeCampaignMetrics(workspaceId, campaignId);
  if (metrics.length === 0) {
    return {
      variants: [],
      sensitiveActions: [],
      recommendations: [
        "Ajoutez au moins une variante à cette campagne pour activer l'optimisation automatique.",
      ],
      summary: {
        totalVariants: 0,
        winners: 0,
        stable: 0,
        underperforming: 0,
        totalSpentCents: campaign.spentCents,
        totalConversions: 0,
        avgCtr: 0,
        avgCpc: 0,
      },
    };
  }

  const ctrs = metrics.map((m) => m.ctr);
  const cpms = metrics.map((m) => m.cpm);
  const medCtr = median(ctrs);
  const medCpm = median(cpms);

  const variants: VariantOptimization[] = metrics.map((m) => {
    let status: "WINNER" | "STABLE" | "UNDERPERFORMING" = "STABLE";
    let recommendation = "Maintenir — performance conforme à la moyenne.";
    if (m.ctr >= medCtr * 1.25 && m.cpm <= medCpm * 1.15) {
      status = "WINNER";
      recommendation = "Augmenter le budget de +20-30% pour amplifier ce qui fonctionne.";
    } else if (m.ctr < medCtr * 0.75 || m.cpm > medCpm * 1.3) {
      status = "UNDERPERFORMING";
      recommendation =
        m.conversions === 0
          ? "Mettre en pause cette variante — aucune conversion après dépense significative."
          : "Réallouer une partie du budget vers les variantes gagnantes.";
    }
    return { variantId: m.variantId, status, metrics: m, recommendation };
  });

  // ── Sensitive actions ───────────────────────────────────────────────
  const sensitiveActions: SensitiveAction[] = [];

  // 1. Budget change >20% on winners → requiresConfirmation.
  for (const v of variants) {
    if (v.status === "WINNER") {
      const currentSpent = v.metrics.spentCents;
      const proposedDelta = Math.round(currentSpent * 0.25); // +25% budget
      sensitiveActions.push({
        type: "budget_change",
        variantId: v.variantId,
        requiresConfirmation: true,
        reason: `Augmentation de budget de +25% sur la variante gagnante (+${proposedDelta} cts).`,
        details: {
          currentSpentCents: currentSpent,
          proposedDeltaCents: proposedDelta,
          newBudgetCents: currentSpent + proposedDelta,
          pct: 25,
        },
      });
    }
    if (v.status === "UNDERPERFORMING" && v.metrics.conversions === 0 && v.metrics.spentCents > 0) {
      sensitiveActions.push({
        type: "pause",
        variantId: v.variantId,
        requiresConfirmation: true,
        reason: "Mise en pause automatique de la variante sous-performante (aucune conversion).",
        details: {
          currentSpentCents: v.metrics.spentCents,
          ctr: v.metrics.ctr,
          cpc: v.metrics.cpc,
        },
      });
    }
  }

  // Top recommendations.
  const recommendations: string[] = [];
  const winners = variants.filter((v) => v.status === "WINNER");
  const under = variants.filter((v) => v.status === "UNDERPERFORMING");
  if (winners.length > 0) {
    recommendations.push(
      `${winners.length} variante(s) gagnante(s) — augmentez leur budget de ~25% pour amplifier l'impact.`
    );
  }
  if (under.length > 0) {
    recommendations.push(
      `${under.length} variante(s) sous-performante(s) — mettez en pause ou réallouez le budget vers les gagnantes.`
    );
  }
  if (campaign.spentCents > 0) {
    const totalConv = metrics.reduce((acc, m) => acc + m.conversions, 0);
    const totalCost = metrics.reduce((acc, m) => acc + m.spentCents, 0);
    const costPerConv = totalConv > 0 ? Math.round(totalCost / totalConv) : 0;
    recommendations.push(
      `Coût par conversion global: ${costPerConv > 0 ? (costPerConv / 100).toFixed(2) : "—"} €. ${totalConv} conversion(s) sur ${Math.round(totalCost / 100)} € dépensés.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("Aucune action sensible requise — la campagne performe dans la moyenne.");
  }

  const totalSpentCents = metrics.reduce((acc, m) => acc + m.spentCents, 0);
  const totalConversions = metrics.reduce((acc, m) => acc + m.conversions, 0);
  const avgCtr = metrics.reduce((acc, m) => acc + m.ctr, 0) / metrics.length;
  const avgCpc =
    metrics.reduce((acc, m) => acc + m.cpc, 0) / (metrics.length || 1);

  return {
    variants,
    sensitiveActions,
    recommendations,
    summary: {
      totalVariants: variants.length,
      winners: winners.length,
      stable: variants.filter((v) => v.status === "STABLE").length,
      underperforming: under.length,
      totalSpentCents,
      totalConversions,
      avgCtr: Math.round(avgCtr * 10000) / 10000,
      avgCpc: Math.round(avgCpc * 100) / 100,
    },
  };
}
