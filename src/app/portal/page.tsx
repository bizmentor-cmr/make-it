"use client";

/**
 * Make It — Client Portal (standalone page at /portal)
 *
 * This page is COMPLETELY SEPARATE from the main app:
 *  - No Make It sidebar / header / theme toggle.
 *  - Separate auth surface: the client signs in with a `ClientUser` email +
 *    password created by the agency; we receive a JWT signed with
 *    CLIENT_PORTAL_SECRET and store it in localStorage.
 *  - All API calls go to `/api/client-portal/*` with the JWT in the
 *    Authorization header. The portal CANNOT access main app routes
 *    (`/api/workspaces`, `/api/brand`, etc.) — those require a NextAuth cookie.
 *  - The portal uses the ClientBranding colors (logo, primary color, agency
 *    name) via inline CSS variables on the root div — overriding the Make It
 *    violet with the agency's branding when white-label is on.
 *  - Mobile-first: large touch targets, simple flow, clients validate from
 *    their phones.
 */

import * as React from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Eye,
  Heart,
  TrendingUp,
  Target,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Sparkles,
  Calendar,
  FileText,
  Megaphone,
  BarChart3,
  CheckCircle2,
  XCircle,
  LogOut,
  Loader2,
  Clock,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PortalToken = string;

type ClientUserPublic = {
  id: string;
  name: string | null;
  email: string;
};

type ClientBranding = {
  id: string;
  agencyClientId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  agencyName: string | null;
};

type PortalMeResponse = {
  clientUser: ClientUserPublic;
  agencyClient: {
    id: string;
    agencyId: string;
    workspaceId: string;
    status: string;
    name: string;
    slug: string;
  };
  workspace: { id: string; name: string; slug: string; plan: string };
  branding: ClientBranding;
  agency: { id: string; name: string; slug: string; whiteLabel: boolean };
};

type LoginResponse = {
  token: string;
  clientUser: ClientUserPublic;
  agencyClient: { id: string; name: string; workspaceId: string };
  branding: ClientBranding;
};

type DashboardResponse = {
  makeItScore: {
    total: number;
    delta: number;
    subscores: { key: string; label: string; value: number; delta?: number; note?: string }[];
  };
  upcomingContentCount: number;
  pendingValidationsCount: number;
  recentPerformances: Array<{
    id: string;
    publishedAt: string | null;
    status: string;
    platform: string | null;
    accountName: string | null;
    permalink: string | null;
    content: { id: string; title: string; type: string } | null;
  }>;
  metrics: {
    impressions: number;
    reach: number;
    engagement: number;
    clicks: number;
    conversions: number;
    followers: number;
    revenueCents: number;
    engagementRate: number;
    ctr: number;
  } | null;
  byPlatform: Array<{ platform: string | null; metrics: { reach: number; engagement: number; impressions: number } }>;
};

type PlanningResponse = {
  plans: Array<{
    id: string;
    name: string;
    horizon: number;
    startDate: string;
    endDate: string;
    objective: string | null;
    items: Array<{
      id: string;
      day: number;
      platform: string;
      format: string;
      title: string;
      goal: string | null;
      status: string;
      scheduledAt: string | null;
      time: string | null;
      contentId: string | null;
      validationStage: string | null;
    }>;
  }>;
  content: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    objective: string | null;
    platforms: string[];
    updatedAt: string;
    validationStage: string | null;
  }>;
};

type ContentItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  objective: string | null;
  pillar: string | null;
  platforms: string[];
  updatedAt: string;
  createdAt: string;
  validationStage: string | null;
  preview: {
    hook?: string;
    body?: string;
    cta?: string;
    hashtags?: string[];
    mediaUrl?: string;
  } | null;
  version: number | null;
};

type ContentResponse = { items: ContentItem[] };

