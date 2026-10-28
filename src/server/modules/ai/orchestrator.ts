// Make It — AI orchestrator.
// The orchestrator NEVER calls an arbitrary single model — it dispatches by task type
// to the appropriate `@/server/core/ai` method. It also builds compact brand + performance
// context strings used by every prompt template (chat, text_generation, atomize, adapt, ...).

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

// ── Operation → AI provider method ────────────────────────────────────
// The orchestrator maps a high-level "task intent" to the cheapest enabled AI operation.
// It does NOT pick a model — it dispatches by task type.
export type AIIntent =
  | "text"
  | "image"
  | "image_edit"
  | "vision"
  | "video"
  | "tts"
  | "transcribe"
  | "web_search"
  | "page_read"
  | "atomize"
  | "adapt"
  | "calendar"
  | "style_analysis"
  | "style_recreate"
  | "message_analysis"
  | "report"
  | "insight"
  | "auto_video_edit";

export type RouteResult = {
  intent: AIIntent;
  operation: string; // cost-operation key used by estimateCost
  capability: "text" | "vision" | "image" | "image_edit" | "video" | "audio_tts" | "audio_asr" | "web";
};

const ROUTING: Record<AIIntent, { operation: string; capability: RouteResult["capability"] }> = {
  text: { operation: "text_generation", capability: "text" },
  image: { operation: "image_generation", capability: "image" },
  image_edit: { operation: "image_edit", capability: "image_edit" },
  vision: { operation: "video_analysis", capability: "vision" },
  video: { operation: "video_generation", capability: "video" },
  tts: { operation: "chat", capability: "audio_tts" }, // approximate; tts has no dedicated cost rule yet
  transcribe: { operation: "transcription", capability: "audio_asr" },
  web_search: { operation: "chat", capability: "web" },
  page_read: { operation: "chat", capability: "web" },
  atomize: { operation: "atomize", capability: "text" },
  adapt: { operation: "adapt", capability: "text" },
  calendar: { operation: "calendar_generate", capability: "text" },
  style_analysis: { operation: "style_analysis", capability: "vision" },
  style_recreate: { operation: "image_generation", capability: "image" },
  message_analysis: { operation: "message_analysis", capability: "text" },
  report: { operation: "report", capability: "text" },
  insight: { operation: "insight", capability: "text" },
  auto_video_edit: { operation: "video_render", capability: "vision" },
};

// routeTask(intent, context?) → picks the operation / capability for a task.
// Runners call this to know which `@/server/core/ai` method to invoke and which cost operation
// to attribute. The orchestrator NEVER calls a model directly.
export function routeTask(intent: AIIntent, _context?: Record<string, unknown>): RouteResult {
  const r = ROUTING[intent];
  if (!r) throw new Error(`Unknown AI intent: ${intent}`);
  return { intent, operation: r.operation, capability: r.capability };
}

