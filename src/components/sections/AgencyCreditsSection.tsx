"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CreditCard,
  Wallet,
  Users,
  Building2,
  Sparkles,
  ArrowUpRight,
  TrendingUp,
  Plus,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

import { apiGet, apiPost, apiPatch, apiTry } from "@/lib/api-client";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { RechargeDialog as UnifiedRechargeDialog } from "@/components/shared/RechargeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Types ───────────────────────────── */

type WalletView = {
  agencyId: string;
  totalCredits: number;
  reservedCredits: number;
  totalConsumed: number;
  available: number;
  mode: "pool" | "quotas";
};

type AllocationNode = {
  id: string;
  scope: "manager" | "client" | "creative";
  quota: number;
  consumed: number;
  remaining: number; // Infinity if quota === 0
  periodStart: string;
  periodEnd: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  agencyClientId: string | null;
  clientName: string | null;
  children?: AllocationNode[];
};

type AllocationsTree = {
  managers: AllocationNode[];
  directClients: AllocationNode[];
  creatives: AllocationNode[];
};

type ConsumptionBucket = {
  label: string;
  byClient: { clientId: string; clientName: string; consumed: number }[];
  byManager: { managerId: string; managerName: string; consumed: number }[];
  byCreative: { creativeId: string; creativeName: string; consumed: number }[];
  total: number;
};

type CreditsResponse = {
  wallet: WalletView;
  allocations: AllocationsTree;
};

type Transaction = {
  id: string;
  type: string;
  operation: string | null;
  amount: number;
  note: string | null;
  createdAt: string;
};

/* ───────────────────────────── Section ───────────────────────────── */

