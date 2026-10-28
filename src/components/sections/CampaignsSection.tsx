"use client";

import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import {
  ArrowRight,
  ArrowLeft,
  MessageCircle,
  Users,
  ShoppingCart,
  MousePointerClick,
  Eye,
  Sparkles,
  Pause,
  Wand2,
  Lightbulb,
  Target,
  MapPin,
  Check,
  Megaphone,
  PiggyBank,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformDot } from "@/components/shared/PlatformBadge";
import { AIBadge } from "@/components/shared/AIBadge";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { GenerationProgress } from "@/components/shared/GenerationProgress";
import { useAppStore } from "@/store/app-store";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import {
  campaigns as mockCampaigns,
  PLATFORM_META,
  type Platform,
  type Campaign,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

/* ================================================================== */
/*  Static config                                                      */
/* ================================================================== */

const STATUS_META: Record<
  Campaign["status"],
  { chip: string; dot: string; label: string }
> = {
  Active: {
    chip: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
    label: "Active",
  },
  Paused: {
    chip: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
    label: "En pause",
  },
  Draft: {
    chip: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    label: "Brouillon",
  },
};

const OBJECTIVE_ICON: Record<string, React.ReactNode> = {
  "Plus de visibilité": <Eye className="h-3.5 w-3.5" />,
  "Plus de prospects": <Users className="h-3.5 w-3.5" />,
  "Plus de ventes": <ShoppingCart className="h-3.5 w-3.5" />,
  "Plus de trafic": <MousePointerClick className="h-3.5 w-3.5" />,
  "Plus de messages": <MessageCircle className="h-3.5 w-3.5" />,
};

const OBJECTIVE_LABEL_SHORT: Record<string, string> = {
  "Plus de visibilité": "impressions",
  "Plus de prospects": "leads",
  "Plus de ventes": "ventes",
  "Plus de trafic": "clics",
  "Plus de messages": "conversations",
};

type Objective =
  | "Plus de messages"
  | "Plus de prospects"
  | "Plus de ventes"
  | "Plus de trafic"
  | "Plus de visibilité";

const OBJECTIVES: {
  value: Objective;
  icon: React.ReactNode;
  desc: string;
}[] = [
  { value: "Plus de messages", icon: <MessageCircle className="h-5 w-5" />, desc: "Démarrer des conversations avec vos prospects." },
  { value: "Plus de prospects", icon: <Users className="h-5 w-5" />, desc: "Collecter des contacts qualifiés." },
  { value: "Plus de ventes", icon: <ShoppingCart className="h-5 w-5" />, desc: "Générer du chiffre d'affaires." },
  { value: "Plus de trafic", icon: <MousePointerClick className="h-5 w-5" />, desc: "Attirer des visiteurs sur votre site." },
  { value: "Plus de visibilité", icon: <Eye className="h-5 w-5" />, desc: "Faire connaître votre marque largement." },
];

const AUDIENCES = [
  "Femmes 25-40 urbaines",
  "Créateurs de contenu",
  "E-commerçants",
  "Parents",
  "Étudiants",
  "Pros B2B",
];

const WIZARD_PLATFORMS: Platform[] = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube",
];

const WIZARD_STEPS = ["Objectif", "Audience", "Plateformes", "Budget"];

const CPR_BY_OBJECTIVE: Record<Objective, number> = {
  "Plus de messages": 7,
  "Plus de prospects": 7,
  "Plus de ventes": 15,
  "Plus de trafic": 0.5,
  "Plus de visibilité": 0.025,
};

const LAUNCH_CREDITS = 120;

/* ================================================================== */
/*  Sparkline (recharts, no axes)                                      */
/* ================================================================== */

