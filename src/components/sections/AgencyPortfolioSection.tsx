"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Search,
  ArrowRight,
  AlertTriangle,
  CalendarClock,
  TrendingUp,
  Users,
} from "lucide-react";

import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { InsightStat } from "@/components/shared/RecommendationCard";
import { ClientColorAvatar } from "@/components/agency/ClientColorBadge";
import { getClientColor } from "@/lib/client-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Types ───────────────────────────── */

type PortfolioClient = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  makeItScore: number;
  scoreDelta: number;
  managerName: string | null;
  upcomingCount: number;
  alertsCount: number;
  lastActivityAt: string | null;
  sector: string | null;
  country: string | null;
  objective: string | null;
};

type PortfolioSummary = {
  totalClients: number;
  activeClients: number;
  avgScore: number;
  totalAlerts: number;
};

type PortfolioResponse = {
  clients: PortfolioClient[];
  summary: PortfolioSummary;
};

/* ───────────────────────────── Helpers ───────────────────────────── */

const STATUS_META: Record<
  PortfolioClient["status"],
  { label: string; chip: string; dot: string }
> = {
  active: {
    label: "Actif",
    chip: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
  },
  paused: {
    label: "En pause",
    chip: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  archived: {
    label: "Archivé",
    chip: "bg-foreground/5 text-muted-foreground",
    dot: "bg-zinc-400",
  },
};

function formatLastActivity(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "Aujourd'hui";
  if (diff < 2 * day) return "Hier";
  if (diff < 7 * day) return `Il y a ${Math.floor(diff / day)} j`;
  if (diff < 30 * day) return `Il y a ${Math.floor(diff / (7 * day))} sem.`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const SECTORS = [
  "Mode",
  "Beauté",
  "Restauration",
  "Artisanat",
  "Tech",
  "Éducation",
  "Santé",
  "Immobilier",
  "Services",
  "Autre",
];

const OBJECTIVES = [
  { value: "notoriety", label: "Notoriété" },
  { value: "engagement", label: "Engagement" },
  { value: "sales", label: "Ventes" },
  { value: "leads", label: "Leads" },
  { value: "traffic", label: "Trafic" },
  { value: "retention", label: "Fidélisation" },
];

type SortKey = "score" | "alerts" | "recent";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score", label: "Score" },
  { value: "alerts", label: "Alertes" },
  { value: "recent", label: "Activité récente" },
];

/* ───────────────────────────── Section ───────────────────────────── */

export function AgencyPortfolioSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [createOpen, setCreateOpen] = useState(false);

  const setActiveClientId = useAppStore((s) => s.setActiveClientId);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  // Load the portfolio.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const portfolio = await apiTry(async () => {
        return await apiGet<PortfolioResponse>("/api/agency/portfolio");
      }, null);
      if (cancelled) return;
      if (portfolio) setData(portfolio);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const managers = useMemo(() => {
    if (!data) return [];
    const set = new Map<string, string>();
    data.clients.forEach((c) => {
      if (c.managerName) set.set(c.managerName, c.managerName);
    });
    return Array.from(set.values());
  }, [data]);

  const sectors = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.clients.forEach((c) => c.sector && set.add(c.sector));
    return Array.from(set.values());
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.clients.filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.managerName ?? "").toLowerCase().includes(q) &&
          !(c.sector ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (sectorFilter !== "all" && c.sector !== sectorFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (managerFilter !== "all" && c.managerName !== managerFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "score") return b.makeItScore - a.makeItScore;
      if (sort === "alerts") return b.alertsCount - a.alertsCount;
      // recent
      const at = (x: PortfolioClient) => (x.lastActivityAt ? new Date(x.lastActivityAt).getTime() : 0);
      return at(b) - at(a);
    });
    return list;
  }, [data, search, sectorFilter, statusFilter, managerFilter, sort]);

  const summary = data?.summary ?? {
    totalClients: 0,
    activeClients: 0,
    avgScore: 0,
    totalAlerts: 0,
  };

  const handleSelectClient = (client: PortfolioClient) => {
    // Switch the active client in the store — P2's ClientSwitcher logic will
    // pick this up. For P3 we also jump to the home section of that client.
    setActiveClientId(client.id);
    toast.success(`Client actif : ${client.name}`, {
      description: "Vous pouvez maintenant travailler sur ce client.",
    });
    void setActiveSection;
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Make It for Agencies"
        title="🏢 Portfolio Agence"
        description="Vue d'ensemble de tous vos clients : scores, alertes, activité récente."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gap-1.5">
                <Plus className="h-4 w-4" />
                Nouveau client
              </Button>
            </DialogTrigger>
            <CreateClientDialog
              onClose={() => setCreateOpen(false)}
              onCreated={() => {
                setCreateOpen(false);
                // Reload portfolio.
                void (async () => {
                  const fresh = await apiGet<PortfolioResponse>("/api/agency/portfolio").catch(() => null);
                  if (fresh) setData(fresh);
                })();
              }}
            />
          </Dialog>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          <>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </>
        ) : (
          <>
            <InsightStat
              label="Total clients"
              value={String(summary.totalClients)}
              hint={`${summary.activeClients} actifs`}
              tone="default"
            />
            <InsightStat
              label="Clients actifs"
              value={String(summary.activeClients)}
              hint={`sur ${summary.totalClients} clients`}
              tone="good"
            />
            <InsightStat
              label="Score moyen"
              value={String(summary.avgScore)}
              hint="Make It Score"
              tone="default"
            />
            <InsightStat
              label="Alertes totales"
              value={String(summary.totalAlerts)}
              hint={summary.totalAlerts > 0 ? "Action requise" : "RAS"}
              tone={summary.totalAlerts > 0 ? "bad" : "good"}
            />
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="surface-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un client, un manager, un secteur…"
            className="h-11 pl-10"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger className="h-11 w-full lg:w-[160px]">
              <SelectValue placeholder="Secteur" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous secteurs</SelectItem>
              {sectors.length === 0 && SECTORS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
              {sectors.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 w-full lg:w-[140px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="active">Actif</SelectItem>
              <SelectItem value="paused">En pause</SelectItem>
              <SelectItem value="archived">Archivé</SelectItem>
            </SelectContent>
          </Select>
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="h-11 w-full lg:w-[160px]">
              <SelectValue placeholder="Manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous managers</SelectItem>
              {managers.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-11 w-full lg:w-[160px]">
              <SelectValue placeholder="Trier" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Clients grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">Aucun client</p>
          <p className="mt-1 text-xs text-muted-foreground text-pretty">
            Ajustez vos filtres ou créez un nouveau client pour commencer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onSelect={() => handleSelectClient(client)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Client Card ───────────────────────────── */

function ClientCard({
  client,
  onSelect,
}: {
  client: PortfolioClient;
  onSelect: () => void;
}) {
  const status = STATUS_META[client.status];
  const lowScore = client.makeItScore < 50;
  const hasAlerts = client.alertsCount > 0;
  // Deterministic client color — same id always maps to the same palette slot,
  // so the avatar + left border + score ring all stay consistent.
  const color = getClientColor(client.id);

  return (
    <div
      className={cn(
        "surface-card group relative flex flex-col gap-3 p-5 transition-all hover:shadow-md hover:-translate-y-0.5",
        color.borderLeft
      )}
    >
      {/* Top: avatar + name + score */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClientColorAvatar
            clientId={client.id}
            initials={initials(client.name) || "?"}
            name={client.name}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{client.name}</p>
            <p className="text-xs text-muted-foreground">{client.sector ?? "Secteur non précisé"}</p>
          </div>
        </div>
        <MiniScoreRing value={client.makeItScore} delta={client.scoreDelta} stroke={color.hex} />
      </div>

      {/* Status + manager */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", status.chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
        {client.managerName && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {client.managerName}
          </span>
        )}
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="surface-soft rounded-lg p-2">
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3 w-3" /> À venir
          </div>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{client.upcomingCount}</p>
        </div>
        <div className="surface-soft rounded-lg p-2">
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3 w-3" /> Alertes
          </div>
          <p
            className={cn(
              "mt-0.5 text-base font-semibold tabular-nums",
              hasAlerts ? "text-rose-600" : "text-foreground"
            )}
          >
            {client.alertsCount}
          </p>
        </div>
        <div className="surface-soft rounded-lg p-2">
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <TrendingUp className="h-3 w-3" /> Activité
          </div>
          <p className="mt-0.5 text-xs font-medium">{formatLastActivity(client.lastActivityAt)}</p>
        </div>
      </div>

      {/* CTAs — actionable per design rules */}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-9 flex-1"
          onClick={onSelect}
        >
          Voir la stratégie <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        {hasAlerts && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50"
            onClick={onSelect}
          >
            Résoudre
          </Button>
        )}
        {lowScore && (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Score bas</Badge>
        )}
      </div>
    </div>
  );
}

function MiniScoreRing({ value, delta, stroke }: { value: number; delta: number; stroke?: string }) {
  // Small 44px score ring + delta pill. Stroke follows the client's palette
  // color when supplied, falling back to the brand violet.
  const up = delta >= 0;
  const strokeColor = stroke ?? "oklch(0.55 0.13 290)";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="relative h-11 w-11">
        <svg width={44} height={44} className="-rotate-90">
          <circle cx={22} cy={22} r={18} fill="none" stroke="oklch(0.93 0.004 120)" strokeWidth={4} />
          <circle
            cx={22}
            cy={22}
            r={18}
            fill="none"
            stroke={strokeColor}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 18}
            strokeDashoffset={2 * Math.PI * 18 * (1 - value / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
          {value}
        </span>
      </div>
      {delta !== 0 && (
        <span className={cn("text-[10px] font-medium tabular-nums", up ? "text-emerald-600" : "text-rose-600")}>
          {up ? "+" : ""}{delta}%
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── Create Client Dialog ───────────────────────────── */

function CreateClientDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [objective, setObjective] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Nom du client requis");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/agency/clients", {
        name: name.trim(),
        sector: sector || null,
        country: country || null,
        objective: objective || null,
        platforms,
      });
      toast.success("Client créé", { description: name.trim() });
      setName("");
      setSector("");
      setCountry("");
      setObjective("");
      setPlatforms([]);
      onCreated();
    } catch (e) {
      toast.error("Création échouée", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
      void onClose;
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Nouveau client</DialogTitle>
        <DialogDescription>
          Crée un workspace client lié à votre agence. Vous deviendrez manager par défaut.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="client-name">Nom du client *</Label>
          <Input
            id="client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Maison Diallo"
            className="h-11"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="client-sector">Secteur</Label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger id="client-sector" className="h-11 w-full">
                <SelectValue placeholder="Secteur" />
              </SelectTrigger>
              <SelectContent>
                {SECTORS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-country">Pays</Label>
            <Input
              id="client-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="ex. Sénégal"
              className="h-11"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-objective">Objectif principal</Label>
          <Select value={objective} onValueChange={setObjective}>
            <SelectTrigger id="client-objective" className="h-11 w-full">
              <SelectValue placeholder="Objectif" />
            </SelectTrigger>
            <SelectContent>
              {OBJECTIVES.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Plateformes</Label>
          <div className="flex flex-wrap gap-1.5">
            {["instagram", "facebook", "tiktok", "linkedin", "youtube", "whatsapp"].map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    active
                      ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                      : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSubmit} disabled={submitting} className="h-11">
          {submitting ? "Création…" : "Créer le client"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
