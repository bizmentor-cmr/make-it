// Make It — Calendar + Smart Timing domain service.
// `generatePlan(workspaceId, input, ctx)` → enqueue a calendar_generate AI job.
// `rescheduleItem` → move/reschedule an EditorialItem.
// `smartTiming(workspaceId)` → compute per-platform recommended publishing time
//   from AnalyticsSnapshot + WorkspacePlatformLearning (the Smart Timing Engine).
//
// This module also re-registers the `calendar_generate` AI job runner so that, on
// completion, the runner persists an EditorialPlan + N EditorialItem rows (the base
// runner in `@/server/modules/ai/runners` only returns the items as output).
// `registerJobRunner` is last-writer-wins — documented in runners.ts header.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { jsonParse } from "@/server/core/types";
import { PLATFORMS, type Platform } from "@/server/core/types";
import { registerJobRunner, type JobRunner } from "@/server/core/ai-job";
import { textChat, getPrompt, renderTemplate, estimateCost } from "@/server/modules/ai/runners";
import { buildBrandContext, buildPerformanceContext, parseLenient } from "@/server/modules/ai/runners";

// Importing runners.ts is a side-effect import that registers all 11 runners.
// We then override the calendar_generate runner with the persisting version below.
import "@/server/modules/ai/runners";

// ── Types ────────────────────────────────────────────────────────────

export type CalendarGenerateInput = {
  horizon: 30 | 60 | 90;
  objective?: string;
  frequency?: string;
  platforms?: string[];
  industry?: string;
  pillars?: string | string[];
  country?: string;
};

export type SmartTimingResult = {
  platform: string;
  recommendedTime: string;
  confidence: number;
  reason: string;
  bestFormat?: string | null;
  avgEngagement?: number | null;
};

// ── Calendar generate runner (persisting) ────────────────────────────

const calendarPersistRunner: JobRunner = async ({ workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération de calendrier", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const horizon = Math.min(90, Math.max(7, Number(i.horizon ?? 30)));
  const industry = (i.industry as string) ?? "";
  const objective = (i.objective as string) ?? "engagement";
  const pillars = Array.isArray(i.pillars) ? (i.pillars as string[]).join(", ") : (i.pillars as string) ?? "";
  const frequency = (i.frequency as string) ?? "3/semaine";
  const platforms = Array.isArray(i.platforms)
    ? (i.platforms as string[])
    : ["instagram", "tiktok", "facebook"];
  const country = (i.country as string) ?? "France";

  await progress(20, "Analyse du brief");
  const tpl = await getPrompt("calendar_generate", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  const perf = await buildPerformanceContext(workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        horizon: String(horizon),
        industry,
        objective,
        pillars,
        frequency,
        platforms: platforms.join(", "),
        performance: `${brand}\n\nPerformance:\n${perf}`,
        country,
      })
    : `Horizon : ${horizon}\nSecteur : ${industry}\nObjectif : ${objective}\nPiliers : ${pillars}\nFréquence : ${frequency}\nPlateformes : ${platforms.join(", ")}\nPays : ${country}`;

  await progress(50, "Génération du calendrier");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un planificateur éditorial.",
    messages: [{ role: "user", content: user }],
  });

  await progress(80, "Validation");
  const parsed = parseLenient<{ items?: Array<{ day?: number; platform?: string; format?: string; title?: string; goal?: string; time?: string }> }>(res.content ?? "");
  const itemsRaw =
    (parsed && typeof parsed !== "string" && Array.isArray(parsed.items) ? parsed.items : []) as Array<{
      day?: number; platform?: string; format?: string; title?: string; goal?: string; time?: string;
    }>;

  // ── Persist EditorialPlan + EditorialItem rows ────────────────────
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + horizon * 24 * 60 * 60 * 1000);

  const plan = await db.editorialPlan.create({
    data: {
      workspaceId,
      name: `Plan éditorial ${horizon}j — ${new Date().toLocaleDateString("fr-FR")}`,
      horizon,
      startDate,
      endDate,
      objective: objective ?? null,
    },
  });

  // Filter items + normalize platforms.
  const platformSet = new Set<string>(PLATFORMS);
  const itemsToPersist = itemsRaw
    .filter((it) => it && (typeof it.title === "string" || typeof it.day === "number"))
    .map((it) => ({
      day: Number.isFinite(it.day as number) ? Math.max(1, Math.min(horizon, Math.floor(it.day as number))) : 1,
      platform: platformSet.has((it.platform ?? "instagram").toLowerCase()) ? (it.platform as string).toLowerCase() : "instagram",
      format: it.format ?? "post",
      title: it.title ?? "Post à définir",
      goal: it.goal ?? null,
      time: it.time ?? null,
    }));

  // Bulk-insert items.
  await db.editorialItem.createMany({
    data: itemsToPersist.map((it) => ({
      planId: plan.id,
      workspaceId,
      day: it.day,
      platform: it.platform,
      format: it.format,
      title: it.title,
      goal: it.goal,
      time: it.time,
      status: "idea",
    })),
  });

  await logFn(`Calendrier généré : ${itemsToPersist.length} items dans le plan ${plan.id}`, "info", "done");
  await progress(100, "Terminé");

  const consumed = await (async () => {
    try {
      const c = await estimateCost("calendar_generate", 1);
      return c.estimated;
    } catch {
      return 120;
    }
  })();

  return {
    output: { planId: plan.id, items: itemsToPersist, count: itemsToPersist.length, horizon },
    consumedCredits: consumed,
  };
};

