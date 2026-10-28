"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Minus,
  Sparkles,
  ChevronRight,
  Check,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SectionHeader } from "@/components/shared/SectionHeader";
import { AIBadge } from "@/components/shared/AIBadge";
import { PlatformDot } from "@/components/shared/PlatformBadge";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import {
  performanceMetrics as mockMetrics,
  performanceSeries as mockSeries,
  monthlyReport as mockReport,
  PLATFORM_META,
  type Platform,
} from "@/lib/mock-data";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import { onJobEvent } from "@/lib/realtime-client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Per-platform performance for the breakdown card. Defaults to the mock; the
// real values are filled in from `/api/analytics` byPlatform entries.
type PlatformPerf = {
  platform: Platform;
  reachShare: number;
  engagement: number; // percentage (e.g. 4.8)
  trend: "up" | "down" | "flat";
};

const MOCK_PLATFORM_PERF: PlatformPerf[] = [
  { platform: "instagram", reachShare: 38, engagement: 4.8, trend: "up" },
  { platform: "tiktok", reachShare: 27, engagement: 5.2, trend: "up" },
  { platform: "linkedin", reachShare: 19, engagement: 3.4, trend: "flat" },
  { platform: "facebook", reachShare: 11, engagement: 2.8, trend: "down" },
];

function trendIcon(trend: "up" | "down" | "flat") {
  if (trend === "up")
    return <ArrowUp className="h-3.5 w-3.5 text-emerald-600" aria-label="En hausse" />;
  if (trend === "down")
    return <ArrowDown className="h-3.5 w-3.5 text-rose-600" aria-label="En baisse" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="Stable" />;
}

/* Chart tooltip — premium, minimalist, fr-FR formatting */
type TooltipItem = { value: number; name: string; color?: string };

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const value = Number(payload[0].value);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">Jour {label}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">
        {value.toLocaleString("fr-FR")}
        {suffix ?? ""}
      </p>
    </div>
  );
}

// ─── Formatting helpers ────────────────────────────────────────────────────
function frNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("fr-FR");
}