function Sparkline({
  data,
  color = "oklch(0.55 0.13 165)",
}: {
  data: number[];
  color?: string;
}) {
  const chartData = data.map((v, i) => ({ i, v }));
  const max = Math.max(...data, 1);
  return (
    <div className="h-9 w-24 sm:w-28" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <YAxis hide domain={[0, max]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ================================================================== */
/*  Local StatCard (mirrors shared InsightStat, with deltaInverted)    */
/* ================================================================== */

function StatCard({
  label,
  value,
  delta,
  deltaInverted = false,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: number;
  deltaInverted?: boolean;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const positive = (delta ?? 0) >= 0;
  // When deltaInverted: a negative delta is "good" (emerald), positive is "bad" (rose)
  const deltaColor = deltaInverted
    ? positive
      ? "text-rose-600"
      : "text-emerald-600"
    : positive
    ? "text-emerald-600"
    : "text-rose-600";
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
      ? "text-rose-600"
      : tone === "warn"
      ? "text-amber-600"
      : "text-muted-foreground";
  return (
    <div className="surface-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {delta !== undefined && (
          <span className={cn("text-xs font-medium", deltaColor)}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      {hint && <p className={cn("mt-1 text-xs", toneCls)}>{hint}</p>}
    </div>
  );
}

/* ================================================================== */
/*  Campaign row                                                       */
/* ================================================================== */

function CampaignRow({
  c,
  onOptimize,
  onPause,
  onDetails,
  onSeeReco,
}: {
  c: Campaign;
  onOptimize: () => void;
  onPause: () => void;
  onDetails: () => void;
  onSeeReco: () => void;
}) {
  const status = STATUS_META[c.status];
  const isUnder = c.id === "cmp3";
  const trendColor =
    c.status === "Active"
      ? "oklch(0.55 0.13 165)"
      : c.status === "Paused"
      ? "oklch(0.75 0.16 70)"
      : "oklch(0.7 0.01 240)";

  const cpaLabel =
    c.cpa > 0 ? `${c.cpa.toFixed(2).replace(".", ",")} €` : "—";

  return (
    <div className="surface-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* LEFT — name + chips */}
        <div className="min-w-0 lg:max-w-xs">
          <p className="font-semibold text-foreground truncate">{c.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-foreground/80">
              {OBJECTIVE_ICON[c.objective] ?? <Target className="h-3.5 w-3.5" />}
              {c.objective}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                status.chip
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
          </div>
        </div>

        {/* MIDDLE — platforms + sparkline */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1">
            {c.platforms.map((p) => (
              <PlatformDot key={p} platform={p} />
            ))}
          </div>
          <Sparkline data={c.trend} color={trendColor} />
        </div>

        {/* RIGHT — mini stats + actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end lg:gap-6">
          <div className="grid grid-cols-3 gap-x-5 sm:gap-x-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Dépense
              </p>
              <p className="text-sm font-semibold tabular-nums">{c.spend} €</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Résultats
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {c.results.toLocaleString("fr-FR")}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Coût/rés.
              </p>
              <p className="text-sm font-semibold tabular-nums">{cpaLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={onOptimize}
              className="h-9 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Optimiser
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onPause}
              className="h-9"
            >
              <Pause className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mettre en pause</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDetails}
              className="h-9"
            >
              Détails
            </Button>
          </div>
        </div>
      </div>

      {isUnder && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-rose-700 text-sm">
          <Lightbulb className="h-4 w-4 shrink-0" />
          <span className="text-pretty flex-1 min-w-0">
            Sous l&apos;objectif. Make It recommande de réviser le ciblage.
          </span>
          <button
            onClick={onSeeReco}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700"
          >
            Voir la reco <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Wizard                                                              */
/* ================================================================== */

function Wizard({ onBack }: { onBack: () => void }) {
  const spendCredits = useAppStore((s) => s.spendCredits);
  const creditsTotal = useAppStore((s) => s.creditsTotal);
  const creditsUsed = useAppStore((s) => s.creditsUsed);

  const [step, setStep] = useState(0);
  const [objective, setObjective] = useState<Objective | null>(null);
  const [audiences, setAudiences] = useState<string[]>([
    "Femmes 25-40 urbaines",
  ]);
  const [location, setLocation] = useState("France");
  const [ageRange, setAgeRange] = useState<number[]>([25, 45]);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram"]);
  const [budget, setBudget] = useState(500);
  const [duration, setDuration] = useState(7);
  const [launching, setLaunching] = useState(false);

  const canContinue =
    step === 0 ? !!objective : step === 2 ? platforms.length > 0 : true;

  const cpr = objective ? CPR_BY_OBJECTIVE[objective] : 7;
  const expectedResults = useMemo(
    () => Math.round((budget * 0.85) / cpr),
    [budget, cpr]
  );
  const perPlatform =
    platforms.length > 0
      ? Math.round((budget / platforms.length) * 100) / 100
      : 0;

  function handleLaunch() {
    setLaunching(true);
    spendCredits(LAUNCH_CREDITS);
    // Create the campaign via the real backend, then close the wizard.
    (async () => {
      try {
        const start = new Date();
        const end = new Date();
        end.setDate(end.getDate() + duration);
        await apiPost("/api/campaigns", {
          name: `${objective ?? "Campagne"} — ${location}`,
          objective: objective ?? "Plus de visibilité",
          budgetCents: Math.round(budget * 100),
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          platforms,
          audience: {
            ages: ageRange,
            location,
            segments: audiences,
          },
        });
      } catch (e) {
        toast.error("Création de campagne échouée", {
          description: e instanceof Error ? e.message : "Réessayez plus tard.",
        });
      }
    })();
  }

  function toggleAudience(a: string) {
    setAudiences((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }
  function togglePlatform(p: Platform) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  const stepQuestion: Record<number, string> = {
    0: "Quel est votre objectif ?",
    1: "Qui voulez-vous atteindre ?",
    2: "Où ?",
    3: "Combien souhaitez-vous investir ?",
  };

  return (
    <div className="space-y-6">
      {/* Top: back + progress card */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="mb-1 h-9 -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour aux campagnes
          </Button>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Nouvelle campagne
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Make It vous guide. 4 étapes simples.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="surface-card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          {WIZARD_STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  i < step && "bg-emerald-500 text-white",
                  i === step &&
                    "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]",
                  i > step && "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "hidden md:inline text-sm",
                  i === step
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {s}
              </span>
              {i < WIZARD_STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-1 h-0.5 flex-1 rounded-full",
                    i < step ? "bg-emerald-300" : "bg-muted"
                  )}
                />
              )}
            </div>
          ))}
        </div>
        <Progress
          value={((step + 1) / WIZARD_STEPS.length) * 100}
          className="mt-4 h-1"
        />
      </div>

      {/* Step 1 — Objective */}
      {step === 0 && (
        <div className="surface-card p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-balance">
            {stepQuestion[0]}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Choisissez ce que vous voulez obtenir. Make It adaptera la suite.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OBJECTIVES.map((o) => {
              const sel = objective === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setObjective(o.value)}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-4 text-left transition",
                    sel
                      ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/40"
                      : "border-border bg-background hover:border-foreground/20 hover:bg-muted/40"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-lg",
                      sel
                        ? "bg-emerald-600 text-white"
                        : "bg-foreground/5 text-foreground"
                    )}
                  >
                    {o.icon}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {o.value}
                  </span>
                  <span className="text-xs text-muted-foreground text-pretty">
                    {o.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2 — Audience */}
      {step === 1 && (
        <div className="surface-card p-5 sm:p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-balance">
              {stepQuestion[1]}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Sélectionnez les audiences, ajustez la zone et l&apos;âge. Make It
              affinera automatiquement.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Audiences
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {AUDIENCES.map((a) => {
                const sel = audiences.includes(a);
                return (
                  <button
                    key={a}
                    onClick={() => toggleAudience(a)}
                    className={cn(
                      "min-h-[40px] rounded-full px-3 py-1.5 text-sm transition",
                      sel
                        ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                        : "bg-muted text-foreground/80 hover:bg-muted/70"
                    )}
                  >
                    {sel && <Check className="mr-1 inline h-3 w-3" />}
                    {a}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Zone géographique
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring/40">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  placeholder="France"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tranche d&apos;âge
                </p>
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {ageRange[0]} – {ageRange[1]} ans
                </p>
              </div>
              <Slider
                value={ageRange}
                onValueChange={setAgeRange}
                min={18}
                max={65}
                step={1}
                className="mt-3 h-11"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Platforms */}
      {step === 2 && (
        <div className="surface-card p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-balance">
            {stepQuestion[2]}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Sur quelles plateformes diffuser ? Make It adaptera le format à
            chacune.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {WIZARD_PLATFORMS.map((p) => {
              const sel = platforms.includes(p);
              const meta = PLATFORM_META[p];
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition",
                    sel
                      ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/40"
                      : "border-border bg-background hover:bg-muted/40"
                  )}
                >
                  <PlatformDot platform={p} className="h-9 w-9 text-sm" />
                  <span className="text-sm font-medium text-foreground">
                    {meta.label}
                  </span>
                  {sel ? (
                    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700">
                      <Check className="h-3 w-3" /> Sélectionné
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Cliquez pour ajouter
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 4 — Budget + duration + recommendation summary */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="surface-card p-5 sm:p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-balance">
                {stepQuestion[3]}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                Make It répartit automatiquement votre budget sur les plateformes
                choisies.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Budget total
                </p>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {budget} €
                </p>
              </div>
              <Slider
                value={[budget]}
                onValueChange={(v) => setBudget(v[0])}
                min={50}
                max={2000}
                step={10}
                className="mt-3 h-11"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>50 €</span>
                <span>2 000 €</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Durée
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[3, 7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={cn(
                      "min-h-[44px] rounded-lg px-4 py-2 text-sm transition",
                      duration === d
                        ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                        : "bg-muted text-foreground/80 hover:bg-muted/70"
                    )}
                  >
                    {d} jours
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Recommendation summary card (surface-accent) */}
          <div className="surface-accent p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)]">
                <Wand2 className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">
                    Recommandation Make It
                  </h3>
                  <AIBadge />
                </div>
                <p className="mt-1 text-sm text-pretty">
                  D&apos;après votre objectif{" "}
                  <strong className="font-semibold">{objective}</strong> et votre
                  budget de <strong className="font-semibold">{budget} €</strong>,
                  voici la configuration recommandée.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Budget total</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {budget} €
                    </p>
                    <p className="text-xs text-muted-foreground">
                      sur {duration} jours
                    </p>
                  </div>
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">
                      Résultats estimés
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {expectedResults.toLocaleString("fr-FR")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {objective ? OBJECTIVE_LABEL_SHORT[objective] : "résultats"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">
                      Coût / résultat
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {cpr.toFixed(2).replace(".", ",")} €
                    </p>
                    <p className="text-xs text-muted-foreground">estimé</p>
                  </div>
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Plateformes</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {platforms.length > 0 ? (
                        platforms.map((p) => (
                          <PlatformDot key={p} platform={p} />
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Aucune sélectionnée
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {platforms.length > 0 && (
                  <div className="mt-3 rounded-xl bg-background/60 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Répartition budgétaire
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {platforms.map((p) => (
                        <div
                          key={p}
                          className="flex items-center gap-2 text-sm"
                        >
                          <PlatformDot
                            platform={p}
                            className="h-5 w-5 text-[10px]"
                          />
                          <span className="flex-1 text-foreground/80">
                            {PLATFORM_META[p].label}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {perPlatform} €
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/60 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <PiggyBank className="h-4 w-4 text-emerald-700" />
                    <span>
                      Configuration assistée par IA —{" "}
                      <strong className="font-semibold">
                        ~{LAUNCH_CREDITS} crédits
                      </strong>
                    </span>
                  </div>
                  <Button
                    onClick={handleLaunch}
                    disabled={launching}
                    className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                  >
                    <Sparkles className="h-4 w-4" />
                    Lancer la campagne
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => (step > 0 ? setStep(step - 1) : onBack())}
          className="h-11"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 0 ? "Annuler" : "Précédent"}
        </Button>
        {step < WIZARD_STEPS.length - 1 && (
          <Button
            onClick={() => canContinue && setStep(step + 1)}
            disabled={!canContinue}
            className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            Continuer
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Launch overlay */}
      {launching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md">
            <GenerationProgress
              open={launching}
              steps={["Analyse", "Configuration", "Lancement"]}
              estimated={LAUNCH_CREDITS}
              used={creditsUsed}
              total={creditsTotal}
              onDone={() => {
                setLaunching(false);
                toast.success("Campagne lancée 🎉");
                onBack();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Main section                                                        */
/* ================================================================== */

export function CampaignsSection() {
  const setAdvisorOpen = useAppStore((s) => s.setAdvisorOpen);
  const [view, setView] = useState<"list" | "wizard">("list");
  const [campaigns, setCampaigns] = useState<Campaign[]>(mockCampaigns);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await apiTry(async () => {
        const res = await apiGet<{
          campaigns: {
            id: string;
            name: string;
            objective: string;
            status: string;
            budgetCents: number;
            platforms: string[];
            startDate?: string | null;
            endDate?: string | null;
          }[];
        }>("/api/campaigns?limit=20");
        return (res.campaigns ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: (c.status === "active"
            ? "Active"
            : c.status === "paused"
            ? "Paused"
            : "Draft") as Campaign["status"],
          spend: Math.round((c.budgetCents ?? 0) / 100),
          results: 0,
          cpa: 0,
          platforms: (c.platforms ?? []) as Platform[],
          trend: [4, 6, 8, 10, 14, 18, 22],
        })) as Campaign[];
      }, mockCampaigns);
      if (cancelled) return;
      if (list.length > 0) setCampaigns(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOptimize(c: Campaign) {
    try {
      const res = await apiGet<{
        recommendations?: string[];
        summary?: { avgCtr?: number };
      }>(`/api/campaigns/${c.id}/optimize`);
      toast.success("Optimisation Make It", {
        description:
          res.recommendations?.[0] ??
          "Analyse terminée — ouvrez le conseiller pour le détail.",
      });
      setAdvisorOpen(true);
    } catch (e) {
      toast.error("Optimisation indisponible", {
        description: e instanceof Error ? e.message : undefined,
      });
      setAdvisorOpen(true);
    }
  }

  if (view === "wizard") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Wizard onBack={() => setView("list")} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* 1. SectionHeader */}
      <SectionHeader
        eyebrow="Campagnes"
        title="Vos campagnes"
        description="Make It configure et optimise vos campagnes à votre place. Vous gardez le contrôle."
        actions={
          <Button
            onClick={() => setView("wizard")}
            className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            <Megaphone className="h-4 w-4" />
            ＋ Nouvelle campagne
          </Button>
        }
      />

      {/* 2. Top summary row — 4 InsightStat-style cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Dépense (30j)"
          value="1 320 €"
          hint="Budget total sur 30 jours"
        />
        <StatCard
          label="Résultats"
          value="18 547"
          hint="Conversions toutes campagnes"
        />
        <StatCard
          label="Coût / résultat"
          value="7,08 €"
          delta={-8}
          deltaInverted
          tone="good"
          hint="↓ 8% vs 30 derniers jours"
        />
        <StatCard
          label="Revenu attribué"
          value="12 480 €"
          delta={27}
          tone="good"
          hint="ROAS 9,5× — bon"
        />
      </div>

      {/* 3. Campaigns list */}
      <div className="space-y-4">
        {loading && campaigns.length === 0 && (
          <div className="surface-card p-6 text-sm text-muted-foreground">
            Chargement de vos campagnes…
          </div>
        )}
        {campaigns.map((c) => (
          <CampaignRow
            key={c.id}
            c={c}
            onOptimize={() => handleOptimize(c)}
            onPause={() =>
              toast.info(
                c.status === "Paused"
                  ? "Campagne déjà en pause"
                  : "Mise en pause demandée"
              )
            }
            onDetails={() => toast.info("Détails de la campagne à venir")}
            onSeeReco={() => setAdvisorOpen(true)}
          />
        ))}
      </div>

      {/* 4. Bottom recommendation card */}
      <RecommendationCard
        tone="emerald"
        icon={<PiggyBank className="h-4 w-4" />}
        title="Vous dépensez 220 € sur une campagne sous-performante. Réallouez vers 'Leads Coaching' qui convertit à 7,08 €."
        reason="Make It peut réallouer automatiquement le budget vers vos meilleurs canaux et réduire le coût par résultat de 12%."
        cta="Réallouer"
        onCta={() => setAdvisorOpen(true)}
      />
    </div>
  );
}
