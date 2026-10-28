"use client";

// Make It — Unified RechargeDialog
//
// A single modal used EVERYWHERE credits are recharged. Combines:
//  1. "Acheter" — the 4 credit packs (500/9€, 2000/29€ Populaire, 5000/59€,
//     10000/99€) fetched from `GET /api/billing/packs` with a hardcoded fallback.
//     On "Ajouter": calls `POST /api/credits/buy` (solo scope) or
//     `POST /api/agency/credits/recharge` (agency scope) based on the `scope` prop.
//  2. "Gagner gratuitement" — the referral program. Reads `GET /api/referral`
//     for the referral code + stats. Degrades gracefully (loading / "bientôt
//     disponible") if the referral backend (built by REFERRAL-REBUILD) is not
//     ready yet — never crashes.
//
// Wallet summary at top: "Crédits IA" + progress bar + 3 stats (Utilisés /
// Restants / Renouvel.) from the store `wallet`.
//
// Props:
//   { open: boolean; onClose: () => void; scope?: "solo" | "agency" }
// `scope="solo"` (default) → title "Vos crédits IA", calls `/api/credits/buy`.
// `scope="agency"` → title "Crédits IA — Agence", calls `/api/agency/credits/recharge`.
// Auto-detect from `useAppStore().mode === "agency"` when scope not explicit.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  X,
  Zap,
  TrendingUp,
  CalendarClock,
  Plus,
  Loader2,
  Check,
  Gift,
  Copy,
  Share2,
  ExternalLink,
  MousePointerClick,
  UserPlus,
  CreditCard as CreditCardIcon,
  Coins,
  ArrowUpRight,
} from "lucide-react";

import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import { apiGet, apiPost, apiTry, type Wallet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/* ───────────────────────────── Types ───────────────────────────── */

type Pack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  active?: boolean;
  popular?: boolean;
};

// Hardcoded packs — used only if /api/billing/packs fails. The real packs
// come from the backend.
const FALLBACK_PACKS: Pack[] = [
  { id: "", name: "500 crédits", credits: 500, priceCents: 900, popular: false },
  { id: "", name: "2000 crédits", credits: 2000, priceCents: 2900, popular: true },
  { id: "", name: "5000 crédits", credits: 5000, priceCents: 5900, popular: false },
  { id: "", name: "10000 crédits", credits: 10000, priceCents: 9900, popular: false },
];

// Referral stats shape — what GET /api/referral returns (per REFERRAL-REBUILD
// spec). `null` until the endpoint is ready.
type ReferralStats = {
  code: string;
  clicks: number;
  signups: number;
  conversions: number;
  creditsEarned: number;
};

/* ───────────────────────────── Component ───────────────────────────── */

