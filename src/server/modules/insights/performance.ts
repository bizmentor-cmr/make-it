// Make It — Insights Performance Engine.
// `computeScores(workspaceId)` computes the 8 Make It Growth sub-scores
// (Reach / Engagement / Growth / Content / Visibility / Conversion / Brand / Consistency)
// deterministically from AnalyticsSnapshot + brand setup + workspace learnings.
// No LLM — pure data crunching.
//
// The weighted `makeItScore` is a 0-100 integer used by the home dashboard ScoreRing.

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

export type SubScoreKey =
  | "reach"
  | "engagement"
  | "growth"
  | "content"
  | "visibility"
  | "conversion"
  | "brand"
  | "consistency";

export type SubScore = {
  key: SubScoreKey;
  label: string;
  value: number; // 0-100
  delta: number; // signed percent change vs previous period (rounded to 1 decimal)
  note: string;
};

export type ScoreResult = {
  total: number; // 0-100 integer
  delta: number; // signed percent vs previous period (1 decimal)
  subscores: SubScore[];
};

const SUBSCORE_WEIGHTS: Record<SubScoreKey, number> = {
  reach: 0.12,
  engagement: 0.18,
  growth: 0.15,
  content: 0.1,
  visibility: 0.1,
  conversion: 0.15,
  brand: 0.1,
  consistency: 0.1,
};

// ── Helpers ──────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function pctDelta(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// ── computeScores ────────────────────────────────────────────────────

