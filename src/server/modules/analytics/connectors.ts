// Make It — Analytics connectors (stubs).
// Each connector represents a real-world integration (Meta Graph API,
// TikTok Business API, GA4 Data API, Google Business Profile) that would
// pull raw analytics rows for a connected social account / property /
// location. In this stub, `fetch()` returns mocked/sample data so the
// "Connector → Raw Data → Normalizer → Unified Analytics" pipeline can
// be exercised end-to-end without real OAuth tokens.
//
// Real wiring notes:
// - MetaConnector would hit `GET /v19.0/{ig-user-id}/insights` and
//   `/{page-id}/insights` with the page access token (SocialAccount.encryptedAccessToken).
// - TikTokConnector would hit `GET /open_api/v1.3/report/data/get` with the
//   Business Access token stored encrypted on the SocialAccount.
// - GA4Connector would call the GA4 Data API (`properties/{propertyId}:runReport`).
// - GoogleBusinessConnector would call the GBP Reporting API.
//
// All raw shapes are intentionally heterogeneous — `normalize()` maps them
// onto the unified `Row` schema consumed by `ingestRows()`.

import { logger } from "@/server/core/logger";

export type RawRow = Record<string, unknown>;

export type Row = {
  date: string; // ISO yyyy-mm-dd
  platform: string | null;
  contentId: string | null;
  reach: number;
  impressions: number;
  views: number;
  engagement: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  messages: number;
  leads: number;
  conversions: number;
  revenueCents: number;
  followers: number;
};

export interface Connector {
  id: string;
  platform: string; // best-effort platform identifier (instagram, tiktok, google, ...)
  /** Pull raw analytics rows for the given external account / property / location id. */
  fetch(socialAccountId: string): Promise<RawRow[]>;
}

// ─── Meta (Instagram + Facebook via Meta Graph API) ────────────────────────
export const MetaConnector: Connector = {
  id: "meta",
  platform: "instagram",
  async fetch(socialAccountId: string): Promise<RawRow[]> {
    logger.debug("connector.meta.fetch", { socialAccountId });
    const rows: RawRow[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      rows.push({
        date: d.toISOString().slice(0, 10),
        platform: "instagram",
        account_id: socialAccountId,
        unique_reach: 1800 + Math.round(Math.random() * 400),
        impressions: 2400 + Math.round(Math.random() * 500),
        engagement: 90 + Math.round(Math.random() * 20),
        link_clicks: 48 + Math.round(Math.random() * 10),
        direct_messages: 2 + Math.round(Math.random() * 3),
        leads: 1,
        conversions: Math.round(Math.random()),
        revenue_cents: 0,
        new_followers: 18 + Math.round(Math.random() * 6),
      });
    }
    return rows;
  },
};

// ─── TikTok (TikTok Business / Ads) ─────────────────────────────────────────
export const TikTokConnector: Connector = {
  id: "tiktok",
  platform: "tiktok",
  async fetch(socialAccountId: string): Promise<RawRow[]> {
    logger.debug("connector.tiktok.fetch", { socialAccountId });
    const rows: RawRow[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      rows.push({
        date: d.toISOString().slice(0, 10),
        platform: "tiktok",
        account_id: socialAccountId,
        video_views: 1400 + Math.round(Math.random() * 400),
        impressions: 1600 + Math.round(Math.random() * 500),
        engagements: 68 + Math.round(Math.random() * 15),
        clicks: 22 + Math.round(Math.random() * 8),
        reach: 1200 + Math.round(Math.random() * 300),
        new_followers: 12 + Math.round(Math.random() * 5),
      });
    }
    return rows;
  },
};

// ─── GA4 (Google Analytics 4 Data API) ──────────────────────────────────────
export const GA4Connector: Connector = {
  id: "ga4",
  platform: "google",
  async fetch(propertyId: string): Promise<RawRow[]> {
    logger.debug("connector.ga4.fetch", { propertyId });
    const rows: RawRow[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      rows.push({
        date: d.toISOString().slice(0, 10),
        platform: "google",
        property_id: propertyId,
        sessions: 850 + Math.round(Math.random() * 200),
        pageviews: 1900 + Math.round(Math.random() * 400),
        engagements: 280 + Math.round(Math.random() * 60),
        clicks: 0,
        conversions: 4 + Math.round(Math.random() * 3),
        revenue_cents: 1200 + Math.round(Math.random() * 800),
        reach: 0,
      });
    }
    return rows;
  },
};