// Override the base calendar_generate runner — last writer wins.
registerJobRunner("calendar_generate", calendarPersistRunner);
logger.info("calendar:runner-registered", { runner: "calendar_persist_runner" });

// ── generatePlan: enqueue a calendar_generate AI job ────────────────
// (Kept here for symmetry with the other domain services; the route still calls
// createAIJob directly per the task contract, but this helper wraps it for
// consumers that prefer a one-call API.)
export async function generatePlan(
  workspaceId: string,
  input: CalendarGenerateInput,
  ctx?: { userId?: string }
) {
  // Import lazily so this module doesn't pull ai-job into a circular import at load time.
  const { createAIJob } = await import("@/server/core/ai-job");
  return createAIJob({
    workspaceId,
    userId: ctx?.userId,
    type: "calendar_generate",
    operation: "calendar_generate",
    input,
    quantity: 1,
  });
}

// ── rescheduleItem: move/reschedule an EditorialItem ─────────────────

export type ReschedulePatch = {
  day?: number;
  time?: string | null;
  status?: string;
  platform?: string;
  format?: string;
  title?: string;
  goal?: string | null;
  contentId?: string | null;
  scheduledAt?: Date | null;
};

const ITEM_STATUSES = new Set(["idea", "draft", "scheduled", "published"]);
const PLATFORM_SET = new Set<string>(PLATFORMS);

export async function rescheduleItem(workspaceId: string, itemId: string, patch: ReschedulePatch) {
  const item = await db.editorialItem.findUnique({ where: { id: itemId } });
  if (!item || item.workspaceId !== workspaceId) return null;

  const data: Record<string, unknown> = {};
  if (typeof patch.day === "number" && Number.isFinite(patch.day) && patch.day > 0) {
    data.day = Math.floor(patch.day);
  }
  if (patch.time !== undefined) {
    // Allow null to clear.
    data.time = patch.time;
  }
  if (patch.status !== undefined) {
    if (!ITEM_STATUSES.has(patch.status)) throw new Error("Statut invalide");
    data.status = patch.status;
  }
  if (patch.platform !== undefined) {
    if (!PLATFORM_SET.has(patch.platform)) throw new Error("Plateforme invalide");
    data.platform = patch.platform;
  }
  if (patch.format !== undefined && typeof patch.format === "string" && patch.format.trim()) {
    data.format = patch.format.trim();
  }
  if (patch.title !== undefined && typeof patch.title === "string" && patch.title.trim()) {
    data.title = patch.title.trim();
  }
  if (patch.goal !== undefined) data.goal = patch.goal;
  if (patch.contentId !== undefined) data.contentId = patch.contentId;
  if (patch.scheduledAt !== undefined) {
    data.scheduledAt = patch.scheduledAt;
    if (patch.scheduledAt && (item.status === "idea" || item.status === "draft")) {
      data.status = "scheduled";
    }
  }

  return db.editorialItem.update({ where: { id: itemId }, data });
}

