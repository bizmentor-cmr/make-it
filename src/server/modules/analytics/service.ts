// Make It — Analytics ingestion + unified analytics service.
//
// Pipeline (documented for future subagents):
//   Connector.fetch(account)  →  RawRow[]          // see ./connectors.ts
//   normalize(raw, platform)  →  Row               // unified schema
//   ingestRows(ws, source, rows)  →  upsert AnalyticsSnapshot   // this file
//   aggregateAnalytics(ws, days, platform?)  →  { metrics, byPlatform, daily, topContent }
//
// `AnalyticsSnapshot` has no unique constraint on (workspaceId, date, platform),
// so `ingestRows` does a findFirst + (create|update) — re-ingesting the same
// day/platform replaces the previous numbers (idempotent).

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import type { Row } from "./connectors";

// ─── types ──────────────────────────────────────────────────────────────────

export type MetricLike = {
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
};

export type AggregatedMetrics = MetricLike & {
  engagementRate: number; // engagement / impressions (0 when impressions=0)
  ctr: number; // clicks / impressions
  cpc: number; // revenueCents / clicks (in cents)
  cpm: number; // (revenueCents / impressions) * 1000
  rowCount: number;
};

export type ByPlatformEntry = { platform: string | null; metrics: AggregatedMetrics };
export type DailyEntry = { date: string; metrics: AggregatedMetrics };
export type TopContentEntry = { contentId: string; metrics: AggregatedMetrics };

export type AggregatedAnalytics = {
  metrics: AggregatedMetrics;
  byPlatform: ByPlatformEntry[];
  daily: DailyEntry[];
  topContent: TopContentEntry[];
};

export type IngestResult = {
  ingested: number;
  skipped: number;
  upserted: number;
  created: number;
};

// ─── helpers ────────────────────────────────────────────────────────────────

function sum<T>(rows: T[], sel: (r: T) => number): number {
  let s = 0;
  for (const r of rows) {
    const v = sel(r);
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

export function computeMetrics(rows: MetricLike[]): AggregatedMetrics {
  const reach = sum(rows, (r) => r.reach);
  const impressions = sum(rows, (r) => r.impressions);
  const views = sum(rows, (r) => r.views);
  const engagement = sum(rows, (r) => r.engagement);
  const comments = sum(rows, (r) => r.comments);
  const shares = sum(rows, (r) => r.shares);
  const saves = sum(rows, (r) => r.saves);
  const clicks = sum(rows, (r) => r.clicks);
  const messages = sum(rows, (r) => r.messages);
  const leads = sum(rows, (r) => r.leads);
  const conversions = sum(rows, (r) => r.conversions);
  const revenueCents = sum(rows, (r) => r.revenueCents);
  const followers = sum(rows, (r) => r.followers);

  return {
    reach,
    impressions,
    views,
    engagement,
    comments,
    shares,
    saves,
    clicks,
    messages,
    leads,
    conversions,
    revenueCents,
    followers,
    engagementRate: impressions > 0 ? engagement / impressions : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? revenueCents / clicks : 0,
    cpm: impressions > 0 ? (revenueCents / impressions) * 1000 : 0,
    rowCount: rows.length,
  };
}

// Local-date key (yyyy-mm-dd) from a Date — preserves calendar day in the
// server's local timezone instead of UTC (toISOString would shift it for
// non-UTC deployments).
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a date string (yyyy-mm-dd or ISO datetime) into a local-midnight Date.
function parseDate(s: string | null | undefined): Date | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Accept "yyyy-mm-dd" directly (interpreted as local midnight).
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDateMatch) {
    const y = Number.parseInt(isoDateMatch[1], 10);
    const m = Number.parseInt(isoDateMatch[2], 10) - 1;
    const d = Number.parseInt(isoDateMatch[3], 10);
    const dt = new Date(y, m, d, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  // Fallback to Date constructor (ISO with time).
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// ─── aggregate ──────────────────────────────────────────────────────────────

export async function aggregateAnalytics(
  workspaceId: string,
  days: number,
  platform?: string | null
): Promise<AggregatedAnalytics> {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
  const now = new Date();
  const start = new Date(now.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);

  const where: {
    workspaceId: string;
    date: { gte: Date };
    platform?: string | null;
  } = {
    workspaceId,
    date: { gte: start },
  };
  if (typeof platform === "string" && platform.length > 0) {
    where.platform = platform;
  }

  const rows = await db.analyticsSnapshot.findMany({
    where,
    orderBy: { date: "asc" },
  });

  // byPlatform
  const byPlatformGroups = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const key = r.platform ?? null;
    const group = byPlatformGroups.get(key);
    if (group) group.push(r);
    else byPlatformGroups.set(key, [r]);
  }

  // daily
  const dailyGroups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = localDateKey(r.date);
    const group = dailyGroups.get(key);
    if (group) group.push(r);
    else dailyGroups.set(key, [r]);
  }

  // topContent
  const contentGroups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.contentId) continue;
    const group = contentGroups.get(r.contentId);
    if (group) group.push(r);
    else contentGroups.set(r.contentId, [r]);
  }

  return {
    metrics: computeMetrics(rows),
    byPlatform: Array.from(byPlatformGroups.entries())
      .map(([platformKey, groupRows]) => ({
        platform: platformKey,
        metrics: computeMetrics(groupRows),
      }))
      .sort((a, b) => b.metrics.impressions - a.metrics.impressions),
    daily: Array.from(dailyGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groupRows]) => ({ date, metrics: computeMetrics(groupRows) })),
    topContent: Array.from(contentGroups.entries())
      .map(([contentId, groupRows]) => ({ contentId, metrics: computeMetrics(groupRows) }))
      .sort((a, b) => b.metrics.impressions - a.metrics.impressions)
      .slice(0, 10),
  };
}