// ─── Google Business Profile ───────────────────────────────────────────────
export const GoogleBusinessConnector: Connector = {
  id: "google_business",
  platform: "google",
  async fetch(locationId: string): Promise<RawRow[]> {
    logger.debug("connector.google_business.fetch", { locationId });
    const rows: RawRow[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      rows.push({
        date: d.toISOString().slice(0, 10),
        platform: "google",
        location_id: locationId,
        reach: 320 + Math.round(Math.random() * 80),
        impressions: 480 + Math.round(Math.random() * 120),
        clicks: 36 + Math.round(Math.random() * 10),
        calls: 4 + Math.round(Math.random() * 3),
        direct_messages: 1 + Math.round(Math.random() * 2),
        conversions: 0,
      });
    }
    return rows;
  },
};

export const CONNECTORS: Record<string, Connector> = {
  meta: MetaConnector,
  tiktok: TikTokConnector,
  ga4: GA4Connector,
  google_business: GoogleBusinessConnector,
};

// ─── normalize ──────────────────────────────────────────────────────────────
// Map a heterogeneous raw connector row onto the unified `Row` schema.
// Field name aliases approximate the real APIs (e.g. Meta "unique_reach",
// TikTok "video_views", GA4 "sessions"/"pageviews", GBP "calls").
export function normalize(raw: RawRow, fallbackPlatform: string | null = null): Row {
  const dateRaw = raw.date ?? raw.day ?? raw.report_date ?? raw.date_iso;
  const dateStr = (() => {
    if (dateRaw instanceof Date) return dateRaw.toISOString().slice(0, 10);
    if (typeof dateRaw === "string") return dateRaw.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  })();

  const num = (v: unknown): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const n = Number.parseFloat(v.replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const platformRaw = raw.platform;
  const platform =
    typeof platformRaw === "string" && platformRaw.length > 0
      ? platformRaw
      : fallbackPlatform ?? null;

  return {
    date: dateStr,
    platform,
    contentId:
      typeof raw.contentId === "string" && raw.contentId.length > 0 ? raw.contentId : null,
    reach: num(raw.reach ?? raw.unique_reach ?? raw.accounts_reached ?? raw.reach_total),
    impressions: num(raw.impressions ?? raw.impr ?? raw.pageviews ?? raw.impressions_total),
    views: num(raw.views ?? raw.video_views ?? raw.video_views_total),
    engagement: num(
      raw.engagement ?? raw.engagements ?? raw.interactions ?? raw.engagement_count
    ),
    comments: num(raw.comments ?? raw.comment_count),
    shares: num(raw.shares ?? raw.shares_count ?? raw.share_count ?? raw.reposts),
    saves: num(raw.saves ?? raw.saved ?? raw.bookmarks),
    clicks: num(raw.clicks ?? raw.link_clicks ?? raw.call_clicks),
    ctr: num(raw.ctr ?? raw.ctr_rate ?? raw.click_through_rate),
    cpc: num(raw.cpc ?? raw.cost_per_click),
    cpm: num(raw.cpm ?? raw.cost_per_mille),
    messages: num(raw.messages ?? raw.dm ?? raw.direct_messages ?? raw.calls),
    leads: num(raw.leads ?? raw.lead_events ?? raw.lead_count),
    conversions: num(raw.conversions ?? raw.conversion_events ?? raw.purchases),
    revenueCents: num(
      raw.revenueCents ?? raw.revenue_cents ?? raw.revenue ?? raw.purchase_value_cents
    ),
    followers: num(
      raw.followers ?? raw.new_followers ?? raw.follower_count ?? raw.net_followers
    ),
  };
}