export async function computeScores(workspaceId: string): Promise<ScoreResult> {
  const now = new Date();
  const curStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [curRows, prevRows, contentCount, brandProfile, brandIdentity, brandVoice, brandRules, learnings, plansCount] =
    await Promise.all([
      db.analyticsSnapshot.findMany({
        where: { workspaceId, date: { gte: curStart } },
      }),
      db.analyticsSnapshot.findMany({
        where: { workspaceId, date: { gte: prevStart, lt: curStart } },
      }),
      db.content.count({ where: { workspaceId } }),
      db.brandProfile.findUnique({ where: { workspaceId } }),
      db.brandIdentity.findUnique({ where: { workspaceId } }),
      db.brandVoice.findUnique({ where: { workspaceId } }),
      db.brandRules.findUnique({ where: { workspaceId } }),
      db.workspacePlatformLearning.findMany({ where: { workspaceId } }),
      db.editorialPlan.count({ where: { workspaceId } }),
    ]);

  // ── Reach sub-score ─────────────────────────────────────────────────
  // Reach score = saturation curve: 30-day total reach against a 100k benchmark.
  const curReach = curRows.reduce((s, r) => s + r.reach, 0);
  const prevReach = prevRows.reduce((s, r) => s + r.reach, 0);
  const reachValue = clamp100(Math.log10(Math.max(1, curReach)) * 25); // 1k → 75, 100k → ~125→100
  const reachDelta = pctDelta(curReach, prevReach);

  // ── Engagement sub-score ────────────────────────────────────────────
  const curImpressions = curRows.reduce((s, r) => s + r.impressions, 0);
  const prevImpressions = prevRows.reduce((s, r) => s + r.impressions, 0);
  const curEngagement = curRows.reduce((s, r) => s + r.engagement, 0);
  const prevEngagement = prevRows.reduce((s, r) => s + r.engagement, 0);
  const curEngRate = curImpressions > 0 ? curEngagement / curImpressions : 0;
  const prevEngRate = prevImpressions > 0 ? prevEngagement / prevImpressions : 0;
  // 5% engagement rate → ~71; 10% → ~83 (log-scaled so high values saturate gently)
  const engagementValue = clamp100(curEngRate > 0 ? Math.log10(curEngRate * 1000 + 1) * 50 : 0);
  const engagementDelta = pctDelta(curEngRate, prevEngRate);

  // ── Growth sub-score ───────────────────────────────────────────────
  const curFollowers = curRows.reduce((s, r) => s + r.followers, 0);
  const prevFollowers = prevRows.reduce((s, r) => s + r.followers, 0);
  // Assume a baseline audience of 5000 to estimate growth %.
  const baselineAudience = 5000;
  const growthPct = (curFollowers / baselineAudience) * 100; // ~ +1% per 50 new followers
  const growthValue = clamp100(Math.log10(Math.max(1, growthPct + 1)) * 80);
  const growthDelta = pctDelta(curFollowers, prevFollowers);

  // ── Content sub-score ───────────────────────────────────────────────
  // 6+ content items → 100; 3 → 60; 0 → 0.
  const contentValue = clamp100(Math.min(100, (contentCount / 6) * 100));
  const contentDelta = 0; // we don't track content history per period here

  // ── Visibility sub-score ────────────────────────────────────────────
  const curViews = curRows.reduce((s, r) => s + r.views, 0);
  const prevViews = prevRows.reduce((s, r) => s + r.views, 0);
  const visibilityValue = clamp100(Math.log10(Math.max(1, curViews + curImpressions)) * 20);
  const visibilityDelta = pctDelta(curViews + curImpressions, prevViews + prevImpressions);

  // ── Conversion sub-score ────────────────────────────────────────────
  const curConversions = curRows.reduce((s, r) => s + r.conversions, 0);
  const prevConversions = prevRows.reduce((s, r) => s + r.conversions, 0);
  const curRevenue = curRows.reduce((s, r) => s + r.revenueCents, 0);
  // 30 conversions/month → ~71; 100 conversions/month → ~83.
  const conversionRate = curImpressions > 0 ? curConversions / curImpressions : 0;
  const conversionValue = clamp100(
    Math.min(60, conversionRate * 10000) + Math.min(40, Math.log10(Math.max(1, curConversions + 1)) * 20)
  );
  const conversionDelta = pctDelta(curConversions, prevConversions);

  // ── Brand sub-score ─────────────────────────────────────────────────
  // Completeness: profile.businessName + description + industry + objectives + identity.colors +
  // voice.tone + rules.topicsToPromote = 8 fields. Each contributes 12.5 points.
  let brandFields = 0;
  if (brandProfile) {
    if (brandProfile.businessName) brandFields++;
    if (brandProfile.description) brandFields++;
    if (brandProfile.industry) brandFields++;
    if (jsonParse<string[]>(brandProfile.objectives, []).length > 0) brandFields++;
  }
  if (brandIdentity && jsonParse<string[]>(brandIdentity.colors, []).length > 0) brandFields++;
  if (brandVoice && brandVoice.tone) brandFields++;
  if (brandRules && jsonParse<string[]>(brandRules.topicsToPromote, []).length > 0) brandFields++;
  const brandValue = clamp100((brandFields / 8) * 100);
  const brandDelta = 0;

  // ── Consistency sub-score ───────────────────────────────────────────
  // Distinct days with analytics rows in the last 30 days → 30 → 100.
  const distinctDays = new Set(
    curRows.map((r) => {
      const d = new Date(r.date);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })
  ).size;
  const consistencyValue = clamp100((distinctDays / 30) * 100);
  // Consistency delta: distinct days this period vs previous period
  const prevDistinctDays = new Set(
    prevRows.map((r) => {
      const d = new Date(r.date);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })
  ).size;
  const consistencyDelta = pctDelta(distinctDays, prevDistinctDays);

  // ── Weighted total ──────────────────────────────────────────────────
  const subscores: SubScore[] = [
    { key: "reach", label: "Reach", value: reachValue, delta: reachDelta, note: `${curReach.toLocaleString("fr-FR")} comptes uniques (30j)` },
    { key: "engagement", label: "Engagement", value: engagementValue, delta: engagementDelta, note: `${(curEngRate * 100).toFixed(2)}% d'engagement (30j)` },
    { key: "growth", label: "Growth", value: growthValue, delta: growthDelta, note: `+${curFollowers} abonnés (30j)` },
    { key: "content", label: "Content", value: contentValue, delta: contentDelta, note: `${contentCount} contenus · ${plansCount} plan(s) éditorial(aux)` },
    { key: "visibility", label: "Visibility", value: visibilityValue, delta: visibilityDelta, note: `${curImpressions.toLocaleString("fr-FR")} impressions (30j)` },
    { key: "conversion", label: "Conversion", value: conversionValue, delta: conversionDelta, note: `${curConversions} conversions · ${(curRevenue / 100).toFixed(2)} € de revenu` },
    { key: "brand", label: "Brand", value: brandValue, delta: brandDelta, note: `${brandFields}/8 champs de marque remplis` },
    { key: "consistency", label: "Consistency", value: consistencyValue, delta: consistencyDelta, note: `${distinctDays}/30 jours avec activité` },
  ];

  const total = clamp100(
    subscores.reduce((acc, s) => acc + s.value * SUBSCORE_WEIGHTS[s.key], 0)
  );

  // Previous total (recompute with prevRows so we have a delta)
  const prevEngagementValue = clamp100(prevEngRate > 0 ? Math.log10(prevEngRate * 1000 + 1) * 50 : 0);
  const prevReachValue = clamp100(Math.log10(Math.max(1, prevReach)) * 25);
  const prevVisibilityValue = clamp100(Math.log10(Math.max(1, prevViews + prevImpressions)) * 20);
  const prevConversionRate = prevImpressions > 0 ? prevConversions / prevImpressions : 0;
  const prevConversionValue = clamp100(
    Math.min(60, prevConversionRate * 10000) + Math.min(40, Math.log10(Math.max(1, prevConversions + 1)) * 20)
  );
  const prevGrowthPct = (prevFollowers / baselineAudience) * 100;
  const prevGrowthValue = clamp100(Math.log10(Math.max(1, prevGrowthPct + 1)) * 80);

  const prevTotal = clamp100(
    prevReachValue * SUBSCORE_WEIGHTS.reach +
      prevEngagementValue * SUBSCORE_WEIGHTS.engagement +
      prevGrowthValue * SUBSCORE_WEIGHTS.growth +
      contentValue * SUBSCORE_WEIGHTS.content +
      prevVisibilityValue * SUBSCORE_WEIGHTS.visibility +
      prevConversionValue * SUBSCORE_WEIGHTS.conversion +
      brandValue * SUBSCORE_WEIGHTS.brand +
      (distinctDays / 30) * 100 * SUBSCORE_WEIGHTS.consistency // approximation
  );

  const delta = pctDelta(total, prevTotal);

  // Unused learnings var guard (kept for future expansion: per-platform bonus).
  void learnings;

  return { total, delta, subscores };
}