export function RechargeDialog({
  open,
  onClose,
  scope,
}: {
  open: boolean;
  onClose: () => void;
  scope?: "solo" | "agency";
}) {
  const store = useAppStore();
  // Auto-detect: if `scope` is omitted, infer from the store `mode`.
  const resolvedScope: "solo" | "agency" =
    scope ?? (store.mode === "agency" ? "agency" : "solo");

  const title =
    resolvedScope === "agency" ? "Crédits IA — Agence" : "Vos crédits IA";

  // Body-scroll lock + Esc-to-close when open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-lg max-h-[92vh] overflow-y-auto scroll-premium rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl animate-float-up">
        <Header title={title} subtitle="Suivez votre consommation et rechargez votre solde." onClose={onClose} />

        <div className="px-4 pb-5 sm:px-5">
          {/* Wallet summary */}
          <WalletSummary />

          {/* Tabs */}
          <Tabs defaultValue="buy" className="mt-5">
            <TabsList className="grid w-full grid-cols-2 h-10">
              <TabsTrigger value="buy" className="gap-1.5 text-sm">
                <Plus className="h-3.5 w-3.5" />
                Acheter
              </TabsTrigger>
              <TabsTrigger value="earn" className="gap-1.5 text-sm">
                <Gift className="h-3.5 w-3.5" />
                Gagner gratuitement
              </TabsTrigger>
            </TabsList>

            <TabsContent value="buy" className="mt-4">
              <BuyPanel scope={resolvedScope} />
            </TabsContent>

            <TabsContent value="earn" className="mt-4">
              <EarnPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Header ───────────────────────────── */

function Header({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold leading-tight sm:text-lg">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty sm:text-sm">
            {subtitle}
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Fermer"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ───────────────────────────── Wallet summary ───────────────────────────── */

function WalletSummary() {
  const { wallet, creditsTotal, creditsUsed } = useAppStore();

  const remaining = wallet
    ? wallet.available
    : Math.max(0, creditsTotal - creditsUsed);
  const total = wallet
    ? (wallet.subscriptionCredits ?? 0) + (wallet.purchasedCredits ?? 0)
    : creditsTotal;
  const used = wallet
    ? (wallet.totalConsumed ?? 0) + (wallet.reservedCredits ?? 0)
    : creditsUsed;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const renewalInDays = wallet?.renewalInDays ?? 18;

  return (
    <div className="surface-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Crédits IA</p>
            <p className="text-[11px] text-muted-foreground">Consommation du cycle</p>
          </div>
        </div>
        <p className="text-sm font-semibold tabular-nums">
          {remaining.toLocaleString("fr-FR")} /{" "}
          {total.toLocaleString("fr-FR")}
        </p>
      </div>
      <div className="mt-3">
        <Progress value={pct} className="h-2" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <WalletStat
          label="Utilisés"
          value={used.toLocaleString("fr-FR")}
          icon={<Zap className="h-3 w-3" />}
          tone="amber"
        />
        <WalletStat
          label="Restants"
          value={remaining.toLocaleString("fr-FR")}
          icon={<TrendingUp className="h-3 w-3" />}
          tone="emerald"
        />
        <WalletStat
          label="Renouvel."
          value={`${renewalInDays} j`}
          icon={<CalendarClock className="h-3 w-3" />}
          tone="violet"
        />
      </div>
    </div>
  );
}

function WalletStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "emerald" | "amber" | "violet";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-[color:var(--emerald-accent)]"
      : tone === "amber"
        ? "text-[color:var(--amber-accent)]"
        : "text-[color:var(--violet-accent)]";
  return (
    <div className="rounded-lg bg-muted/60 p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/* ───────────────────────────── Buy panel ───────────────────────────── */

function BuyPanel({ scope }: { scope: "solo" | "agency" }) {
  const { addCredits } = useAppStore();
  const { refreshWallet } = useAuth();
  const [packs, setPacks] = useState<Pack[]>(FALLBACK_PACKS);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await apiTry(
        async () => {
          const res = await apiGet<{ packs: Pack[] }>("/api/billing/packs");
          return res?.packs && res.packs.length > 0 ? res.packs : FALLBACK_PACKS;
        },
        FALLBACK_PACKS as Pack[]
      );
      if (!cancelled) {
        setPacks(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function buy(p: Pack) {
    if (busyKey) return;
    const key = p.id || `fallback-${p.credits}`;
    setBusyKey(key);
    try {
      if (scope === "agency") {
        await apiPost<{ available: number }>(
          "/api/agency/credits/recharge",
          {
            packId: p.id || undefined,
            credits: p.credits,
            amountCents: p.priceCents,
            provider: "card",
          }
        );
      } else {
        await apiPost<{ newBalance: number }>("/api/credits/buy", {
          packId: p.id || undefined,
          credits: p.id ? undefined : p.credits,
          amountCents: p.priceCents,
          provider: "card",
        });
      }
      // Optimistically bump the local counter + refresh the real wallet.
      addCredits(p.credits);
      await refreshWallet();
      toast.success("Crédits ajoutés", {
        description: `${p.credits.toLocaleString("fr-FR")} crédits IA ajoutés à votre solde.`,
      });
    } catch (e) {
      toast.error("Achat impossible", {
        description: e instanceof Error ? e.message : "Réessayez plus tard.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="surface-soft h-32 animate-pulse rounded-xl"
            aria-hidden
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Besoin de plus de puissance ?</h3>
        <p className="text-xs text-muted-foreground">
          Les crédits achetés s&apos;ajouteront à votre solde
          {scope === "agency" ? " — partagé avec toute l&apos;agence." : "."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {packs.map((p) => {
          const priceLabel = (p.priceCents / 100).toLocaleString("fr-FR", {
            minimumFractionDigits: p.priceCents % 100 === 0 ? 0 : 2,
          });
          const isBusy = busyKey === (p.id || `fallback-${p.credits}`);
          return (
            <div
              key={p.id || p.credits}
              className={cn(
                "relative rounded-xl border p-4 transition-shadow hover:shadow-sm",
                p.popular
                  ? "border-[color:var(--emerald-accent)] bg-[color:var(--accent)]/40"
                  : "border-border bg-card"
              )}
            >
              {p.popular && (
                <span className="absolute right-3 top-3 rounded-full bg-[color:var(--emerald-accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                  Populaire
                </span>
              )}
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {p.credits.toLocaleString("fr-FR")}
              </p>
              <p className="text-xs text-muted-foreground">crédits IA</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-lg font-semibold">{priceLabel} €</span>
                <button
                  onClick={() => buy(p)}
                  disabled={isBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[color:var(--ink)] px-3 text-sm font-medium text-[color:var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
                >
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {isBusy ? "Achat…" : "Ajouter"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── Earn panel (referral) ───────────────────────────── */

function EarnPanel() {
  const { setActiveSection } = useAppStore();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Always degrade gracefully — `apiTry` will surface a toast but won't
      // throw, and we pass `null` as the fallback so the panel can render
      // the "bientôt disponible" state.
      const data = await apiTry(
        async () => {
          const res = await apiGet<{ stats?: ReferralStats; code?: string; clicks?: number; signups?: number; conversions?: number; creditsEarned?: number }>(
            "/api/referral"
          );
          // Support both `res.stats` shape and a flat shape.
          if (res?.stats && res.stats.code) return res.stats as ReferralStats;
          if (res?.code) {
            return {
              code: res.code,
              clicks: res.clicks ?? 0,
              signups: res.signups ?? 0,
              conversions: res.conversions ?? 0,
              creditsEarned: res.creditsEarned ?? 0,
            } as ReferralStats;
          }
          // No code → treat as "not ready".
          throw new Error("Referral endpoint returned no code");
        },
        null as ReferralStats | null
      );
      if (cancelled) return;
      if (data) {
        setStats(data);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const referralLink = useMemo(() => {
    if (!stats?.code) return "";
    if (typeof window === "undefined") return `https://makeit.app/ref/${stats.code}`;
    return `${window.location.origin}/ref/${stats.code}`;
  }, [stats?.code]);

  async function copyLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Lien copié", {
        description: "Partagez-le avec vos amis pour gagner des crédits.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie impossible", {
        description: "Copiez le lien manuellement.",
      });
    }
  }

  function shareWhatsApp() {
    if (!referralLink) return;
    const text = encodeURIComponent(
      "Découvre Make It — l'IA qui gère ton marketing. En t'inscrivant via mon lien, je gagne des crédits 🎁"
    );
    const url = encodeURIComponent(referralLink);
    window.open(
      `https://wa.me/?text=${text}%20${url}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // Loading state — the backend may be slow / not ready yet.
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="surface-soft h-24 animate-pulse rounded-xl" aria-hidden />
        <div className="surface-soft h-16 animate-pulse rounded-xl" aria-hidden />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="surface-soft h-20 animate-pulse rounded-xl"
              aria-hidden
            />
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Chargement du parrainage…
        </p>
      </div>
    );
  }

  // Degraded state — the referral backend (REFERRAL-REBUILD) is not ready yet.
  if (failed || !stats) {
    return (
      <div className="space-y-4">
        <ValuePropCard />
        <div className="surface-soft flex flex-col items-center gap-2 rounded-xl p-6 text-center">
          <Gift className="h-8 w-8 text-[color:var(--violet-accent)]" />
          <p className="text-sm font-semibold">Le parrainage sera bientôt disponible</p>
          <p className="max-w-sm text-xs text-muted-foreground text-pretty">
            Nous finalisons le programme de parrainage. Revenez bientôt pour
            inviter vos amis et gagner jusqu&apos;à 500 crédits par abonnement.
          </p>
        </div>
        <HowItWorks />
      </div>
    );
  }

  // Ready state — full referral UI.
  return (
    <div className="space-y-4">
      <ValuePropCard />

      {/* Referral link with Copy + Share (WhatsApp) */}
      <div className="surface-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Votre lien de parrainage
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="flex-1 truncate text-xs text-foreground">
            {referralLink}
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={copyLink}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[color:var(--ink)] px-3 text-sm font-medium text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            {copied ? (
              <Check className="h-4 w-4 text-[color:var(--emerald-accent)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copié !" : "Copier le lien"}
          </button>
          <button
            onClick={shareWhatsApp}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--emerald-accent)] bg-[color:var(--emerald-accent)]/10 px-3 text-sm font-medium text-[color:var(--emerald-accent)] hover:bg-[color:var(--emerald-accent)]/20"
          >
            <Share2 className="h-4 w-4" />
            WhatsApp
          </button>
        </div>
      </div>

      {/* 4 stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReferralStat
          label="Clics"
          value={stats.clicks ?? 0}
          icon={<MousePointerClick className="h-3.5 w-3.5" />}
          tone="violet"
        />
        <ReferralStat
          label="Inscriptions"
          value={stats.signups ?? 0}
          icon={<UserPlus className="h-3.5 w-3.5" />}
          tone="emerald"
        />
        <ReferralStat
          label="Abonnements"
          value={stats.conversions ?? 0}
          icon={<CreditCardIcon className="h-3.5 w-3.5" />}
          tone="amber"
        />
        <ReferralStat
          label="Crédits gagnés"
          value={stats.creditsEarned ?? 0}
          icon={<Coins className="h-3.5 w-3.5" />}
          tone="emerald"
        />
      </div>

      {/* CTA → settings */}
      <button
        onClick={() => setActiveSection("settings")}
        className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
      >
        Voir le tableau de bord parrainage
        <ExternalLink className="h-3.5 w-3.5" />
      </button>

      <HowItWorks />
    </div>
  );
}

function ValuePropCard() {
  return (
    <div className="surface-accent p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--violet-accent)] text-white">
          <Gift className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight">
            Invitez vos amis.
          </p>
          <p className="mt-1 text-xs text-pretty">
            <strong className="font-semibold">30 crédits</strong> par inscription,{" "}
            <strong className="font-semibold">500 crédits</strong> par
            abonnement. Sans limite.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReferralStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "emerald" | "amber" | "violet";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-[color:var(--emerald-accent)]"
      : tone === "amber"
        ? "text-[color:var(--amber-accent)]"
        : "text-[color:var(--violet-accent)]";
  return (
    <div className="surface-card p-3 text-center">
      <div
        className={cn(
          "mx-auto inline-flex h-7 w-7 items-center justify-center rounded-lg bg-muted",
          toneClass
        )}
      >
        {icon}
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums">
        {value.toLocaleString("fr-FR")}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: <Share2 className="h-4 w-4" />,
      title: "Partagez votre lien",
      body: "Envoyez votre lien à vos amis par WhatsApp, email ou sur les réseaux.",
    },
    {
      icon: <UserPlus className="h-4 w-4" />,
      title: "Ils s'inscrivent",
      body: "Dès qu'un ami crée son compte, vous recevez 30 crédits IA.",
    },
    {
      icon: <ArrowUpRight className="h-4 w-4" />,
      title: "Ils s'abonnent",
      body: "Quand un ami souscrit à un plan, vous gagnez 500 crédits IA.",
    },
  ];
  return (
    <div className="surface-soft p-4">
      <p className="text-sm font-semibold">Comment ça marche ?</p>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--violet-accent)] text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground text-pretty">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export type { Pack, ReferralStats, Wallet };