function frDecimal(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function frEuro(cents: number): string {
  const euros = (cents ?? 0) / 100;
  return `${frDecimal(euros, 2).replace(/\s/g, " ")} €`;
}

// Convert a yyyy-mm-dd date to a single French weekday letter for the chart
// x-axis (L · M · M · J · V · S · D).
function weekdayLetter(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const days = ["D", "L", "M", "M", "J", "V", "S"];
  return days[d.getDay()];
}

// ─── API types ──────────────────────────────────────────────────────────────
type AggregatedMetrics = {
  reach: number;
  impressions: number;
  views: number;
  engagement: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  messages: number;
  leads: number;
  conversions: number;
  revenueCents: number;
  followers: number;
  engagementRate: number;
  ctr: number;
  cpc: number;
  cpm: number;
  rowCount?: number;
};

type AnalyticsResponse = {
  metrics: AggregatedMetrics;
  byPlatform: { platform: string | null; metrics: AggregatedMetrics }[];
  daily: { date: string; metrics: AggregatedMetrics }[];
  topContent: { contentId: string; metrics: AggregatedMetrics }[];
};

type ReportSummary = {
  working?: string[];
  declining?: string[];
  growing?: string[];
  toChange?: string[];
  actions?: Array<{ title?: string; cta?: string }>;
};

type ReportRow = {
  id: string;
  type: string;
  refId: string | null;
  createdAt: string;
  summary: ReportSummary | null;
};

type ReportListResponse = { reports: ReportRow[] };
type ReportOneResponse = { report: ReportRow };
type ReportGenerateResponse = { jobId: string; estimated: number };

// Metric card — same visual contract as InsightStat, with an optional
//   action chip and inverted-delta coloring (used for cpa where -8% is good).
function MetricCard({
  label,
  value,
  delta,
  hint,
  invertDelta = false,
  action,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  invertDelta?: boolean;
  action?: {
    label: string;
    onClick: () => void;
    tone?: "ink" | "soft" | "accent";
  };
}) {
  const positive = invertDelta ? (delta ?? 0) <= 0 : (delta ?? 0) >= 0;
  const deltaColor = positive ? "text-emerald-600" : "text-rose-600";
  return (
    <div className="surface-card flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </span>
        {delta !== undefined && (
          <span className={cn("text-xs font-medium", deltaColor)}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground text-pretty">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className={cn(
            "mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            action.tone === "ink"
              ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
              : action.tone === "accent"
              ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:opacity-90"
              : "bg-foreground/5 text-foreground hover:bg-foreground/10"
          )}
        >
          {action.label}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* Monthly report sub-block */
function ReportBlock({
  emoji,
  title,
  items,
  tone,
}: {
  emoji: string;
  title: string;
  items: string[];
  tone: "emerald" | "rose" | "amber";
}) {
  const cfg = {
    emerald: {
      ring: "border-emerald-100",
      bg: "bg-emerald-50",
      icon: <Check className="h-3.5 w-3.5 text-emerald-600" />,
      text: "text-emerald-900",
    },
    rose: {
      ring: "border-rose-100",
      bg: "bg-rose-50",
      icon: <ArrowDown className="h-3.5 w-3.5 text-rose-600" />,
      text: "text-rose-900",
    },
    amber: {
      ring: "border-amber-100",
      bg: "bg-amber-50",
      icon: <RefreshCw className="h-3.5 w-3.5 text-amber-600" />,
      text: "text-amber-900",
    },
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-5", cfg.ring, cfg.bg)}>
      <h3 className="text-sm font-semibold text-foreground">
        <span className="mr-1.5" aria-hidden>
          {emoji}
        </span>
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.length === 0 ? (
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{cfg.icon}</span>
            <span className={cn("text-sm text-pretty", cfg.text)}>
              Données en cours d'analyse.
            </span>
          </li>
        ) : (
          items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{cfg.icon}</span>
              <span className={cn("text-sm text-pretty", cfg.text)}>{it}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// Build the 9-card metrics list from the API response. We always reuse the
// mock's `label`/`delta`/`hint` strings so the cards keep their copy, but the
// `value` is the real number when available.
function buildMetrics(a: AnalyticsResponse | null) {
  return mockMetrics.map((m) => {
    let value = m.value;
    if (a?.metrics) {
      switch (m.key) {
        case "reach":
          value = frNumber(a.metrics.reach);
          break;
        case "views":
          value = frNumber(a.metrics.views);
          break;
        case "engagement":
          value = `${frDecimal(a.metrics.engagementRate * 100, 1)}%`;
          break;
        case "followers":
          value = `+${frNumber(a.metrics.followers)}`;
          break;
        case "clicks":
          value = frNumber(a.metrics.clicks);
          break;
        case "messages":
          value = frNumber(a.metrics.messages);
          break;
        case "leads":
          value = frNumber(a.metrics.leads);
          break;
        case "cpa": {
          const conv = Math.max(1, a.metrics.conversions);
          value = frEuro(a.metrics.revenueCents / conv);
          break;
        }
        case "revenue":
          value = frEuro(a.metrics.revenueCents);
          break;
      }
    }
    return { ...m, value };
  });
}

// Build the 7-day series from the API daily entries (last 7 entries).
function buildSeries(a: AnalyticsResponse | null) {
  const fallback = {
    reach: mockSeries.reach,
    engagement: mockSeries.engagement,
  };
  if (!a?.daily || a.daily.length === 0) return fallback;
  const last7 = a.daily.slice(-7);
  const reach = last7.map((d) => ({
    day: weekdayLetter(d.date) || "?",
    v: d.metrics.reach,
  }));
  const engagement = last7.map((d) => ({
    day: weekdayLetter(d.date) || "?",
    v: Number((d.metrics.engagementRate * 100).toFixed(2)),
  }));
  return {
    reach: reach.length > 0 ? reach : fallback.reach,
    engagement: engagement.length > 0 ? engagement : fallback.engagement,
  };
}

// Build the platform breakdown from the API byPlatform entries. We compute
// `reachShare` from each platform's reach vs the total, and the trend by
// comparing each platform's engagement rate against the average.
function buildPlatformPerf(a: AnalyticsResponse | null): PlatformPerf[] {
  if (!a?.byPlatform || a.byPlatform.length === 0) return MOCK_PLATFORM_PERF;
  const totalReach = a.byPlatform.reduce(
    (acc, p) => acc + (p.metrics?.reach ?? 0),
    0
  );
  const avgEng =
    a.byPlatform.reduce((acc, p) => acc + (p.metrics?.engagementRate ?? 0), 0) /
    Math.max(1, a.byPlatform.length);

  const mapped: PlatformPerf[] = a.byPlatform
    .filter((p) => !!p.platform && (p.metrics?.reach ?? 0) > 0)
    .slice(0, 5)
    .map((p) => {
      const eng = (p.metrics?.engagementRate ?? 0) * 100;
      const trend: PlatformPerf["trend"] =
        eng > avgEng * 1.05 ? "up" : eng < avgEng * 0.95 ? "down" : "flat";
      return {
        platform: (p.platform as Platform) ?? "instagram",
        reachShare:
          totalReach > 0
            ? Math.round(((p.metrics?.reach ?? 0) / totalReach) * 100)
            : 0,
        engagement: Number(eng.toFixed(1)),
        trend,
      };
    });

  return mapped.length > 0 ? mapped : MOCK_PLATFORM_PERF;
}

/* ------------------------------------------------------------------ */
/*  Main section                                                       */
/* ------------------------------------------------------------------ */

export function PerformanceSection() {
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const setAdvisorOpen = useAppStore((s) => s.setAdvisorOpen);

  const reportRef = useRef<HTMLDivElement>(null);
  const platformRef = useRef<HTMLDivElement>(null);

  const scrollToReport = () =>
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToPlatforms = () =>
    platformRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ─── Data state ───────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState(buildMetrics(null));
  const [series, setSeries] = useState(buildSeries(null));
  const [platformPerf, setPlatformPerf] =
    useState<PlatformPerf[]>(MOCK_PLATFORM_PERF);

  // Monthly report state.
  const [report, setReport] = useState<{
    working: string[];
    declining: string[];
    growing: string[];
    toChange: string[];
    actions: { title: string; cta: string }[];
  }>({
    working: mockReport.working,
    declining: mockReport.declining,
    growing: mockReport.growing,
    toChange: mockReport.toChange,
    actions: mockReport.actions,
  });
  const [reportLoading, setReportLoading] = useState(true);

  // Action chips paired with specific metrics (rule #35 — explain + pair
  // with an action when relevant).
  const metricAction: Record<
    string,
    { label: string; onClick: () => void; tone?: "ink" | "soft" | "accent" }
  > = {
    engagement: {
      label: "Améliorer",
      onClick: () => setActiveSection("create"),
      tone: "ink",
    },
    revenue: {
      label: "Voir le rapport",
      onClick: scrollToReport,
      tone: "accent",
    },
    cpa: {
      label: "Continuer",
      onClick: () => setAdvisorOpen(true),
      tone: "soft",
    },
  };

  // ─── Load analytics + report on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const analytics = await apiTry(
        async () => apiGet<AnalyticsResponse>("/api/analytics?range=30"),
        null as AnalyticsResponse | null
      );
      if (cancelled) return;
      if (analytics) {
        setMetrics(buildMetrics(analytics));
        setSeries(buildSeries(analytics));
        setPlatformPerf(buildPlatformPerf(analytics));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Load (or generate) the monthly report ───────────────────────────
  // 1. List existing monthly reports.
  // 2. If at least one exists, load the latest report's summary.
  // 3. Otherwise, fire POST /api/reports/generate {type:"monthly"} so the
  //    runner produces a report. We then poll the list every ~2.5s until a
  //    report shows up (max 8 attempts) and ALSO subscribe to the realtime
  //    job bus so when the report job completes, we refresh.
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;

    async function loadLatestReport() {
      const list = await apiTry(
        async () => apiGet<ReportListResponse>("/api/reports?type=monthly"),
        null as ReportListResponse | null
      );
      if (cancelled || !list?.reports?.length) return false;
      const latest = list.reports[0];
      const one = await apiTry(
        async () => apiGet<ReportOneResponse>(`/api/reports/${latest.id}`),
        null as ReportOneResponse | null
      );
      if (cancelled || !one?.report) return false;
      applyReport(one.report);
      return true;
    }

    function applyReport(r: ReportRow) {
      const s = (r.summary ?? {}) as ReportSummary;
      const actions = (s.actions ?? [])
        .filter((a) => a && (a.title || a.cta))
        .slice(0, 3)
        .map((a) => ({
          title: a.title ?? "Action recommandée",
          cta: a.cta ?? "Appliquer",
        }));
      setReport({
        working: s.working ?? [],
        declining: s.declining ?? [],
        growing: s.growing ?? [],
        toChange: s.toChange ?? [],
        actions:
          actions.length > 0
            ? actions
            : mockReport.actions,
      });
      setReportLoading(false);
    }

    (async () => {
      setReportLoading(true);
      const found = await loadLatestReport();
      if (cancelled || found) return;

      // No monthly report yet — kick off a generation job. Failures are
      // swallowed (insufficient credits, etc.) so the UI still falls back
      // to the mock report.
      try {
        await apiPost<ReportGenerateResponse>("/api/reports/generate", {
          type: "monthly",
        });
      } catch {
        /* fall back to mock — surface nothing */
      }

      // Poll the list while the job is running (cap attempts).
      pollTimer = setInterval(async () => {
        attempts += 1;
        const ok = await loadLatestReport();
        if (ok || attempts >= 8) {
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = null;
          if (!ok && !cancelled) setReportLoading(false);
        }
      }, 2500);
    })();

    // Subscribe to the realtime job bus — when the monthly report job
    // completes, refresh the report immediately (no need to wait for the
    // poll cadence).
    const off = onJobEvent((e) => {
      if (e.kind !== "completed") return;
      // The report runner's output is `{ reportId, ...summary }` — only
      // refresh when the job type matches.
      const output = (e.output ?? {}) as { reportId?: string };
      if (!output.reportId) return;
      void (async () => {
        const one = await apiTry(
          async () =>
            apiGet<ReportOneResponse>(`/api/reports/${output.reportId}`),
          null as ReportOneResponse | null
        );
        if (cancelled || !one?.report) return;
        applyReport(one.report);
      })();
    });

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      off();
    };
  }, []);

  // ─── Render helpers ──────────────────────────────────────────────────
  const reachTotal = series.reach.reduce((acc, d) => acc + d.v, 0);
  const reachDelta = 18; // cosmetic — the API doesn't return a previous period.
  const engagementAvg =
    series.engagement.reduce((acc, d) => acc + d.v, 0) /
    Math.max(1, series.engagement.length);
  const engagementDelta = -3; // cosmetic — same reason.

  return (
    <div className="space-y-8">
      {/* 1. Header */}
      <div className="animate-float-up">
        <SectionHeader
          eyebrow="Performances"
          title="Vos résultats"
          description="Les indicateurs qui comptent vraiment — et ce que Make It recommande d'en faire."
          actions={<AIBadge label="Analyse IA" />}
        />
      </div>

      {/* 2. Metrics grid */}
      <section
        aria-label="Indicateurs clés"
        className="animate-float-up grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        style={{ animationDelay: "0.05s" }}
      >
        {metrics.map((m) => {
          const isCpa = m.key === "cpa";
          return (
            <MetricCard
              key={m.key}
              label={m.label}
              value={m.value}
              delta={m.delta}
              hint={m.hint}
              invertDelta={isCpa}
              action={metricAction[m.key]}
            />
          );
        })}
      </section>

      {/* 3. Trends block (reach + engagement) */}
      <section
        aria-label="Tendances sur 7 jours"
        className="animate-float-up grid grid-cols-1 gap-4 lg:grid-cols-2"
        style={{ animationDelay: "0.1s" }}
      >
        {/* Reach — AreaChart */}
        <div className="surface-card flex flex-col p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Portée (7 jours)
              </h2>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {frNumber(reachTotal)}
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <ArrowUp className="h-3 w-3" /> +{reachDelta}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">
                Personnes qui ont vu votre contenu cette semaine.
              </p>
            </div>
            <button
              onClick={scrollToPlatforms}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
            >
              Détails <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series.reach}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <defs>
                  <linearGradient id="reachGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="oklch(0.55 0.13 165)"
                      stopOpacity={0.32}
                    />
                    <stop
                      offset="100%"
                      stopColor="oklch(0.55 0.13 165)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" hide />
                <YAxis hide />
                <Tooltip
                  content={<ChartTooltip suffix=" vues" />}
                  cursor={{
                    stroke: "oklch(0.55 0.13 165)",
                    strokeWidth: 1,
                    strokeOpacity: 0.25,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="oklch(0.55 0.13 165)"
                  strokeWidth={2.5}
                  fill="url(#reachGradient)"
                  activeDot={{ r: 4, fill: "oklch(0.55 0.13 165)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Engagement — LineChart */}
        <div className="surface-card flex flex-col p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Engagement (7 jours)
              </h2>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {frDecimal(engagementAvg, 1)}%
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                  <ArrowDown className="h-3 w-3" /> {Math.abs(engagementDelta)}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">
                Moyenne des interactions rapportées à la portée.
              </p>
            </div>
          </div>

          <div className="mt-4 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series.engagement}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <XAxis dataKey="day" hide />
                <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                <Tooltip
                  content={<ChartTooltip suffix="%" />}
                  cursor={{
                    stroke: "oklch(0.62 0.2 350)",
                    strokeWidth: 1,
                    strokeOpacity: 0.25,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="oklch(0.62 0.2 350)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: "oklch(0.62 0.2 350)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recommendation chip on the engagement card */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-rose-100 bg-rose-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs text-rose-900 text-pretty">
                <span className="font-medium">Engagement en baisse.</span> Les
                Reels éducatifs maintiennent 4,8%.
              </p>
            </div>
            <button
              onClick={() => setActiveSection("create")}
              className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-[color:var(--ink)] px-3 py-1.5 text-xs font-medium text-[color:var(--primary-foreground)] transition-opacity hover:opacity-90"
            >
              Créer un Reel <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </section>

      {/* 4. Platform breakdown */}
      <section
        ref={platformRef}
        aria-label="Performance par plateforme"
        className="animate-float-up scroll-mt-4"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="surface-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Performance par plateforme
            </h2>
            <span className="text-xs text-muted-foreground">30 derniers jours</span>
          </div>
          <ul className="space-y-3">
            {platformPerf.map((p) => (
              <li
                key={p.platform}
                className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3"
              >
                <PlatformDot platform={p.platform} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {PLATFORM_META[p.platform]?.label ?? p.platform}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {p.engagement.toFixed(1).replace(".", ",")}% eng.
                      </span>
                      {trendIcon(p.trend)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/5">
                      <div
                        className="h-1.5 rounded-full bg-[color:var(--emerald-accent)]"
                        style={{ width: `${Math.min(100, p.reachShare * 2.6)}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                      {p.reachShare}%
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5. Monthly report */}
      <section
        ref={reportRef}
        aria-label="Votre mois en résumé"
        className="animate-float-up surface-hero scroll-mt-4 p-6"
        style={{ animationDelay: "0.2s" }}
      >
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Votre mois en résumé
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Make It a analysé vos 30 derniers jours pour identifier ce qui
            fonctionne, ce qui progresse et ce qu'il faut ajuster.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ReportBlock
            emoji="✅"
            title="Ce qui fonctionne"
            items={report.working}
            tone="emerald"
          />
          <ReportBlock
            emoji="📉"
            title="Ce qui baisse"
            items={report.declining}
            tone="rose"
          />
          <ReportBlock
            emoji="📈"
            title="Ce qui progresse"
            items={report.growing}
            tone="emerald"
          />
          <ReportBlock
            emoji="🔄"
            title="Ce qu'il faut changer"
            items={report.toChange}
            tone="amber"
          />
        </div>
      </section>

      {/* 6. Recommended actions */}
      <section
        aria-label="Actions recommandées"
        className="animate-float-up space-y-4"
        style={{ animationDelay: "0.25s" }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-base font-semibold text-foreground">
            Les 3 actions recommandées
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <RecommendationCard
            icon={<Sparkles className="h-4 w-4" />}
            title={report.actions[0]?.title ?? "Action recommandée"}
            reason="Vos Reels éducatifs génèrent +128% de vues et maintiennent 4,8% d'engagement."
            cta={report.actions[0]?.cta ?? "Créer"}
            tone="emerald"
            onCta={() => setActiveSection("create")}
          />
          <RecommendationCard
            icon={<TrendingUp className="h-4 w-4" />}
            title={report.actions[1]?.title ?? "Action recommandée"}
            reason="Le CTA WhatsApp a déjà généré +23% de leads. Activez-le sur 3 contenus."
            cta={report.actions[1]?.cta ?? "Appliquer"}
            tone="emerald"
            onCta={() => setActiveSection("planning")}
          />
          <RecommendationCard
            icon={<RefreshCw className="h-4 w-4" />}
            title={report.actions[2]?.title ?? "Action recommandée"}
            reason="YouTube Shorts est inexploité alors que vos Reels Instagram performent."
            cta={report.actions[2]?.cta ?? "Transformer"}
            tone="emerald"
            onCta={() => setActiveSection("create")}
          />
        </div>
      </section>

      {/* 7. Bottom CTA — discuss with Make It */}
      <section
        aria-label="Discutez de vos résultats avec Make It"
        className="animate-float-up surface-accent p-8 text-center"
        style={{ animationDelay: "0.3s" }}
      >
        <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
          Discutez de vos résultats avec Make It
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-pretty opacity-80">
          Posez une question en langage naturel : Make It analyse vos
          indicateurs et vous propose un plan d'action concret.
        </p>
        <div className="mt-5 flex justify-center">
          <Button onClick={() => setAdvisorOpen(true)} size="lg">
            <Sparkles className="h-4 w-4" />
            Demander à Make It
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[
            "Pourquoi cette campagne coûte-t-elle plus cher ?",
            "Que dois-je publier cette semaine ?",
          ].map((q) => (
            <button
              key={q}
              onClick={() => setAdvisorOpen(true)}
              className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/5"
            >
              {q}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