// ── Brand context ──────────────────────────────────────────────────────
// Compact summary of BrandProfile + BrandIdentity + BrandVoice + BrandRules.
// Used by every prompt template so the LLM respects the workspace's brand.
export async function buildBrandContext(workspaceId: string): Promise<string> {
  const [profile, identity, voice, rules] = await Promise.all([
    db.brandProfile.findUnique({ where: { workspaceId } }),
    db.brandIdentity.findUnique({ where: { workspaceId } }),
    db.brandVoice.findUnique({ where: { workspaceId } }),
    db.brandRules.findUnique({ where: { workspaceId } }),
  ]);

  const parts: string[] = [];

  if (profile) {
    parts.push(
      `Marque : ${profile.businessName}` +
        (profile.industry ? ` (${profile.industry})` : "") +
        (profile.description ? ` — ${profile.description}` : "")
    );
    if (profile.positioning) parts.push(`Positionnement : ${profile.positioning}`);
    if (profile.valueProposition) parts.push(`Proposition de valeur : ${profile.valueProposition}`);
    if (profile.targetMarket) parts.push(`Audience cible : ${profile.targetMarket}`);
    if (profile.country) parts.push(`Marché : ${profile.country}`);
    const objectives = jsonParse<string[]>(profile.objectives, []);
    if (objectives.length) parts.push(`Objectifs : ${objectives.join(", ")}`);
  }

  if (identity) {
    const colors = jsonParse<string[]>(identity.colors, []);
    if (colors.length) parts.push(`Couleurs : ${colors.join(", ")}`);
    const fonts = jsonParse<string[]>(identity.fonts, []);
    if (fonts.length) parts.push(`Typographies : ${fonts.join(", ")}`);
    if (identity.visualStyle) parts.push(`Style visuel : ${identity.visualStyle}`);
    if (identity.imageryStyle) parts.push(`Style d'images : ${identity.imageryStyle}`);
  }

  if (voice) {
    const bits: string[] = [];
    if (voice.tone) bits.push(`Ton = ${voice.tone}`);
    if (voice.personality) bits.push(`Personnalité = ${voice.personality}`);
    if (voice.formality) bits.push(`Formalité = ${voice.formality}`);
    if (voice.humor) bits.push(`Humour = ${voice.humor}`);
    if (bits.length) parts.push(`Voix : ${bits.join(" · ")}`);
    const vocabulary = jsonParse<string[]>(voice.vocabulary, []);
    if (vocabulary.length) parts.push(`Vocabulaire clé : ${vocabulary.join(", ")}`);
    const localExpressions = jsonParse<string[]>(voice.localExpressions, []);
    if (localExpressions.length) parts.push(`Expressions locales : ${localExpressions.join(", ")}`);
  }

  if (rules) {
    const promote = jsonParse<string[]>(rules.topicsToPromote, []);
    if (promote.length) parts.push(`Sujets à valoriser : ${promote.join(", ")}`);
    const avoid = jsonParse<string[]>(rules.topicsToAvoid, []);
    if (avoid.length) parts.push(`Sujets à éviter : ${avoid.join(", ")}`);
    const wordsUse = jsonParse<string[]>(rules.wordsToUse, []);
    if (wordsUse.length) parts.push(`Mots à privilégier : ${wordsUse.join(", ")}`);
    const wordsAvoid = jsonParse<string[]>(rules.wordsToAvoid, []);
    if (wordsAvoid.length) parts.push(`Mots à éviter : ${wordsAvoid.join(", ")}`);
    const claims = jsonParse<string[]>(rules.claims, []);
    if (claims.length) parts.push(`Promesses : ${claims.join(", ")}`);
    const cta = jsonParse<string[]>(rules.ctaPreferences, []);
    if (cta.length) parts.push(`CTA préférés : ${cta.join(", ")}`);
  }

  return parts.length ? parts.join("\n") : "(aucun profil de marque configuré)";
}

