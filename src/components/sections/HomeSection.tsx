"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CircleDot,
  Lightbulb,
  Megaphone,
  Pause,
  PlayCircle,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import { useAppStore, type SectionKey } from "@/store/app-store";
import {
  makeItScore as mockScore,
  weeklyPriority as mockPriority,
  nlPrompts,
  quickActions,
} from "@/lib/mock-data";
import { apiGet, apiTry } from "@/lib/api-client";
import { AIBadge, MakeItMark } from "@/components/shared/AIBadge";
import { MiniScore, ScoreRing } from "@/components/shared/ScoreRing";
import { ProgressTracker } from "@/components/shared/ProgressTracker";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Home / Dashboard                                                           */
/*  Answers: Où en suis-je ? Qu'est-ce qui fonctionne ? Que dois-je faire ?   */
/* -------------------------------------------------------------------------- */

type ScoreResponse = {
  total: number;
  delta: number;
  subscores: { key: string; label: string; value: number; delta?: number; note?: string }[];
};

type PriorityResponse = {
  items: {
    title: string;
    reason: string;
    cta: string | null;
    impact: number;
    effort: number;
    priorityScore: number;
    category?: string;
    severity?: string;
  }[];
};

type InsightsResponse = {
  insights: {
    id: string;
    category?: string;
    severity?: string;
    explanation?: string;
    recommendation?: string;
    evidence?: string;
    impactScore?: number;
    effortScore?: number;
    expectedImpact?: string | null;
    priorityScore?: number;
  }[];
};

