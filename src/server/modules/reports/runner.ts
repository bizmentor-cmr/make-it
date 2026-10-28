// Make It — Reports runner wrapper.
// Re-registers the `report` AI job runner AFTER `@/server/modules/ai/runners` so that,
// on completion, a `report_available` notification is persisted + emitted in real-time.
// (Last-writer-wins: see the header of runners.ts.)
//
// The runner body re-implements the same logic as B6's `reportRunner` (build metrics from
// AnalyticsSnapshot when none provided, render the "report" prompt template, parse
// lenient JSON, persist a Report row) and adds the notification step.

import { db } from "@/lib/db";
import { textChat } from "@/server/core/ai";
import { registerJobRunner, type JobRunner } from "@/server/core/ai-job";
import { getPrompt, renderTemplate } from "@/server/core/prompts";
import { estimateCost } from "@/server/core/ai-cost";
import { jsonStringify, jsonParse } from "@/server/core/types";
import { logger } from "@/server/core/logger";
import { createNotification } from "@/server/modules/notifications/service";

// Lenient JSON parse (same logic as runners.ts)
function parseLenient<T = unknown>(raw: string): T | string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      try {
        return JSON.parse(s.slice(i)) as T;
      } catch {
        // try next
      }
    }
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return s;
  }
}

const safeCost = async (operation: string, quantity = 1): Promise<number> => {
  try {
    const c = await estimateCost(operation, quantity);
    return c.estimated;
  } catch {
    return 1;
  }
};

// Infer the report `type` ("weekly" | "monthly" | "campaign") from the job input.
function inferReportType(i: Record<string, unknown>): "weekly" | "monthly" | "campaign" {
  if (i.type === "weekly" || i.type === "monthly" || i.type === "campaign") return i.type;
  if (i.refId) return "campaign";
  if (typeof i.period === "string") {
    if (i.period.includes("week")) return "weekly";
    if (i.period.includes("month")) return "monthly";
  }
  return "weekly";
}

export const reportRunnerWrapper: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération de rapport", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const period = (i.period as string) ?? "30j";
  const metrics = i.metrics ?? {};
  const top = i.top ?? i.topContents ?? [];
  const flops = i.flops ?? [];

  await progress(20, "Analyse des métriques");
  let metricsStr = JSON.stringify(metrics);
  if (!metrics || (typeof metrics === "object" && Object.keys(metrics as object).length === 0)) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.analyticsSnapshot.findMany({
      where: { workspaceId, date: { gte: since } },
      select: {
        platform: true,
        impressions: true,
        engagement: true,
        clicks: true,
        conversions: true,
        revenueCents: true,
      },
    });
    const agg = {
      impressions: 0,
      engagement: 0,
      clicks: 0,
      conversions: 0,
      revenueCents: 0,
      byPlatform: {} as Record<string, unknown>,
    };
    for (const r of rows) {
      agg.impressions += r.impressions;
      agg.engagement += r.engagement;
      agg.clicks += r.clicks;
      agg.conversions += r.conversions;
      agg.revenueCents += r.revenueCents;
      (agg.byPlatform as Record<string, unknown>)[r.platform ?? "all"] = (agg.byPlatform as Record<string, unknown>)[r.platform ?? "all"] ?? {};
    }
    metricsStr = JSON.stringify(agg);
  }
  const tpl = await getPrompt("report", workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        period,
        metrics: metricsStr,
        top: JSON.stringify(top),
        flops: JSON.stringify(flops),
      })
    : `Période : ${period}\nMétriques : ${metricsStr}\nTop contenus : ${JSON.stringify(top)}\nFlops : ${JSON.stringify(flops)}`;
  await progress(50, "Génération du rapport");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu rédiges un rapport marketing.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{
    working?: string[];
    declining?: string[];
    growing?: string[];
    toChange?: string[];
    actions?: Array<{ title?: string; cta?: string }>;
  }>(res.content ?? "{}");
  const report =
    typeof parsed === "string"
      ? { body: parsed, working: [], declining: [], growing: [], toChange: [], actions: [] }
      : parsed;

  const reportType = inferReportType(i);
  const refId = typeof i.refId === "string" && i.refId.length > 0 ? i.refId : null;

  const row = await db.report.create({
    data: {
      workspaceId,
      type: reportType,
      refId,
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
      summary: jsonStringify(report),
      body: res.content,
    },
  });
  await progress(100, "Terminé");
  await logFn(`Rapport généré (id=${row.id})`, "info", "done");

  // ── emit `report_available` notification ─────────────────────────────
  try {
    await createNotification(workspaceId, {
      type: "report_available",
      title:
        reportType === "weekly"
          ? "Rapport hebdomadaire disponible"
          : reportType === "monthly"
          ? "Rapport mensuel disponible"
          : "Rapport de campagne disponible",
      body: `Votre rapport ${reportType === "weekly" ? "hebdomadaire" : reportType === "monthly" ? "mensuel" : "de campagne"} est prêt à être consulté.`,
      level: "info",
      refId: row.id,
    });
  } catch (e) {
    logger.warn("reports: notification failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const consumed = await safeCost("report", 1);
  return { output: { reportId: row.id, ...report }, consumedCredits: consumed };
};

// Re-register the report runner (last writer wins).
registerJobRunner("report", reportRunnerWrapper);

// Also export a helper for tests / explicit registration.
export function registerReportsRunner() {
  registerJobRunner("report", reportRunnerWrapper);
}

// Keep `jsonParse` referenced (used by callers that re-export from this module)
export { jsonParse };
