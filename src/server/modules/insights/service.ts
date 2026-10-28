// Make It — Insights service.
// `computeDeterministicInsights(workspaceId)` — derives 3-8 actionable insights from
// AnalyticsSnapshot WITHOUT the LLM. Each insight carries:
//   { id, category, severity, evidence, explanation, recommendation,
//     expectedImpact, impactScore (1-10), effortScore (1-10), urgencyScore (1-10),
//     confidence (0-1), priorityScore = impactScore * confidence / max(effortScore, 1) }
// `rankInsights(workspaceId)` — returns the insights sorted by priorityScore desc.
//
// The LLM path (`POST /api/insights/generate`) is async via job and the runner persists
// rows into the `Insight` table; this service computes deterministic insights on top
// of any LLM-persisted ones and merges them so the GET surface always returns useful,
// data-driven recommendations even before the first LLM call.

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

// ── Types ─────────────────────────────────────────────────────────────

export type InsightCategory = "performance" | "content" | "audience" | "timing" | "campaign" | "brand";
export type InsightSeverity = "info" | "warn" | "critical" | "opportunity";

export type InsightRow = {
  id: string;
  category: string;
  severity: string;
  evidence: string | null;
  explanation: string | null;
  recommendation: string | null;
  expectedImpact: string | null;
  impactScore: number | null;
  effortScore: number | null;
  urgencyScore: number | null;
  confidence: number | null;
  priorityScore: number | null;
  source: "deterministic" | "ai";
  createdAt: Date;
};

