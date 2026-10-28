"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import { apiPost, apiTry, apiGet, type Wallet } from "@/lib/api-client";
import { toast } from "sonner";
import { Sparkles, Zap, TrendingUp, CalendarClock, Plus, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { RechargeDialog } from "@/components/shared/RechargeDialog";

// Hardcoded packs kept as a fallback (per the task spec) — used only if
// /api/billing/packs fails. The real packs come from the backend.
const FALLBACK: Pack[] = [
  { id: "", name: "500 crédits", credits: 500, priceCents: 900, popular: false },
  { id: "", name: "2000 crédits", credits: 2000, priceCents: 2900, popular: true },
  { id: "", name: "5000 crédits", credits: 5000, priceCents: 5900, popular: false },
  { id: "", name: "10000 crédits", credits: 10000, priceCents: 9900, popular: false },
];

type Pack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  popular?: boolean;
};

export function CreditMeter({ compact = false }: { compact?: boolean }) {
  const { creditsTotal, creditsUsed, setCreditsOpen, wallet } = useAppStore();
  // Local RechargeDialog state for the full card's "Acheter des crédits" button.
  // The compact pill uses the global `setCreditsOpen(true)` chain
  // (AppShell → CreditPopover → RechargeDialog).
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const remaining = wallet
    ? wallet.available
    : Math.max(0, creditsTotal - creditsUsed);
  const total = wallet
    ? (wallet.subscriptionCredits ?? 0) + (wallet.purchasedCredits ?? 0)
    : creditsTotal;
  const used = wallet ? (wallet.totalConsumed ?? 0) + (wallet.reservedCredits ?? 0) : creditsUsed;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const renewalInDays = wallet?.renewalInDays ?? 18;

  if (compact) {
    return (
      <button
        onClick={() => setCreditsOpen(true)}
        className="group inline-flex items-center gap-2 rounded-full border border-border bg-card pl-2 pr-3 py-1.5 text-sm shadow-sm hover:shadow-md transition-shadow"
        aria-label="Voir mes crédits IA"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="font-semibold tabular-nums">{remaining.toLocaleString("fr-FR")}</span>
        <span className="text-muted-foreground">crédits</span>
      </button>
    );
  }

  return (
    <>
    <div className="surface-card p-4 w-full max-w-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Crédits IA</p>
            <p className="text-xs text-muted-foreground">Consommation du cycle</p>
          </div>
        </div>
        <span className="text-sm font-semibold tabular-nums">{remaining.toLocaleString("fr-FR")} / {total.toLocaleString("fr-FR")}</span>
      </div>
      <div className="mt-3">
        <Progress value={pct} className="h-2" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Utilisés" value={used.toLocaleString("fr-FR")} icon={<Zap className="h-3 w-3" />} />
        <Stat label="Restants" value={remaining.toLocaleString("fr-FR")} icon={<TrendingUp className="h-3 w-3" />} />
        <Stat label="Renouvel." value={`${renewalInDays} j`} icon={<CalendarClock className="h-3 w-3" />} />
      </div>
      <button
        onClick={() => setRechargeOpen(true)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[color:var(--ink)] px-3 py-2 text-sm font-medium text-[color:var(--primary-foreground)] hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> Acheter des crédits
      </button>
    </div>
    <RechargeDialog open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/60 p-2">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Re-exported for backward compat (existing imports from @/components/shared/CreditMeter).
export const CREDIT_PACKS = FALLBACK.map((p) => ({
  credits: p.credits,
  price: `${(p.priceCents / 100).toLocaleString("fr-FR", { minimumFractionDigits: p.priceCents % 100 === 0 ? 0 : 2 })} €`,
  popular: !!p.popular,
}));

export function CreditBuyCard({ className }: { className?: string }) {
  const { addCredits } = useAppStore();
  const { refreshWallet } = useAuth();
  const [packs, setPacks] = useState<Pack[]>(FALLBACK);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await apiTry(
        async () => {
          const res = await apiGet<{ packs: Pack[] }>("/api/billing/packs");
          return res.packs && res.packs.length > 0 ? res.packs : FALLBACK;
        },
        FALLBACK as Pack[]
      );
      if (!cancelled) setPacks(list);
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  async function buy(p: Pack) {
    if (busyId) return;
    const busyKey = p.id || `fallback-${p.credits}`;
    setBusyId(busyKey);
    try {
      await apiPost<{ newBalance: number }>("/api/credits/buy", {
        packId: p.id || undefined,
        credits: p.id ? undefined : p.credits,
        amountCents: p.priceCents,
        provider: "card",
      });
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
      setBusyId(null);
    }
  }

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {packs.map((p) => {
        const priceLabel = (p.priceCents / 100).toLocaleString("fr-FR", {
          minimumFractionDigits: p.priceCents % 100 === 0 ? 0 : 2,
        });
        const isBusy = busyId === (p.id || `fallback-${p.credits}`);
        return (
          <div
            key={p.id || p.credits}
            className={cn(
              "relative rounded-xl border p-4 transition-shadow hover:shadow-sm",
              p.popular ? "border-[color:var(--emerald-accent)] bg-[color:var(--accent)]/40" : "border-border bg-card"
            )}
          >
            {p.popular && (
              <span className="absolute right-3 top-3 rounded-full bg-[color:var(--emerald-accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                Populaire
              </span>
            )}
            <p className="text-2xl font-semibold tracking-tight">{p.credits.toLocaleString("fr-FR")}</p>
            <p className="text-xs text-muted-foreground">crédits IA</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-lg font-semibold">{priceLabel} €</span>
              <button
                onClick={() => buy(p)}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-sm font-medium text-[color:var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
              >
                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {isBusy ? "Achat…" : "Ajouter"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type { Pack };
export type { Wallet };