// ─── ingest ─────────────────────────────────────────────────────────────────

export async function ingestRows(
  workspaceId: string,
  source: string,
  rows: Row[]
): Promise<IngestResult> {
  let ingested = 0;
  let skipped = 0;
  let upserted = 0;
  let created = 0;

  for (const row of rows) {
    const dateObj = parseDate(row.date);
    if (!dateObj) {
      logger.warn("analytics.ingest: invalid date, skipping", {
        date: row.date,
        source,
      });
      skipped++;
      continue;
    }

    const platform = row.platform && row.platform.length > 0 ? row.platform : null;

    const payload = {
      contentId: row.contentId ?? null,
      reach: Math.max(0, Math.round(row.reach || 0)),
      impressions: Math.max(0, Math.round(row.impressions || 0)),
      views: Math.max(0, Math.round(row.views || 0)),
      engagement: Math.max(0, Math.round(row.engagement || 0)),
      comments: Math.max(0, Math.round(row.comments || 0)),
      shares: Math.max(0, Math.round(row.shares || 0)),
      saves: Math.max(0, Math.round(row.saves || 0)),
      clicks: Math.max(0, Math.round(row.clicks || 0)),
      ctr: Number.isFinite(row.ctr) ? row.ctr : 0,
      cpc: Number.isFinite(row.cpc) ? row.cpc : 0,
      cpm: Number.isFinite(row.cpm) ? row.cpm : 0,
      messages: Math.max(0, Math.round(row.messages || 0)),
      leads: Math.max(0, Math.round(row.leads || 0)),
      conversions: Math.max(0, Math.round(row.conversions || 0)),
      revenueCents: Math.max(0, Math.round(row.revenueCents || 0)),
      followers: Math.max(0, Math.round(row.followers || 0)),
    };

    // No unique constraint on (workspaceId, date, platform): findFirst + upsert manually.
    const existing = await db.analyticsSnapshot.findFirst({
      where: { workspaceId, date: dateObj, platform },
    });

    if (existing) {
      await db.analyticsSnapshot.update({
        where: { id: existing.id },
        data: payload,
      });
      upserted++;
    } else {
      await db.analyticsSnapshot.create({
        data: { workspaceId, date: dateObj, platform, ...payload },
      });
      created++;
    }
    ingested++;
  }

  return { ingested, skipped, upserted, created };
}