export function HomeSection() {
  const {
    firstName,
    creditsTotal,
    creditsUsed,
    wallet,
    setActiveSection,
    setAdvisorOpen,
    setCreditsOpen,
  } = useAppStore();

  const [prompt, setPrompt] = useState("");
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [priority, setPriority] = useState<PriorityResponse["items"][number] | null>(null);
  const [insights, setInsights] = useState<InsightsResponse["insights"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [scoreRes, prioRes, insightsRes] = await Promise.all([
        apiTry(async () => apiGet<ScoreResponse>("/api/insights/score"), null as ScoreResponse | null),
        apiTry(async () => {
          const r = await apiGet<PriorityResponse>("/api/insights/priority?limit=1");
          return r.items?.[0] ?? null;
        }, null as PriorityResponse["items"][number] | null),
        apiTry(async () => {
          const r = await apiGet<InsightsResponse>("/api/insights");
          return (r.insights ?? []).slice(0, 3);
        }, [] as InsightsResponse["insights"]),
      ]);
      if (cancelled) return;
      // Always fall back to mocks when the API returned nothing.
      setScore(scoreRes ?? (mockScore as unknown as ScoreResponse));
      setPriority(
        prioRes ??
          ({
            title: mockPriority.title,
            reason: mockPriority.recommendation,
            cta: mockPriority.cta,
            impact: 8,
            effort: 5,
            priorityScore: 80,
          } as PriorityResponse["items"][number])
      );
      // Map insights to the same shape the UI expects.
      if (insightsRes.length > 0) {
        setInsights(insightsRes);
      } else {
        setInsights([
          {
            id: "m1",
            category: "content",
            explanation: "Vues en hausse de +128% sur les vidéos éducatives Instagram et TikTok.",
            recommendation: "En créer un nouveau",
            impactScore: 8,
          },
          {
            id: "m2",
            category: "engagement",
            explanation: "Les posts statiques Instagram perdent 12% d'engagement. Testez un format plus dynamique.",
            recommendation: "Voir le diagnostic",
            impactScore: 5,
          },
          {
            id: "m3",
            category: "conversion",
            explanation: "Les CTA WhatsApp génèrent 23% de leads supplémentaires. Activez-le sur 3 contenus.",
            recommendation: "Activer WhatsApp",
            impactScore: 6,
          },
        ]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  const remaining = wallet ? wallet.available : Math.max(0, creditsTotal - creditsUsed);
  const total = wallet
    ? (wallet.subscriptionCredits ?? 0) + (wallet.purchasedCredits ?? 0)
    : creditsTotal;
  const used = wallet ? (wallet.totalConsumed ?? 0) + (wallet.reservedCredits ?? 0) : creditsUsed;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const renewalInDays = wallet?.renewalInDays ?? 18;

  const handleFaire = () => {
    if (!prompt.trim()) return;
    setActiveSection("create");
  };

  // Map insights to the UI card shape.
  const insightCards: {
    icon: string;
    title: string;
    reason: string;
    cta: string;
    tone: "emerald" | "amber" | "rose" | "violet" | "ink";
    onCta: () => void;
  }[] = insights.slice(0, 3).map((ins, i) => {
    const sev = (ins.severity ?? "").toLowerCase();
    const tone: "emerald" | "amber" | "rose" | "violet" | "ink" =
      sev.includes("critical") || sev.includes("high")
        ? "rose"
        : sev.includes("medium") || sev.includes("warn")
        ? "amber"
        : i === 0
        ? "emerald"
        : i === 2
        ? "violet"
        : "ink";
    const cat = (ins.category ?? "").toLowerCase();
    const icon =
      cat.includes("engagement") || cat.includes("interaction")
        ? "💬"
        : cat.includes("conversion") || cat.includes("sales")
        ? "🎯"
        : cat.includes("visibility") || cat.includes("reach")
        ? "📈"
        : cat.includes("content")
        ? "🎬"
        : cat.includes("growth")
        ? "🌱"
        : "✨";
    const cta =
      ins.recommendation && ins.recommendation.length < 32
        ? ins.recommendation
        : cat.includes("engagement") || cat.includes("content")
        ? "Créer"
        : "Voir le diagnostic";
    return {
      icon,
      title: ins.recommendation?.slice(0, 80) ?? "Recommandation",
      reason: ins.explanation ?? "",
      cta,
      tone,
      onCta: () =>
        cat.includes("planning") ||
        cat.includes("schedule") ||
        (ins.recommendation ?? "").toLowerCase().includes("dimanche")
          ? setActiveSection("planning")
          : cat.includes("campaign")
          ? setActiveSection("campaigns")
          : cat.includes("engagement") || cat.includes("content") || cat.includes("visibility")
          ? setActiveSection("create")
          : setActiveSection("strategy"),
    };
  });

  const scoreValue = score?.total ?? mockScore.total;
  const scoreDelta = score?.delta ?? mockScore.delta;
  const subscores = (score?.subscores ?? mockScore.subscores).slice(0, 5);

  return (
    <div className="space-y-6 animate-float-up">
      {/* 1. HERO ROW ---------------------------------------------------------- */}
      <section className="surface-hero bg-dotted relative overflow-hidden p-6 md:p-8">
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-3">
            <div className="inline-flex items-center gap-2">
              <AIBadge label="Conseiller IA dispo" />
              <MakeItMark className="opacity-80" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
              Bonjour {firstName} 👋
            </h1>
            <p className="text-pretty text-sm text-muted-foreground md:text-base">
              Voici ce qui se passe avec votre présence digitale.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={() => setActiveSection("create")}
                className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" /> Créer du contenu
              </Button>
              <Button
                variant="outline"
                onClick={() => setAdvisorOpen(true)}
                className="h-11"
              >
                <Bot className="h-4 w-4" /> Demander à Make It
              </Button>
            </div>
          </div>

          {/* Compact score ring (desktop only) */}
          <div className="hidden flex-col items-center gap-2 md:flex">
            <div className="surface-card bg-card/70 p-4 backdrop-blur-sm">
              {loading && !score ? (
                <Skeleton className="h-[140px] w-[140px] rounded-full" />
              ) : (
                <ScoreRing value={scoreValue} size={140} label="Make It Score" />
              )}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <ArrowUpRight className="h-3 w-3" /> +{Math.max(0, scoreDelta)} ce mois
            </span>
          </div>
        </div>
      </section>

      {/* 2. MAKE IT SCORE CARD ------------------------------------------------ */}
      <section className="surface-card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-5">
            {loading && !score ? (
              <Skeleton className="h-[180px] w-[180px] rounded-full" />
            ) : (
              <ScoreRing value={scoreValue} size={180} label="/ 100" />
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Make It Score</h2>
                <AIBadge label="IA" />
              </div>
              <p className="text-sm text-muted-foreground text-pretty">
                Votre présence digitale progresse bien.
              </p>
              <button
                onClick={() => setActiveSection("strategy")}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
              >
                Voir le diagnostic <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {loading && !score
            ? Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[84px] rounded-xl" />
              ))
            : subscores.map((s, i) => (
                <MiniScore
                  key={s.key ?? i}
                  value={s.value}
                  label={`${emojiFor(s.key)} ${s.label}`}
                  delta={s.delta ?? 0}
                />
              ))}
        </div>
      </section>

      {/* 3. WEEKLY PRIORITY --------------------------------------------------- */}
      <section className="surface-accent relative overflow-hidden p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-800">
              🎯 Votre priorité
            </p>
            {loading && !priority ? (
              <Skeleton className="h-16 w-full max-w-xl" />
            ) : (
              <>
                <h2 className="text-xl font-semibold tracking-tight text-balance text-emerald-950 md:text-2xl">
                  {priority?.title ?? mockPriority.title}
                </h2>
                <p className="text-sm text-emerald-900/80 text-pretty">
                  {priority?.reason ?? mockPriority.recommendation}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Chip icon={<TrendingUp className="h-3.5 w-3.5" />}>
                    Lift {mockPriority.metrics.lift}
                  </Chip>
                  <Chip icon={<PlayCircle className="h-3.5 w-3.5" />}>
                    Format {mockPriority.metrics.format}
                  </Chip>
                  <Chip icon={<Lightbulb className="h-3.5 w-3.5" />}>
                    {mockPriority.metrics.reason}
                  </Chip>
                </div>
              </>
            )}
          </div>
          <Button
            onClick={() => setActiveSection("create")}
            className="h-11 shrink-0 bg-[color:var(--ink)] px-5 text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" /> {priority?.cta ?? mockPriority.cta}
          </Button>
        </div>
      </section>

      {/* 4. QUICK ACTIONS GRID ------------------------------------------------ */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Actions rapides</h2>
            <p className="text-sm text-muted-foreground">Lancez une action en un tap.</p>
          </div>
          <MakeItMark className="opacity-80" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((a) => (
            <motion.button
              key={a.label}
              type="button"
              whileHover={{ y: -2 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={() => setActiveSection(a.section as SectionKey)}
              className="surface-card flex h-full min-h-[112px] flex-col items-start justify-between gap-3 p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="text-2xl" aria-hidden>
                {a.icon}
              </span>
              <span className="text-sm font-medium leading-tight text-foreground text-balance">
                {a.label}
              </span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* 5. NATURAL LANGUAGE INPUT ------------------------------------------- */}
      <section className="surface-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <label htmlFor="nl-input" className="text-sm font-medium">
            Que voulez-vous faire aujourd'hui ?
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              id="nl-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFaire();
              }}
              placeholder="Ex : Je veux annoncer une nouvelle promotion…"
              className="h-11 pl-10"
              aria-label="Votre intention marketing"
            />
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <Button
            onClick={handleFaire}
            disabled={!prompt.trim()}
            className="h-11 shrink-0 bg-[color:var(--ink)] px-5 text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            Faire <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {nlPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrompt(p)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
            >
              {p}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          ✨ Make It comprend votre intention et oriente vers la meilleure action.
        </p>
      </section>

      {/* 6. TWO-COLUMN ROW ---------------------------------------------------- */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: weekly insights */}
        <div className="surface-card flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Cette semaine en un coup d'œil
              </h2>
              <p className="text-xs text-muted-foreground">
                Ce qui fonctionne et ce qui demande votre attention.
              </p>
            </div>
            <button
              onClick={() => setActiveSection("performance")}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              Voir tout <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))
              : insightCards.map((ins) => (
                  <RecommendationCard key={ins.title} {...ins} />
                ))}
          </div>
        </div>

        {/* RIGHT: Make It is working */}
        <div className="surface-card flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Make It travaille pour vous
              </h2>
              <p className="text-xs text-muted-foreground">
                Progression en temps réel de vos contenus en cours.
              </p>
            </div>
            <MakeItMark />
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <ProgressTracker
              steps={["Analyse", "Concept", "Création", "Optimisation", "Déclinaison"]}
            />
            <p className="mt-3 text-sm text-muted-foreground text-pretty">
              Make It prépare 3 contenus pour cette semaine.
            </p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <Button
              onClick={() => setActiveSection("planning")}
              className="h-10 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              Voir le planning <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdvisorOpen(true)}
              className="h-10"
            >
              <Bot className="h-4 w-4" /> Demander conseil
            </Button>
          </div>
        </div>
      </section>

      {/* 7. BOTTOM ROW: 3 cards ----------------------------------------------- */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Advisor */}
        <div className="surface-card flex flex-col gap-3 p-6">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            <Bot className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold tracking-tight">Conseiller IA</h3>
          <p className="text-sm text-muted-foreground text-pretty">
            Posez une question à Make It sur votre marketing et obtenez une recommandation
            actionnable.
          </p>
          <Button
            onClick={() => setAdvisorOpen(true)}
            className="mt-auto h-10 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            Demander à Make It <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Campaigns */}
        <div className="surface-card flex flex-col gap-3 p-6">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="flex items-end justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">Campagnes</h3>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                <CircleDot className="h-3 w-3" /> 2 actives
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                <Pause className="h-3 w-3" /> 1 en pause
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground text-pretty">
            Votre campagne « Soldes Hiver » performe au-dessus de l'objectif (+18% de portée).
          </p>
          <Button
            onClick={() => setActiveSection("campaigns")}
            className="mt-auto h-10 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            Voir les campagnes <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Credits */}
        <div className="surface-card flex flex-col gap-3 p-6">
          <div className="flex items-center justify-between">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold tabular-nums">
              {remaining.toLocaleString("fr-FR")} / {total.toLocaleString("fr-FR")}
            </span>
          </div>
          <h3 className="text-base font-semibold tracking-tight">Crédits IA</h3>
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground text-pretty">
            {used.toLocaleString("fr-FR")} utilisés ce cycle · Renouvellement dans {renewalInDays} jours.
          </p>
          <Button
            onClick={() => setCreditsOpen(true)}
            className="mt-auto h-10 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            Recharger <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function Chip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200/50">
      {icon}
      {children}
    </span>
  );
}

function emojiFor(key: string): string {
  switch ((key ?? "").toLowerCase()) {
    case "visibility":
    case "reach":
      return "👁️";
    case "engagement":
      return "❤️";
    case "conversion":
    case "sales":
      return "🎯";
    case "regularity":
    case "consistency":
      return "🔥";
    case "brand":
      return "🧬";
    case "growth":
      return "🌱";
    case "content":
      return "🎬";
    default:
      return "✨";
  }
}

// Re-export icons used only inside JSX to avoid unused-import warnings.
void TrendingDown;