type CampaignsResponse = {
  items: Array<{
    id: string;
    name: string;
    objective: string;
    budgetCents: number;
    spentCents: number;
    startDate: string | null;
    endDate: string | null;
    platforms: string[];
    status: string;
    variantCount: number;
    contentCount: number;
    cpaCents: number;
    createdAt: string;
  }>;
  summary: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalBudgetCents: number;
    totalSpentCents: number;
    globalCpaCents: number;
    conversions: number;
  };
};

type PerformanceResponse = {
  metrics: {
    impressions: number;
    reach: number;
    engagement: number;
    clicks: number;
    conversions: number;
    followers: number;
    revenueCents: number;
    engagementRate: number;
    ctr: number;
  };
  byPlatform: Array<{ platform: string | null; metrics: { impressions: number; engagement: number; reach: number } }>;
  daily: Array<{ date: string; metrics: { impressions: number; engagement: number; reach: number } }>;
};

type ValidationItem = {
  contentId: string;
  title: string;
  type: string | null;
  objective: string | null;
  platforms: string[];
  updatedAt: string;
  stage: string;
  cdpValidatedBy: { id: string; name: string | null; email: string } | null;
  cdpComment: string | null;
  cdpValidatedAt: string | null;
  preview: {
    hook?: string;
    body?: string;
    cta?: string;
    hashtags?: string[];
    mediaUrl?: string;
  } | null;
  version: number | null;
};

type ValidationsResponse = { items: ValidationItem[] };

type PortalTab = "home" | "planning" | "content" | "campaigns" | "performance" | "validations";

/* ------------------------------------------------------------------ */
/*  Portal API client (separate from the main apiGet — uses Bearer)   */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = "makeit_portal_token";

async function portalFetch<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; token?: PortalToken | null } = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: payload,
  });
  const text = await res.text();
  type Envelope = { success?: boolean; data?: unknown; error?: string | { message?: string } | null };
  let env: Envelope | null = null;
  if (text) {
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      env = null;
    }
  }
  if (!env || env.success === false || !res.ok) {
    const msg =
      (env && typeof env.error === "string"
        ? env.error
        : env && env.error && typeof env.error === "object"
        ? env.error.message
        : null) ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (env.data ?? null) as T;
}

/* ------------------------------------------------------------------ */
/*  Validation stage meta (shared colors with the main app)           */
/* ------------------------------------------------------------------ */

const VALIDATION_META: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Brouillon", bg: "bg-muted", fg: "text-muted-foreground" },
  pending_cdp: { label: "CDP", bg: "bg-amber-100", fg: "text-amber-700" },
  pending_client: { label: "À valider", bg: "bg-violet-100", fg: "text-violet-700" },
  validated: { label: "Validé", bg: "bg-emerald-100", fg: "text-emerald-700" },
  refused: { label: "Refusé", bg: "bg-rose-100", fg: "text-rose-700" },
};

function ValidationBadge({ stage }: { stage: string | null }) {
  if (!stage) return null;
  const meta = VALIDATION_META[stage] ?? VALIDATION_META.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", meta.bg, meta.fg)}>
      {meta.label}
    </span>
  );
}

function PlatformPill({ platform }: { platform: string | null }) {
  if (!platform) return null;
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  return (
    <span className="inline-flex items-center rounded-md bg-foreground/5 px-2 py-0.5 text-[11px] font-medium text-foreground">
      {label}
    </span>
  );
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return d.toLocaleDateString("fr-FR");
}

/* ------------------------------------------------------------------ */
/*  Login screen                                                       */
/* ------------------------------------------------------------------ */