export function AgencyCreditsSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [breakdown, setBreakdown] = useState<ConsumptionBucket | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);

  const reload = async () => {
    const [credits, bdown, txs] = await Promise.all([
      apiTry(async () => apiGet<CreditsResponse>("/api/agency/credits"), null),
      apiTry(async () => apiGet<ConsumptionBucket>("/api/agency/credits/consumption?sinceDays=30"), null),
      apiTry(async () => apiGet<{ items: Transaction[] }>("/api/credits/transactions?limit=20").then((r) => r.items ?? []), [] as Transaction[]),
    ]);
    if (credits) setData(credits);
    if (bdown) setBreakdown(bdown);
    setTransactions(txs);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
     
  }, []);

  const wallet = data?.wallet;
  const allocations = data?.allocations;
  const isAdmin = true; // P2 will surface the actual role; assume admin for demo

  const handleToggleMode = async (checked: boolean) => {
    if (!wallet) return;
    const newMode = checked ? "quotas" : "pool";
    setModeSwitching(true);
    try {
      await apiPatch("/api/agency/credits", { mode: newMode });
      toast.success(`Mode ${newMode === "pool" ? "Pool" : "Quotas"} activé`);
      void reload();
    } catch (e) {
      toast.error("Échec du changement de mode", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setModeSwitching(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Make It for Agencies"
        title="💳 Crédits Agence"
        description="Gérez votre pool de crédits et répartissez-les entre vos collaborateurs."
        actions={
          <Button
            className="h-11 gap-1.5"
            disabled={!isAdmin}
            onClick={() => setRechargeOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Recharger
          </Button>
        }
      />

      {/* Unified RechargeDialog (agency scope) */}
      <UnifiedRechargeDialog
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        scope="agency"
      />

      {/* Wallet card + mode toggle */}
      {loading || !wallet ? (
        <Skeleton className="h-44 w-full rounded-2xl" />
      ) : (
        <div className="surface-hero grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-[color:var(--primary-foreground)]">
              <Wallet className="h-5 w-5" />
              <span className="text-sm font-medium uppercase tracking-wide">
                Solde disponible
              </span>
            </div>
            <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums text-[color:var(--primary-foreground)]">
              {wallet.available.toLocaleString("fr-FR")}
            </p>
            <p className="mt-1 text-sm text-[color:var(--primary-foreground)]/80">
              crédits utilisables maintenant
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <WalletStat label="Total crédits" value={wallet.totalCredits} />
              <WalletStat label="Réservés" value={wallet.reservedCredits} />
              <WalletStat label="Consommés" value={wallet.totalConsumed} />
            </div>
          </div>
          <div className="surface-card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Mode de distribution
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {wallet.mode === "pool" ? "Pool commun" : "Quotas par collaborateur"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Pool</span>
                <Switch
                  checked={wallet.mode === "quotas"}
                  onCheckedChange={handleToggleMode}
                  disabled={modeSwitching || !isAdmin}
                />
                <span className="text-xs text-muted-foreground">Quotas</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-pretty">
              {wallet.mode === "pool"
                ? "Tous les collaborateurs puisent dans le pool commun. Aucune limite individuelle."
                : "Chaque manager/client/creative dispose d'un quota mensuel. La consommation est plafonnée."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-9 self-start"
              onClick={() => setRechargeOpen(true)}
              disabled={!isAdmin}
            >
              <Plus className="h-3.5 w-3.5" /> Recharger le pool
            </Button>
          </div>
        </div>
      )}

      {/* Mode-specific content */}
      {wallet?.mode === "pool" ? (
        <PoolModeContent breakdown={breakdown} loading={loading} />
      ) : (
        <QuotasModeContent
          allocations={allocations ?? null}
          loading={loading}
          onChange={() => void reload()}
          isAdmin={isAdmin}
        />
      )}

      {/* Recent transactions */}
      <div className="surface-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Transactions récentes</h3>
            <p className="text-xs text-muted-foreground">
              20 dernières opérations sur le workspace actif.
            </p>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : transactions.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Aucune transaction récente.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto scroll-premium">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Opération</th>
                  <th className="px-2 py-2 text-right font-medium">Montant</th>
                  <th className="px-2 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-t border-border/60">
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {t.type}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-xs">{t.operation ?? "—"}</td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono text-xs tabular-nums",
                        t.amount < 0 ? "text-rose-600" : "text-emerald-600"
                      )}
                    >
                      {t.amount > 0 ? "+" : ""}
                      {t.amount}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{t.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Pool mode ───────────────────────────── */

function PoolModeContent({
  breakdown,
  loading,
}: {
  breakdown: ConsumptionBucket | null;
  loading: boolean;
}) {
  if (loading || !breakdown) {
    return <Skeleton className="h-72 w-full rounded-2xl" />;
  }
  const chartData = [
    {
      label: "Par client",
      items: breakdown.byClient.map((c) => ({ name: c.clientName, value: c.consumed })),
      color: "oklch(0.55 0.22 290)",
    },
    {
      label: "Par manager",
      items: breakdown.byManager.map((m) => ({ name: m.managerName, value: m.consumed })),
      color: "oklch(0.55 0.13 165)",
    },
    {
      label: "Par creative",
      items: breakdown.byCreative.map((c) => ({ name: c.creativeName, value: c.consumed })),
      color: "oklch(0.72 0.16 70)",
    },
  ];
  return (
    <div className="surface-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[color:var(--emerald-accent)]" />
        <h3 className="text-sm font-semibold">Consommation sur 30 jours</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground text-pretty">
        Tous les collaborateurs puisent dans le pool commun. Voici la répartition
        de la consommation par client, manager et creative.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {chartData.map((chart) => (
          <div key={chart.label} className="surface-soft rounded-xl p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {chart.label}
            </p>
            {chart.items.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground/60">
                Aucune consommation
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chart.items} layout="vertical" margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0.93 0.004 120)" />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="oklch(0.5 0.01 120)" />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} stroke="oklch(0.5 0.01 120)" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid oklch(0.93 0.004 120)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" fill={chart.color} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── Quotas mode ───────────────────────────── */

function QuotasModeContent({
  allocations,
  loading,
  onChange,
  isAdmin,
}: {
  allocations: AllocationsTree | null;
  loading: boolean;
  onChange: () => void;
  isAdmin: boolean;
}) {
  if (loading || !allocations) {
    return <Skeleton className="h-72 w-full rounded-2xl" />;
  }
  const hasAny =
    allocations.managers.length > 0 ||
    allocations.directClients.length > 0 ||
    allocations.creatives.length > 0;

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[color:var(--emerald-accent)]" />
        <h3 className="text-sm font-semibold">Arbre d'allocation</h3>
      </div>
      {!hasAny ? (
        <div className="py-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">Aucune allocation</p>
          <p className="mt-1 text-xs text-muted-foreground text-pretty">
            Allouez des quotas à vos managers pour limiter leur consommation mensuelle.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {allocations.managers.map((m) => (
            <ManagerAllocationRow key={m.id} node={m} onChange={onChange} isAdmin={isAdmin} />
          ))}
          {allocations.directClients.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Clients directs (alloués par l'agence)
              </p>
              <div className="space-y-2">
                {allocations.directClients.map((c) => (
                  <AllocationRow key={c.id} node={c} onChange={onChange} isAdmin={isAdmin} />
                ))}
              </div>
            </div>
          )}
          {allocations.creatives.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Creatives directs
              </p>
              <div className="space-y-2">
                {allocations.creatives.map((c) => (
                  <AllocationRow key={c.id} node={c} onChange={onChange} isAdmin={isAdmin} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManagerAllocationRow({
  node,
  onChange,
  isAdmin,
}: {
  node: AllocationNode;
  onChange: () => void;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pct = node.quota === 0 ? 0 : Math.min(100, (node.consumed / node.quota) * 100);
  const nearLimit = node.quota > 0 && pct >= 80;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="surface-soft rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-3 text-left"
            aria-expanded={open}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--ink)] text-xs font-semibold text-[color:var(--primary-foreground)]">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {node.userName ?? node.userEmail ?? "Manager"}
              </p>
              <p className="text-xs text-muted-foreground">
                {node.consumed} / {node.quota === 0 ? "∞" : node.quota} crédits
                {node.children && node.children.length > 0 && (
                  <> · {node.children.length} sous-allocation(s)</>
                )}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {nearLimit && (
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                Quota near limit
              </Badge>
            )}
            <AllocateButton
              scope="manager"
              userId={node.userId}
              agencyClientId={null}
              currentQuota={node.quota}
              onChange={onChange}
              isAdmin={isAdmin}
            />
          </div>
        </div>
        {node.quota > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
            <div
              className={cn(
                "h-full rounded-full",
                nearLimit ? "bg-amber-500" : "bg-[color:var(--ink)]"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {node.children && node.children.length > 0 && (
          <CollapsibleContent>
            <div className="mt-3 space-y-2 border-l-2 border-border pl-3">
              {node.children.map((child) => (
                <AllocationRow key={child.id} node={child} onChange={onChange} isAdmin={isAdmin} />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

function AllocationRow({
  node,
  onChange,
  isAdmin,
}: {
  node: AllocationNode;
  onChange: () => void;
  isAdmin: boolean;
}) {
  const pct = node.quota === 0 ? 0 : Math.min(100, (node.consumed / node.quota) * 100);
  const nearLimit = node.quota > 0 && pct >= 80;
  const label =
    node.scope === "client"
      ? node.clientName ?? "Client"
      : node.userName ?? node.userEmail ?? "Creative";
  return (
    <div className="surface-soft rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/5 text-xs font-semibold">
            {node.scope === "client" ? (
              <Building2 className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {node.consumed} / {node.quota === 0 ? "∞" : node.quota} crédits
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nearLimit && (
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
              <TrendingUp className="h-3 w-3" /> Ajuster
            </Badge>
          )}
          <AllocateButton
            scope={node.scope}
            userId={node.userId}
            agencyClientId={node.agencyClientId}
            currentQuota={node.quota}
            onChange={onChange}
            isAdmin={isAdmin}
          />
        </div>
      </div>
      {node.quota > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
          <div
            className={cn(
              "h-full rounded-full",
              nearLimit ? "bg-amber-500" : "bg-[color:var(--ink)]"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function AllocateButton({
  scope,
  userId,
  agencyClientId,
  currentQuota,
  onChange,
  isAdmin,
}: {
  scope: "manager" | "client" | "creative";
  userId: string | null;
  agencyClientId: string | null;
  currentQuota: number;
  onChange: () => void;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState(String(currentQuota));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const q = Number.parseInt(quota, 10);
    if (!Number.isFinite(q) || q < 0) {
      toast.error("Quota invalide");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/agency/credits/allocate", {
        scope,
        userId,
        agencyClientId,
        quota: q,
      });
      toast.success("Quota mis à jour");
      setOpen(false);
      onChange();
    } catch (e) {
      toast.error("Échec de l'allocation", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9" disabled={!isAdmin}>
          Allouer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Allouer un quota</DialogTitle>
          <DialogDescription>
            0 = illimité. Le quota est mensuel (réinitialisé chaque début de mois).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="alloc-quota">Quota (crédits / mois)</Label>
          <Input
            id="alloc-quota"
            type="number"
            min={0}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            className="h-11"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="h-11">
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── Recharge dialog ───────────────────────────── */

function RechargeDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [credits, setCredits] = useState("1000");
  const [amountCents, setAmountCents] = useState("10000");
  const [provider, setProvider] = useState("stripe");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const c = Number.parseInt(credits, 10);
    const a = Number.parseInt(amountCents, 10);
    if (!Number.isFinite(c) || c <= 0) return toast.error("Crédits invalides");
    if (!Number.isFinite(a) || a < 0) return toast.error("Montant invalide");
    setSubmitting(true);
    try {
      await apiPost("/api/agency/credits/recharge", {
        credits: c,
        amountCents: a,
        provider,
      });
      toast.success("Recharge effectuée", {
        description: `${c.toLocaleString("fr-FR")} crédits ajoutés au pool.`,
      });
      onDone();
    } catch (e) {
      toast.error("Recharge échouée", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
      void onClose;
    }
  };

  const presets = [
    { credits: 1000, amount: 10000 },
    { credits: 5000, amount: 45000 },
    { credits: 10000, amount: 80000 },
  ];

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Recharger le pool de crédits</DialogTitle>
        <DialogDescription>
          Achetez des crédits IA pour toute l'agence. Le montant est en centimes (10000 = 100 €).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p) => (
            <button
              key={p.credits}
              type="button"
              onClick={() => {
                setCredits(String(p.credits));
                setAmountCents(String(p.amount));
              }}
              className="surface-soft rounded-lg p-2 text-center text-xs hover:bg-foreground/5"
            >
              <p className="font-semibold tabular-nums">
                {p.credits.toLocaleString("fr-FR")}
              </p>
              <p className="text-muted-foreground">
                {(p.amount / 100).toLocaleString("fr-FR")} €
              </p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rech-credits">Crédits</Label>
            <Input
              id="rech-credits"
              type="number"
              min={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rech-amount">Montant (centimes)</Label>
            <Input
              id="rech-amount"
              type="number"
              min={0}
              value={amountCents}
              onChange={(e) => setAmountCents(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rech-provider">Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="rech-provider" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="mobile_money">Mobile Money</SelectItem>
              <SelectItem value="bank_transfer">Virement</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSubmit} disabled={submitting} className="h-11">
          {submitting ? "Recharge…" : "Recharger"}
          <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ───────────────────────────── Bits ───────────────────────────── */

function WalletStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card rounded-lg p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">
        {value.toLocaleString("fr-FR")}
      </p>
    </div>
  );
}

// Suppress unused warning for icons imported but only used in conditional branches.
void CreditCard;
void Legend;