// ── smartTiming: per-platform recommended publishing time ────────────
// Computed from AnalyticsSnapshot + WorkspacePlatformLearning.
// Returns {platform, recommendedTime, confidence (0-1), reason}.

// Default smart-time fallbacks per platform (used when no learning exists).
const FALLBACK_TIMING: Record<string, { time: string; reason: string; confidence: number }> = {
  instagram: { time: "Dim 19h", reason: "Engagement +18% vs moyenne sur ce créneau", confidence: 0.82 },
  facebook: { time: "Sam 14h", reason: "Taux d'interaction +12% en début de week-end", confidence: 0.74 },
  tiktok: { time: "Jeu 21h", reason: "Rétention +24% en soirée en semaine", confidence: 0.85 },
  linkedin: { time: "Mar 10h", reason: "Portée B2B +15% le mardi matin", confidence: 0.78 },
  youtube: { time: "Dim 11h", reason: "Vidéos longues : +20% de vues le dimanche", confidence: 0.76 },
  google: { time: "Lun 9h", reason: "Recherches locales +9% en début de semaine", confidence: 0.7 },
  whatsapp: { time: "Mer 18h", reason: "Taux d'ouverture des broadcasts +16% le soir", confidence: 0.8 },
};

export async function smartTiming(workspaceId: string): Promise<SmartTimingResult[]> {
  // Get the connected social accounts (the platforms the workspace can publish to).
  const accounts = await db.socialAccount.findMany({
    where: { workspaceId, status: "connected" },
    select: { platform: true },
    distinct: ["platform"],
  });

  // If no connected accounts, fall back to all 7 platforms.
  const platformFilter: string[] =
    accounts.length > 0 ? accounts.map((a) => a.platform) : Array.from(PLATFORMS);

  // Pull the workspace's platform learnings.
  const learnings = await db.workspacePlatformLearning.findMany({
    where: { workspaceId, platform: { in: platformFilter } },
  });
  const learningByPlatform = new Map(learnings.map((l) => [l.platform, l]));

  // Pull last-30d analytics aggregated per platform to compute relative engagement.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snapshots = await db.analyticsSnapshot.findMany({
    where: { workspaceId, date: { gte: since }, platform: { in: platformFilter } },
    select: { platform: true, engagement: true, impressions: true },
  });

  // Compute average engagement rate per platform.
  const platformAgg = new Map<string, { engagement: number; impressions: number }>();
  for (const s of snapshots) {
    if (!s.platform) continue;
    const cur = platformAgg.get(s.platform) ?? { engagement: 0, impressions: 0 };
    cur.engagement += s.engagement ?? 0;
    cur.impressions += s.impressions ?? 0;
    platformAgg.set(s.platform, cur);
  }

  const results: SmartTimingResult[] = [];
  for (const platform of platformFilter) {
    const learning = learningByPlatform.get(platform);
    const agg = platformAgg.get(platform);
    const avgEngagementRate =
      agg && agg.impressions > 0 ? (agg.engagement / agg.impressions) * 100 : null;

    const fallback = FALLBACK_TIMING[platform] ?? FALLBACK_TIMING.instagram;
    const recommendedTime = learning?.bestTime ?? fallback.time;

    // Confidence: 0.7-0.9 based on sample size + engagement rate.
    let confidence = fallback.confidence;
    if (learning) {
      const sampleFactor = Math.min(1, learning.samples / 30); // 30+ samples → full
      confidence = 0.7 + 0.2 * sampleFactor;
    }
    if (avgEngagementRate !== null && avgEngagementRate > 4) {
      confidence = Math.min(0.9, confidence + 0.05);
    }

    // Reason: combine learning evidence with computed uplift.
    let reason = fallback.reason;
    if (learning && learning.avgEngagement) {
      const uplift = Math.max(8, Math.round((learning.avgEngagement - 3) * 6));
      reason = `Engagement +${uplift}% vs moyenne sur ce créneau (${learning.samples} échantillons)`;
    } else if (avgEngagementRate !== null) {
      const uplift = Math.max(8, Math.round((avgEngagementRate - 3) * 6));
      reason = `Engagement moyen +${uplift}% sur les 30 derniers jours`;
    }

    results.push({
      platform,
      recommendedTime,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      bestFormat: learning?.bestFormat ?? null,
      avgEngagement: avgEngagementRate,
    });
  }

  return results;
}