// ── Performance context ─────────────────────────────────────────────────
// Top format + best time + best platform extracted from WorkspacePlatformLearning
// and the last 30 days of AnalyticsSnapshot. Compact, numeric, fed to adapt/calendar/insight.
export async function buildPerformanceContext(workspaceId: string): Promise<string> {
  const learnings = await db.workspacePlatformLearning.findMany({
    where: { workspaceId },
    orderBy: { avgEngagement: "desc" },
  });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db.analyticsSnapshot.findMany({
    where: { workspaceId, date: { gte: since } },
    select: { platform: true, impressions: true, engagement: true, clicks: true, conversions: true },
  });

  // Aggregate by platform
  const byPlatform = new Map<string, { impressions: number; engagement: number; clicks: number; conversions: number }>();
  for (const r of rows) {
    const key = r.platform ?? "all";
    const acc = byPlatform.get(key) ?? { impressions: 0, engagement: 0, clicks: 0, conversions: 0 };
    acc.impressions += r.impressions;
    acc.engagement += r.engagement;
    acc.clicks += r.clicks;
    acc.conversions += r.conversions;
    byPlatform.set(key, acc);
  }

  // Best platform = highest impressions
  let bestPlatform: string | null = null;
  let bestPlatformImp = -1;
  for (const [k, v] of byPlatform) {
    if (v.impressions > bestPlatformImp) {
      bestPlatformImp = v.impressions;
      bestPlatform = k;
    }
  }

  // Top format from learnings
  const topLearning = learnings[0] ?? null;
  const topFormat = topLearning?.bestFormat ?? null;
  const bestTime = topLearning?.bestTime ?? null;

  const parts: string[] = [];
  if (bestPlatform) parts.push(`Meilleure plateforme (30j) : ${bestPlatform} (${bestPlatformImp} impressions)`);
  if (topFormat) parts.push(`Meilleur format : ${topFormat}`);
  if (bestTime) parts.push(`Meilleur créneau : ${bestTime}`);
  if (topLearning?.bestTone) parts.push(`Ton qui performe : ${topLearning.bestTone}`);

  if (learnings.length > 1) {
    const summary = learnings
      .slice(0, 4)
      .map((l) => `${l.platform}: ${l.bestFormat ?? "?"} / ${l.bestTime ?? "?"} / engagement ${l.avgEngagement?.toFixed(1) ?? "?"}%`)
      .join(" | ");
    parts.push(`Par plateforme : ${summary}`);
  }

  return parts.length ? parts.join("\n") : "(pas encore assez de données de performance)";
}

// ── Trend context ───────────────────────────────────────────────────────
// Compact summary of the workspace's trend watches + discovered posts.
// Fed into the calendar_generate + text_generation runners so the AI suggests
// content aligned with current trends (top hashtags, top platforms, top angles).
// Returns "(aucune veille configurée)" when the workspace has no watches, so
// the runner can skip this block without a noisy empty line.
export async function buildTrendContext(workspaceId: string): Promise<string> {
  // Lazy import — keeps the orchestrator free of a hard dependency on the
  // trends service at module-load time (avoids a potential circular import
  // since trends/service imports textChat from core/ai via the runners).
  const { getTrendInsights } = await import("@/server/modules/trends/service");
  let insights: Awaited<ReturnType<typeof getTrendInsights>>;
  try {
    insights = await getTrendInsights(workspaceId);
  } catch {
    return "(veille indisponible)";
  }
  if (insights.watchCount === 0 || insights.postCount === 0) {
    return "(aucune veille configurée)";
  }
  const parts: string[] = [];
  parts.push(`Veille : ${insights.watchCount} veille(s), ${insights.postCount} posts analysés`);
  if (insights.sector) parts.push(`Secteur surveillé : ${insights.sector}`);
  if (insights.recentKeywords.length) {
    parts.push(`Mots-clés surveillés : ${insights.recentKeywords.join(", ")}`);
  }
  if (insights.topPlatforms.length) {
    const plat = insights.topPlatforms
      .map((p) => `${p.platform} (${p.count} posts${p.avgEngagement != null ? `, ${p.avgEngagement.toFixed(1)}% eng.` : ""})`)
      .join(" · ");
    parts.push(`Plateformes tendance : ${plat}`);
  }
  if (insights.topHashtags.length) {
    parts.push(`Hashtags émergents : ${insights.topHashtags.slice(0, 6).map((h) => h.tag).join(", ")}`);
  }
  if (insights.topAngles.length) {
    const angles = insights.topAngles
      .slice(0, 4)
      .map((a) => `« ${a.angle} » (${a.platform}${a.engagementRate != null ? `, ${a.engagementRate.toFixed(1)}%` : ""})`)
      .join(" · ");
    parts.push(`Angles marketing performants : ${angles}`);
  }
  if (insights.lastSyncAt) {
    parts.push(`Dernière sync veille : ${insights.lastSyncAt.toISOString().slice(0, 10)}`);
  }
  return parts.join("\n");
}