function LoginScreen({ onLogin }: { onLogin: (t: LoginResponse) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Email et mot de passe requis");
      return;
    }
    setLoading(true);
    try {
      const res = await portalFetch<LoginResponse>("/api/client-portal/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      });
      localStorage.setItem(TOKEN_KEY, res.token);
      toast.success(`Bienvenue${res.clientUser.name ? `, ${res.clientUser.name}` : ""}`);
      onLogin(res);
    } catch (e) {
      toast.error("Connexion échouée", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-white shadow-lg">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">Portail client</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connectez-vous pour suivre votre stratégie marketing et valider vos contenus.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="surface-card p-6 space-y-4">
          <div>
            <Label htmlFor="portal-email" className="text-sm">Email</Label>
            <Input
              id="portal-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
              className="mt-1 h-11"
            />
          </div>
          <div>
            <Label htmlFor="portal-password" className="text-sm">Mot de passe</Label>
            <Input
              id="portal-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-11"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full h-11" size="lg">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Se connecter
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Vos identifiants vous ont été communiqués par votre agence.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function PortalHeader({
  me,
  onLogout,
}: {
  me: PortalMeResponse;
  onLogout: () => void;
}) {
  const branding = me.branding;
  const agencyName = branding.agencyName ?? me.agency.name;
  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{
        background: "color-mix(in srgb, var(--portal-primary, var(--ink)) 6%, white)",
        borderColor: "color-mix(in srgb, var(--portal-primary, var(--ink)) 18%, white)",
      }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        {branding.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={agencyName}
            className="h-9 w-9 rounded-lg object-cover"
          />
        ) : (
          <div
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--portal-primary, var(--ink))" }}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{agencyName}</div>
          <div className="truncate text-xs text-muted-foreground">{me.workspace.name}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onLogout}
          className="h-9 shrink-0"
          aria-label="Déconnexion"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Déconnexion</span>
        </Button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Home tab                                                           */
/* ------------------------------------------------------------------ */

function HomeTab({
  dashboard,
  clientName,
  onGoToValidations,
}: {
  dashboard: DashboardResponse | null;
  clientName: string;
  onGoToValidations: () => void;
}) {
  const score = dashboard?.makeItScore;
  const metrics = dashboard?.metrics;

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="surface-hero p-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Bonjour {clientName.split(" ")[0]}
        </div>
        <h1 className="mt-1 text-xl font-bold text-foreground">
          Votre tableau de bord
        </h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Suivez la stratégie marketing pilotée par votre agence, validez les contenus avant publication et consultez vos performances.
        </p>
      </div>

      {/* Make It Score */}
      <div className="surface-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Make It Score</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums text-foreground">
                {score?.total ?? "—"}
              </span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              {score && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
                    score.delta >= 0
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700"
                  )}
                >
                  {score.delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {score.delta >= 0 ? "+" : ""}{score.delta}%
                </span>
              )}
            </div>
          </div>
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl text-white"
            style={{ background: "var(--portal-primary, var(--ink))" }}
          >
            <Sparkles className="h-7 w-7" />
          </div>
        </div>
        {score?.subscores && score.subscores.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {score.subscores.slice(0, 4).map((s) => (
              <div key={s.key} className="rounded-lg bg-foreground/5 p-2.5">
                <div className="text-[11px] text-muted-foreground">{s.label}</div>
                <div className="text-base font-semibold tabular-nums text-foreground">{Math.round(s.value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onGoToValidations}
          className="surface-card p-4 text-left transition-transform active:scale-[0.98]"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {dashboard?.pendingValidationsCount ?? 0}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Contenus à valider
          </div>
        </button>
        <div className="surface-card p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Calendar className="h-5 w-5" />
            </span>
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {dashboard?.upcomingContentCount ?? 0}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Contenus à venir
          </div>
        </div>
      </div>

      {/* Metrics (if available) */}
      {metrics && (metrics.impressions > 0 || metrics.engagement > 0) && (
        <div className="surface-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">30 derniers jours</div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Impressions" value={formatNumber(metrics.impressions)} icon={<Eye className="h-4 w-4" />} />
            <MetricTile label="Engagement" value={formatNumber(metrics.engagement)} icon={<Heart className="h-4 w-4" />} />
            <MetricTile label="Portée" value={formatNumber(metrics.reach)} icon={<TrendingUp className="h-4 w-4" />} />
            <MetricTile label="Conversions" value={formatNumber(metrics.conversions)} icon={<Target className="h-4 w-4" />} />
          </div>
        </div>
      )}

      {/* Recent performances */}
      {dashboard && dashboard.recentPerformances.length > 0 && (
        <div className="surface-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Publications récentes</h3>
          <ul className="mt-3 space-y-2.5">
            {dashboard.recentPerformances.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <PlatformPill platform={p.platform} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {p.content?.title ?? "Publication"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.publishedAt ? timeAgo(p.publishedAt) : "—"}
                  </div>
                </div>
                {p.permalink && (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground hover:bg-foreground/10"
                    aria-label="Voir la publication"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-foreground/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Planning tab                                                       */
/* ------------------------------------------------------------------ */

function PlanningTab({ planning }: { planning: PlanningResponse | null }) {
  if (!planning || (planning.plans.length === 0 && planning.content.length === 0)) {
    return (
      <div className="surface-soft p-6 text-center text-sm text-muted-foreground">
        Aucun planning éditorial pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {planning.plans.length > 0 && (
        <>
          {planning.plans.map((plan) => (
            <div key={plan.id} className="surface-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                <span className="text-xs text-muted-foreground">{plan.horizon} jours</span>
              </div>
              <ul className="space-y-2">
                {plan.items.map((it) => (
                  <li
                    key={it.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground/5 text-xs font-semibold text-foreground">
                        J{it.day}
                      </span>
                      <PlatformPill platform={it.platform} />
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        {it.format}
                      </span>
                      <div className="ml-auto">
                        <ValidationBadge stage={it.validationStage} />
                      </div>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground text-pretty">{it.title}</div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {it.time ?? "—"}
                      </span>
                      <span className="capitalize">{it.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {planning.content.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Contenus planifiés</h3>
          <ul className="space-y-2">
            {planning.content.slice(0, 20).map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{c.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{c.type}</span>
                      <span>·</span>
                      <span className="capitalize">{c.status}</span>
                      {c.platforms.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{c.platforms.join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ValidationBadge stage={c.validationStage} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content tab                                                        */
/* ------------------------------------------------------------------ */

function ContentTab({ content }: { content: ContentResponse | null }) {
  if (!content || content.items.length === 0) {
    return (
      <div className="surface-soft p-6 text-center text-sm text-muted-foreground">
        Aucun contenu créé pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {content.items.map((c) => (
        <div key={c.id} className="surface-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground text-pretty">{c.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="capitalize">{c.type}</span>
                <span>·</span>
                <span className="capitalize">{c.status}</span>
                {c.objective && (
                  <>
                    <span>·</span>
                    <span className="capitalize">{c.objective}</span>
                  </>
                )}
              </div>
            </div>
            <ValidationBadge stage={c.validationStage} />
          </div>
          {c.preview && (c.preview.hook || c.preview.body) && (
            <div className="mt-3 rounded-lg bg-foreground/5 p-3 text-sm text-foreground/80">
              {c.preview.hook && (
                <div className="font-medium text-foreground">{c.preview.hook}</div>
              )}
              {c.preview.body && (
                <p className="mt-1 whitespace-pre-wrap text-pretty">{c.preview.body}</p>
              )}
              {c.preview.cta && (
                <div className="mt-2 text-xs font-medium" style={{ color: "var(--portal-primary, var(--ink))" }}>
                  {c.preview.cta}
                </div>
              )}
            </div>
          )}
          {c.preview?.hashtags && c.preview.hashtags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.preview.hashtags.slice(0, 8).map((h, i) => (
                <span key={i} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                  #{h.replace(/^#/, "")}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            Mis à jour {timeAgo(c.updatedAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Campaigns tab                                                      */
/* ------------------------------------------------------------------ */

function CampaignsTab({ campaigns }: { campaigns: CampaignsResponse | null }) {
  if (!campaigns || campaigns.items.length === 0) {
    return (
      <div className="surface-soft p-6 text-center text-sm text-muted-foreground">
        Aucune campagne pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Campagnes" value={String(campaigns.summary.totalCampaigns)} icon={<Megaphone className="h-4 w-4" />} />
        <MetricTile label="Actives" value={String(campaigns.summary.activeCampaigns)} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricTile label="Budget" value={formatEuro(campaigns.summary.totalBudgetCents)} icon={<Target className="h-4 w-4" />} />
        <MetricTile label="CPA moyen" value={campaigns.summary.globalCpaCents > 0 ? formatEuro(campaigns.summary.globalCpaCents) : "—"} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <div className="space-y-3">
        {campaigns.items.map((c) => {
          const progress = c.budgetCents > 0 ? Math.min(100, Math.round((c.spentCents / c.budgetCents) * 100)) : 0;
          return (
            <div key={c.id} className="surface-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground text-pretty">{c.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{c.objective}</span>
                    <span>·</span>
                    <span className="capitalize">{c.status}</span>
                    {c.platforms.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{c.platforms.join(", ")}</span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    c.status === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : c.status === "paused"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {c.status}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-foreground/5 p-2">
                  <div className="text-muted-foreground">Budget</div>
                  <div className="mt-0.5 font-semibold text-foreground">{formatEuro(c.budgetCents)}</div>
                </div>
                <div className="rounded-lg bg-foreground/5 p-2">
                  <div className="text-muted-foreground">Dépensé</div>
                  <div className="mt-0.5 font-semibold text-foreground">{formatEuro(c.spentCents)}</div>
                </div>
                <div className="rounded-lg bg-foreground/5 p-2">
                  <div className="text-muted-foreground">CPA</div>
                  <div className="mt-0.5 font-semibold text-foreground">
                    {c.cpaCents > 0 ? formatEuro(c.cpaCents) : "—"}
                  </div>
                </div>
              </div>
              {c.budgetCents > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${progress}%`,
                        background: "var(--portal-primary, var(--ink))",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Performance tab                                                    */
/* ------------------------------------------------------------------ */

function PerformanceTab({ performance }: { performance: PerformanceResponse | null }) {
  if (!performance || (performance.metrics.impressions === 0 && performance.metrics.engagement === 0)) {
    return (
      <div className="surface-soft p-6 text-center text-sm text-muted-foreground">
        Pas encore de données de performance sur la période.
      </div>
    );
  }
  const m = performance.metrics;
  const maxDailyImpressions = Math.max(1, ...performance.daily.map((d) => d.metrics.impressions));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile label="Impressions" value={formatNumber(m.impressions)} icon={<Eye className="h-4 w-4" />} />
        <MetricTile label="Portée" value={formatNumber(m.reach)} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricTile label="Engagements" value={formatNumber(m.engagement)} icon={<Heart className="h-4 w-4" />} />
        <MetricTile label="Taux d'engagement" value={`${(m.engagementRate * 100).toFixed(2)}%`} icon={<Sparkles className="h-4 w-4" />} />
        <MetricTile label="Clics" value={formatNumber(m.clicks)} icon={<ArrowRight className="h-4 w-4" />} />
        <MetricTile label="Conversions" value={formatNumber(m.conversions)} icon={<Target className="h-4 w-4" />} />
        <MetricTile label="Abonnés gagnés" value={formatNumber(m.followers)} icon={<ArrowUp className="h-4 w-4" />} />
        <MetricTile label="Revenu" value={formatEuro(m.revenueCents)} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricTile label="CTR" value={`${(m.ctr * 100).toFixed(2)}%`} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      {/* Daily impressions bar chart */}
      {performance.daily.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Impressions (30 derniers jours)</h3>
          <div className="mt-3 flex h-32 items-end gap-0.5" aria-hidden>
            {performance.daily.map((d, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(2, (d.metrics.impressions / maxDailyImpressions) * 100)}%`,
                  background: "var(--portal-primary, var(--ink))",
                  opacity: 0.7,
                }}
                title={`${d.date}: ${formatNumber(d.metrics.impressions)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* By platform */}
      {performance.byPlatform.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Par plateforme</h3>
          <ul className="mt-3 space-y-2.5">
            {performance.byPlatform.map((p, i) => (
              <li key={i} className="flex items-center gap-3">
                <PlatformPill platform={p.platform} />
                <div className="flex-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(100, (p.metrics.impressions / Math.max(1, m.impressions)) * 100)}%`,
                        background: "var(--portal-secondary, var(--emerald-accent))",
                      }}
                    />
                  </div>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatNumber(p.metrics.impressions)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Validations tab                                                    */
/* ------------------------------------------------------------------ */

function ValidationsTab({
  items,
  token,
  onChanged,
}: {
  items: ValidationItem[];
  token: PortalToken;
  onChanged: () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [refuseReasons, setRefuseReasons] = useState<Record<string, string>>({});

  if (items.length === 0) {
    return (
      <div className="surface-soft p-8 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">Tout est à jour</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Aucun contenu n'attend votre validation. Votre agence vous préviendra dès qu'un nouveau contenu sera prêt.
        </p>
      </div>
    );
  }

  const handleAction = async (item: ValidationItem, action: "validate" | "refuse") => {
    setActing(item.contentId);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "validate") {
        const comment = comments[item.contentId]?.trim();
        if (comment) body.comment = comment;
      } else {
        const reason = refuseReasons[item.contentId]?.trim();
        if (reason) body.reason = reason;
      }
      await portalFetch(`/api/client-portal/validations/${item.contentId}`, {
        method: "POST",
        body,
        token,
      });
      toast.success(action === "validate" ? "Contenu validé" : "Contenu refusé", {
        description: action === "validate"
          ? "Votre agence a été notifiée."
          : "Votre agence va retravailler le contenu.",
      });
      onChanged();
    } catch (e) {
      toast.error("Échec de l'action", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-sm text-violet-900">
        <strong>{items.length}</strong> contenu{items.length > 1 ? "s" : ""} à valider. Votre agence attend votre retour pour publier.
      </div>

      {items.map((item) => (
        <div key={item.contentId} className="surface-card overflow-hidden">
          {/* Header */}
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground text-pretty">{item.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{item.type ?? "Contenu"}</span>
                  {item.objective && (
                    <>
                      <span>·</span>
                      <span className="capitalize">{item.objective}</span>
                    </>
                  )}
                  {item.platforms.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{item.platforms.join(", ")}</span>
                    </>
                  )}
                </div>
              </div>
              <ValidationBadge stage={item.stage} />
            </div>
            {item.cdpValidatedBy && (
              <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                Validé par {item.cdpValidatedBy.name ?? item.cdpValidatedBy.email}
                {item.cdpComment ? ` — « ${item.cdpComment} »` : ""}
              </div>
            )}
          </div>

          {/* Preview */}
          {item.preview && (item.preview.hook || item.preview.body || item.preview.mediaUrl) && (
            <div className="p-4">
              {item.preview.mediaUrl && (
                <img
                  src={item.preview.mediaUrl}
                  alt="Aperçu du contenu"
                  className="mb-3 w-full rounded-lg object-cover"
                  style={{ maxHeight: 320 }}
                />
              )}
              {item.preview.hook && (
                <div className="font-medium text-foreground">{item.preview.hook}</div>
              )}
              {item.preview.body && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80 text-pretty">
                  {item.preview.body}
                </p>
              )}
              {item.preview.cta && (
                <div
                  className="mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium"
                  style={{
                    background: "color-mix(in srgb, var(--portal-primary, var(--ink)) 10%, white)",
                    color: "var(--portal-primary, var(--ink))",
                  }}
                >
                  {item.preview.cta}
                </div>
              )}
              {item.preview.hashtags && item.preview.hashtags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.preview.hashtags.slice(0, 10).map((h, i) => (
                    <span key={i} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                      #{h.replace(/^#/, "")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Comment + actions */}
          <div className="border-t border-border bg-foreground/[0.02] p-4">
            <Label htmlFor={`comment-${item.contentId}`} className="text-xs text-muted-foreground">
              Commentaire {`(optionnel — visible par votre agence)`}
            </Label>
            <Textarea
              id={`comment-${item.contentId}`}
              rows={2}
              placeholder={item.stage === "pending_client" ? "Votre retour…" : "Précisez votre commentaire…"}
              value={comments[item.contentId] ?? ""}
              onChange={(e) =>
                setComments((p) => ({ ...p, [item.contentId]: e.target.value }))
              }
              className="mt-1"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => handleAction(item, "validate")}
                disabled={acting === item.contentId}
                className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {acting === item.contentId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Valider
              </Button>
              <Button
                onClick={() => handleAction(item, "refuse")}
                disabled={acting === item.contentId}
                variant="outline"
                className="h-11 flex-1 border-rose-300 text-rose-700 hover:bg-rose-50"
              >
                <XCircle className="h-4 w-4" />
                Refuser
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main portal shell                                                  */
/* ------------------------------------------------------------------ */

export default function PortalPage() {
  const [token, setToken] = useState<PortalToken | null>(null);
  const [me, setMe] = useState<PortalMeResponse | null>(null);
  const [bootState, setBootState] = useState<"loading" | "ready">("loading");
  const [activeTab, setActiveTab] = useState<PortalTab>("home");

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [planning, setPlanning] = useState<PlanningResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsResponse | null>(null);
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [validations, setValidations] = useState<ValidationItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Bootstrap: read token from localStorage, fetch /me. Deferred to microtask
  // to avoid the `react-hooks/set-state-in-effect` rule (synchronous setState
  // in an effect body causes cascading renders).
  useEffect(() => {
    let cancelled = false;
    const t = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const finish = () => {
      if (!cancelled) setBootState("ready");
    };
    if (!t) {
      Promise.resolve().then(finish);
      return () => {
        cancelled = true;
      };
    }
    portalFetch<PortalMeResponse>("/api/client-portal/auth/me", { token: t })
      .then((res) => {
        if (cancelled) return;
        setToken(t);
        setMe(res);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setMe(null);
      })
      .finally(finish);
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the active tab's data when token or tab changes.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        if (activeTab === "home") {
          const d = await portalFetch<DashboardResponse>("/api/client-portal/dashboard", { token });
          if (!cancelled) setDashboard(d);
        } else if (activeTab === "planning") {
          const p = await portalFetch<PlanningResponse>("/api/client-portal/planning", { token });
          if (!cancelled) setPlanning(p);
        } else if (activeTab === "content") {
          const c = await portalFetch<ContentResponse>("/api/client-portal/content", { token });
          if (!cancelled) setContent(c);
        } else if (activeTab === "campaigns") {
          const cm = await portalFetch<CampaignsResponse>("/api/client-portal/campaigns", { token });
          if (!cancelled) setCampaigns(cm);
        } else if (activeTab === "performance") {
          const pf = await portalFetch<PerformanceResponse>("/api/client-portal/performance?range=30", { token });
          if (!cancelled) setPerformance(pf);
        } else if (activeTab === "validations") {
          const v = await portalFetch<ValidationsResponse>("/api/client-portal/validations", { token });
          if (!cancelled) setValidations(v.items);
        }
      } catch (e) {
        if (typeof e === "object" && e !== null && "status" in e && (e as { status?: number }).status === 401) {
          // Token expired — kick back to login.
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setMe(null);
        } else {
          toast.error("Données indisponibles", {
            description: e instanceof Error ? e.message : undefined,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeTab, refreshKey]);

  // On login, fetch /me to populate branding + workspace.
  const handleLogin = useCallback(async (res: LoginResponse) => {
    setToken(res.token);
    // Fetch /me for the full context (workspace + branding).
    try {
      const meRes = await portalFetch<PortalMeResponse>("/api/client-portal/auth/me", { token: res.token });
      setMe(meRes);
    } catch {
      // If /me fails for some reason, fall back to the login response's branding.
      setMe({
        clientUser: res.clientUser,
        agencyClient: {
          id: res.agencyClient.id,
          agencyId: "",
          workspaceId: res.agencyClient.workspaceId,
          status: "active",
          name: res.agencyClient.name,
          slug: "",
        },
        workspace: {
          id: res.agencyClient.workspaceId,
          name: res.agencyClient.name,
          slug: "",
          plan: "free",
        },
        branding: res.branding,
        agency: { id: "", name: res.branding.agencyName ?? "", slug: "", whiteLabel: true },
      });
    }
    setActiveTab("home");
  }, []);

  const handleLogout = useCallback(async () => {
    if (token) {
      try {
        await portalFetch("/api/client-portal/auth/logout", { method: "POST", token });
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setDashboard(null);
    setPlanning(null);
    setContent(null);
    setCampaigns(null);
    setPerformance(null);
    setValidations([]);
    toast.success("Déconnecté");
  }, [token]);

  // Apply the branding colors via inline CSS variables on the root div.
  const brandingStyle = useMemo<React.CSSProperties>(() => {
    if (!me?.branding) return {};
    const b = me.branding;
    return {
      // Override --portal-primary / --portal-secondary used throughout the portal.
      ["--portal-primary" as never]: b.primaryColor ?? "var(--ink)",
      ["--portal-secondary" as never]: b.secondaryColor ?? "var(--emerald-accent)",
    };
  }, [me]);

  if (bootState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token || !me) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const whiteLabel = me.agency.whiteLabel || !!me.branding.agencyName;
  const clientName = me.clientUser.name ?? me.clientUser.email.split("@")[0];
  const pendingCount = dashboard?.pendingValidationsCount ?? 0;

  return (
    <div
      style={brandingStyle}
      className="min-h-screen bg-background text-foreground"
    >
      <PortalHeader me={me} onLogout={handleLogout} />

      <main className="mx-auto max-w-5xl px-4 py-5 pb-24">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PortalTab)} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
            <TabsTrigger value="home" className="flex flex-col items-center gap-0.5 py-2 text-xs">
              <Sparkles className="h-4 w-4" />
              Accueil
            </TabsTrigger>
            <TabsTrigger value="planning" className="flex flex-col items-center gap-0.5 py-2 text-xs">
              <Calendar className="h-4 w-4" />
              Planning
            </TabsTrigger>
            <TabsTrigger value="content" className="flex flex-col items-center gap-0.5 py-2 text-xs">
              <FileText className="h-4 w-4" />
              Contenu
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="flex flex-col items-center gap-0.5 py-2 text-xs">
              <Megaphone className="h-4 w-4" />
              Campagnes
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex flex-col items-center gap-0.5 py-2 text-xs">
              <BarChart3 className="h-4 w-4" />
              Performances
            </TabsTrigger>
            <TabsTrigger value="validations" className="flex flex-col items-center gap-0.5 py-2 text-xs relative">
              <CheckCircle2 className="h-4 w-4" />
              Validations
              {pendingCount > 0 && (
                <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="home">
            <HomeTab
              dashboard={dashboard}
              clientName={clientName}
              onGoToValidations={() => setActiveTab("validations")}
            />
          </TabsContent>
          <TabsContent value="planning">
            <PlanningTab planning={planning} />
          </TabsContent>
          <TabsContent value="content">
            <ContentTab content={content} />
          </TabsContent>
          <TabsContent value="campaigns">
            <CampaignsTab campaigns={campaigns} />
          </TabsContent>
          <TabsContent value="performance">
            <PerformanceTab performance={performance} />
          </TabsContent>
          <TabsContent value="validations">
            <ValidationsTab
              items={validations}
              token={token}
              onChanged={() => {
                // Refresh both validations + dashboard (the pending count badge).
                setRefreshKey((k) => k + 1);
                // Force a re-fetch of the dashboard too.
                if (token) {
                  portalFetch<DashboardResponse>("/api/client-portal/dashboard", { token })
                    .then(setDashboard)
                    .catch(() => undefined);
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        {whiteLabel ? (
          <span>Portail client · {me.branding.agencyName ?? me.agency.name}</span>
        ) : (
          <span>Propulsé par <strong className="text-foreground">Make It for Agencies</strong></span>
        )}
      </footer>
    </div>
  );
}