// ── Helpers ──────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  if (d === 0) return 0;
  return n / d;
}
function ratioStr(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function priorityScore(impact: number, effort: number, confidence: number): number {
  return Math.round((impact * confidence) / Math.max(effort, 1) * 100) / 100;
}

// ── computeDeterministicInsights ─────────────────────────────────────

export async function computeDeterministicInsights(workspaceId: string): Promise<InsightRow[]> {
  const now = new Date();
  const curStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const prevEnd = curStart;

  const [curRows, prevRows, learnings, brandProfile, socialCount, contentItems] = await Promise.all([
    db.analyticsSnapshot.findMany({
      where: { workspaceId, date: { gte: curStart } },
    }),
    db.analyticsSnapshot.findMany({
      where: { workspaceId, date: { gte: prevStart, lt: prevEnd } },
    }),
    db.workspacePlatformLearning.findMany({ where: { workspaceId } }),
    db.brandProfile.findUnique({ where: { workspaceId } }),
    db.socialAccount.count({ where: { workspaceId, status: "connected" } }),
    db.content.findMany({
      where: { workspaceId },
      select: { type: true, platforms: true, status: true, objective: true },
    }),
  ]);

  // Aggregate by platform for current + previous period
  type Agg = {
    impressions: number;
    engagement: number;
    clicks: number;
    conversions: number;
    reach: number;
    followers: number;
    revenueCents: number;
  };
  const blank = (): Agg => ({
    impressions: 0,
    engagement: 0,
    clicks: 0,
    conversions: 0,
    reach: 0,
    followers: 0,
    revenueCents: 0,
  });

  const curByPlatform = new Map<string, Agg>();
  for (const r of curRows) {
    const key = r.platform ?? "all";
    const acc = curByPlatform.get(key) ?? blank();
    acc.impressions += r.impressions;
    acc.engagement += r.engagement;
    acc.clicks += r.clicks;
    acc.conversions += r.conversions;
    acc.reach += r.reach;
    acc.followers += r.followers;
    acc.revenueCents += r.revenueCents;
    curByPlatform.set(key, acc);
  }
  const prevByPlatform = new Map<string, Agg>();
  for (const r of prevRows) {
    const key = r.platform ?? "all";
    const acc = prevByPlatform.get(key) ?? blank();
    acc.impressions += r.impressions;
    acc.engagement += r.engagement;
    acc.clicks += r.clicks;
    acc.conversions += r.conversions;
    acc.reach += r.reach;
    acc.followers += r.followers;
    acc.revenueCents += r.revenueCents;
    prevByPlatform.set(key, acc);
  }

  // Total period aggregates
  const curTotal = Array.from(curByPlatform.values()).reduce(
    (acc, a) => {
      acc.impressions += a.impressions;
      acc.engagement += a.engagement;
      acc.clicks += a.clicks;
      acc.conversions += a.conversions;
      acc.reach += a.reach;
      acc.followers += a.followers;
      acc.revenueCents += a.revenueCents;
      return acc;
    },
    blank()
  );
  const prevTotal = Array.from(prevByPlatform.values()).reduce(
    (acc, a) => {
      acc.impressions += a.impressions;
      acc.engagement += a.engagement;
      acc.clicks += a.clicks;
      acc.conversions += a.conversions;
      acc.reach += a.reach;
      acc.followers += a.followers;
      acc.revenueCents += a.revenueCents;
      return acc;
    },
    blank()
  );

  const insights: InsightRow[] = [];
  let idx = 0;
  const detId = (k: string) => `det_${workspaceId.slice(-8)}_${k}_${idx++}`;

  // ── Insight 1: Top performing platform (engagement) ─────────────────
  let topPlatform: string | null = null;
  let topEngRate = -1;
  for (const [platform, agg] of curByPlatform) {
    if (platform === "all") continue;
    const er = agg.impressions > 0 ? agg.engagement / agg.impressions : 0;
    if (er > topEngRate) {
      topEngRate = er;
      topPlatform = platform;
    }
  }
  if (topPlatform && topEngRate > 0) {
    const prevAgg = prevByPlatform.get(topPlatform);
    const prevEr = prevAgg && prevAgg.impressions > 0 ? prevAgg.engagement / prevAgg.impressions : 0;
    const diffPct = prevEr > 0 ? ((topEngRate - prevEr) / prevEr) * 100 : 0;
    insights.push({
      id: detId("top_platform"),
      category: "performance",
      severity: diffPct >= 10 ? "opportunity" : "info",
      evidence: `${topPlatform} : ${ratioStr(topEngRate)} d'engagement (vs ${ratioStr(prevEr)} sur la période précédente)`,
      explanation:
        diffPct >= 10
          ? `${topPlatform} est en forte progression (+${diffPct.toFixed(1)}% d'engagement).`
          : `${topPlatform} reste votre plateforme la plus performante.`,
      recommendation: `Concentrez 60% de votre effort éditorial sur ${topPlatform} et répliquez le format qui fonctionne.`,
      expectedImpact: `+15-25% d'engagement global`,
      impactScore: 8,
      effortScore: 4,
      urgencyScore: 7,
      confidence: 0.85,
      priorityScore: priorityScore(8, 4, 0.85),
      source: "deterministic",
      createdAt: now,
    });
  }

  // ── Insight 2: Best format from learnings vs actual ──────────────────
  const topLearning = learnings[0];
  if (topLearning?.bestFormat) {
    insights.push({
      id: detId("best_format"),
      category: "content",
      severity: "opportunity",
      evidence: `Format gagnant: ${topLearning.bestFormat} (${topLearning.samples} échantillons, ${topLearning.avgEngagement?.toFixed(1)}% engagement moyen)`,
      explanation: `D'après ${topLearning.samples} publications, le format ${topLearning.bestFormat} rétentionne le mieux votre audience.`,
      recommendation: `Produisez 2 ${topLearning.bestFormat}s par semaine pendant 4 semaines et mesurez la progression.`,
      expectedImpact: `+20% de rétention`,
      impactScore: 7,
      effortScore: 5,
      urgencyScore: 6,
      confidence: 0.8,
      priorityScore: priorityScore(7, 5, 0.8),
      source: "deterministic",
      createdAt: now,
    });
  }

  // ── Insight 3: Engagement trend (cur vs prev) ────────────────────────
  const curEr = curTotal.impressions > 0 ? curTotal.engagement / curTotal.impressions : 0;
  const prevEr = prevTotal.impressions > 0 ? prevTotal.engagement / prevTotal.impressions : 0;
  if (prevEr > 0) {
    const diff = curEr - prevEr;
    const diffPct = (diff / prevEr) * 100;
    if (Math.abs(diffPct) >= 5) {
      insights.push({
        id: detId("eng_trend"),
        category: "performance",
        severity: diffPct < -10 ? "critical" : diffPct < 0 ? "warn" : "opportunity",
        evidence: `Engagement global: ${ratioStr(curEr)} vs ${ratioStr(prevEr)} (${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%)`,
        explanation:
          diffPct < 0
            ? `L'engagement baisse de ${Math.abs(diffPct).toFixed(1)}% vs les 30 jours précédents.`
            : `L'engagement progresse de ${diffPct.toFixed(1)}% vs les 30 jours précédents.`,
        recommendation:
          diffPct < 0
            ? `Identifiez les posts qui ont performé en N-30 et répliquez leurs hooks/CTA.`
            : `Maintenez le rythme — capitalisez sur ce qui fonctionne avec 1 publication supplémentaire par semaine.`,
        expectedImpact: diffPct < 0 ? `Récupération de -12% → 0%` : `+5-10% d'engagement supplémentaire`,
        impactScore: diffPct < 0 ? 8 : 6,
        effortScore: diffPct < 0 ? 6 : 3,
        urgencyScore: diffPct < -10 ? 9 : 5,
        confidence: 0.85,
        priorityScore: priorityScore(diffPct < 0 ? 8 : 6, diffPct < 0 ? 6 : 3, 0.85),
        source: "deterministic",
        createdAt: now,
      });
    }
  }

  // ── Insight 4: Conversion rate per platform ──────────────────────────
  let bestConvPlatform: string | null = null;
  let bestConvRate = -1;
  for (const [platform, agg] of curByPlatform) {
    if (platform === "all") continue;
    const conv = agg.impressions > 0 ? agg.conversions / agg.impressions : 0;
    if (conv > bestConvRate) {
      bestConvRate = conv;
      bestConvPlatform = platform;
    }
  }
  if (bestConvPlatform && bestConvRate > 0) {
    insights.push({
      id: detId("top_conversion"),
      category: "performance",
      severity: "opportunity",
      evidence: `${bestConvPlatform} convertit à ${ratioStr(bestConvRate)} (${curByPlatform.get(bestConvPlatform)?.conversions} conversions)`,
      explanation: `Votre meilleur canal d'acquisition est ${bestConvPlatform}. Augmenter le budget ou la fréquence ici amplifie les résultats.`,
      recommendation: `Augmentez de 20% le volume de publication sur ${bestConvPlatform} et ajoutez 1 CTA WhatsApp par post.`,
      expectedImpact: `+15% de conversions`,
      impactScore: 8,
      effortScore: 4,
      urgencyScore: 7,
      confidence: 0.78,
      priorityScore: priorityScore(8, 4, 0.78),
      source: "deterministic",
      createdAt: now,
    });
  }

  // ── Insight 5: Best posting time ────────────────────────────────────
  if (topLearning?.bestTime) {
    insights.push({
      id: detId("best_time"),
      category: "timing",
      severity: "info",
      evidence: `Meilleur créneau: ${topLearning.bestTime}`,
      explanation: `Sur ${topLearning.samples} publications, le créneau ${topLearning.bestTime} capte le plus d'engagement.`,
      recommendation: `Planifiez vos prochaines publications clés sur le créneau ${topLearning.bestTime}.`,
      expectedImpact: `+10% d'engagement ponctuel`,
      impactScore: 5,
      effortScore: 2,
      urgencyScore: 4,
      confidence: 0.7,
      priorityScore: priorityScore(5, 2, 0.7),
      source: "deterministic",
      createdAt: now,
    });
  }

  // ── Insight 6: Brand profile completeness ───────────────────────────
  if (brandProfile) {
    const objectives = jsonParse<string[]>(brandProfile.objectives, []);
    const missingFields: string[] = [];
    if (!brandProfile.targetMarket) missingFields.push("audience cible");
    if (!brandProfile.positioning) missingFields.push("positionnement");
    if (!brandProfile.valueProposition) missingFields.push("proposition de valeur");
    if (objectives.length === 0) missingFields.push("objectifs");
    if (missingFields.length >= 2) {
      insights.push({
        id: detId("brand_incomplete"),
        category: "brand",
        severity: "warn",
        evidence: `Profil de marque incomplet: ${missingFields.length} champs manquants (${missingFields.join(", ")})`,
        explanation: `Un profil de marque complet améliore la cohérence IA et la qualité des suggestions.`,
        recommendation: `Complétez votre profil de marque (${missingFields.join(", ")}) dans la section Identité.`,
        expectedImpact: `+10% de pertinence des suggestions IA`,
        impactScore: 5,
        effortScore: 2,
        urgencyScore: 5,
        confidence: 0.75,
        priorityScore: priorityScore(5, 2, 0.75),
        source: "deterministic",
        createdAt: now,
      });
    }
  }

  // ── Insight 7: Social accounts connection ───────────────────────────
  if (socialCount < 2) {
    insights.push({
      id: detId("social_limited"),
      category: "brand",
      severity: "warn",
      evidence: `${socialCount} compte(s) social(aux) connecté(s)`,
      explanation: `Connecter plus de plateformes débloque l'atomisation multicanal et la publication croisée.`,
      recommendation: `Connectez au moins 3 plateformes (Instagram, TikTok, WhatsApp) pour activer la déclinaison automatique.`,
      expectedImpact: `+30% de portée potentielle`,
      impactScore: 7,
      effortScore: 2,
      urgencyScore: 6,
      confidence: 0.8,
      priorityScore: priorityScore(7, 2, 0.8),
      source: "deterministic",
      createdAt: now,
    });
  }

  // ── Insight 8: Content frequency ────────────────────────────────────
  const publishedCount = contentItems.filter((c) => c.status === "published").length;
  if (publishedCount < 3) {
    insights.push({
      id: detId("content_low"),
      category: "content",
      severity: "warn",
      evidence: `${publishedCount} contenu(s) publié(s) — objectif: ≥ 3 par mois`,
      explanation: `La fréquence de publication est sous le seuil d'engagement optimal.`,
      recommendation: `Générez un calendrier éditorial 30 jours et planifiez 3-4 publications par semaine.`,
      expectedImpact: `+25% de portée organique`,
      impactScore: 7,
      effortScore: 3,
      urgencyScore: 7,
      confidence: 0.82,
      priorityScore: priorityScore(7, 3, 0.82),
      source: "deterministic",
      createdAt: now,
    });
  }

  return insights;
}

// ── rankInsights ──────────────────────────────────────────────────────
// Merge deterministic insights + AI-persisted rows from the `Insight` table,
// sort by priorityScore desc. Deduplicate by recommendation similarity (skip exact duplicates).

export async function rankInsights(workspaceId: string): Promise<InsightRow[]> {
  const [deterministic, aiRows] = await Promise.all([
    computeDeterministicInsights(workspaceId),
    db.insight.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const aiMapped: InsightRow[] = aiRows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    evidence: r.evidence,
    explanation: r.explanation,
    recommendation: r.recommendation,
    expectedImpact: r.expectedImpact,
    impactScore: r.impactScore,
    effortScore: r.effortScore,
    urgencyScore: r.urgencyScore,
    confidence: r.confidence,
    priorityScore: r.priorityScore,
    source: "ai" as const,
    createdAt: r.createdAt,
  }));

  // Merge, dedupe by recommendation prefix (first 60 chars)
  const seen = new Set<string>();
  const merged: InsightRow[] = [];
  for (const ins of [...deterministic, ...aiMapped]) {
    const key = (ins.recommendation ?? "").slice(0, 60).toLowerCase().trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(ins);
  }

  // Sort by priorityScore desc (nulls last)
  merged.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  return merged;
}
