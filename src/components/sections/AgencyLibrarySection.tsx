"use client";

// Make It — AgencyLibrarySection ("📚 Bibliothèque Agence" agency nav item).
//
// The "treasure chest" of the agency's best content — assets copied from
// individual client libraries that have proven reusable across clients.
//
// Layout:
//   - Top: summary cards (Total assets, Total reuses, Avg performance, Most reused)
//   - Filter bar: search + kind filter (text/image/video/carousel/template)
//     + tags filter + sort (recent / most-reused / best-performance)
//   - Grid of asset cards: thumbnail (gradient or image), kind badge, title,
//     origin client name + avatar, reuse count, performance score, tags.
//     Each card has a "Forker vers un client" button (opens a dialog to pick
//     the target client) + a "Voir" (preview) + a "Supprimer" (admin only).
//   - The "Forker vers un client" dialog: dropdown of accessible clients →
//     on confirm, calls POST /api/agency/library/[id]/fork → toast
//     "Copié vers [client]" → increments reuse count.
//   - Anti-waste suggestion: small "Similaire dans la bibliothèque agence"
//     hint when a similar title exists.
//
// Routes used:
//   - GET    /api/agency/library            → list (filterable)
//   - POST   /api/agency/library            → copy from client library
//   - GET    /api/agency/library/[id]       → one asset
//   - PATCH  /api/agency/library/[id]       → update (manager+)
//   - DELETE /api/agency/library/[id]       → delete (admin only)
//   - POST   /api/agency/library/[id]/fork  → fork into a target client
//   - GET    /api/agency/clients            → list clients (for fork picker)

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Sparkles,
  Trash2,
  Eye,
  Building2,
  Copy,
  TrendingUp,
  Trophy,
  Package,
  RefreshCw,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  GalleryHorizontal,
  LayoutTemplate,
  Library,
  type LucideIcon,
} from "lucide-react";

import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import {
  apiGet,
  apiPost,
  apiDelete,
  apiTry,
  ApiError,
} from "@/lib/api-client";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { InsightStat } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types (mirrors backend rows) ─────────────────────────────────────

type AssetKind = "text" | "image" | "video" | "carousel" | "template";

type AgencyLibraryAsset = {
  id: string;
  agencyId: string;
  kind: AssetKind;
  title: string;
  originWorkspaceId: string | null;
  originContentId: string | null;
  originClientName: string | null;
  content: Record<string, unknown> | null;
  thumb: string | null;
  tags: string[];
  performanceScore: number | null;
  reuseCount: number;
  createdAt: string;
};

type AgencyLibrarySummary = {
  totalAssets: number;
  totalReuses: number;
  avgPerformance: number | null;
  mostReused: { id: string; title: string; reuseCount: number } | null;
};

type AgencyLibraryResponse = {
  assets: AgencyLibraryAsset[];
  summary: AgencyLibrarySummary;
  similar?: AgencyLibraryAsset[];
};

type AgencyClient = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  makeItScore: number;
  managerName: string | null;
  myRole: "manager" | "creative" | "admin" | null;
};

type AgencyInfo = {
  agency: {
    id: string;
    name: string;
    slug: string;
    status: string;
    mode: string;
  };
  role: "admin" | "manager" | "creative";
} | null;

// ── Constants ─────────────────────────────────────────────────────────

const KIND_META: Record<AssetKind, { label: string; icon: LucideIcon; gradient: string }> = {
  text: { label: "Texte", icon: FileText, gradient: "from-violet-100 to-rose-100" },
  image: { label: "Image", icon: ImageIcon, gradient: "from-emerald-100 to-teal-100" },
  video: { label: "Vidéo", icon: VideoIcon, gradient: "from-amber-100 to-rose-100" },
  carousel: { label: "Carousel", icon: GalleryHorizontal, gradient: "from-teal-100 to-violet-100" },
  template: { label: "Template", icon: LayoutTemplate, gradient: "from-rose-100 to-amber-100" },
};

const KIND_FILTERS: { key: AssetKind | "all"; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "text", label: "Textes" },
  { key: "image", label: "Images" },
  { key: "video", label: "Vidéos" },
  { key: "carousel", label: "Carrousels" },
  { key: "template", label: "Templates" },
];

const SORT_OPTIONS: { key: "recent" | "most-reused" | "best-performance"; label: string }[] = [
  { key: "recent", label: "Récents" },
  { key: "most-reused", label: "Plus réutilisés" },
  { key: "best-performance", label: "Meilleure perf." },
];

// ── Helpers ─────────────────────────────────────────────────────────

function clientInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return "À l'instant";
    const min = Math.floor(sec / 60);
    if (min < 60) return `Il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Il y a ${h} h`;
    const days = Math.floor(h / 24);
    if (days === 1) return "Hier";
    if (days < 7) return `Il y a ${days} j`;
    const weeks = Math.floor(days / 7);
    return `Il y a ${weeks} sem.`;
  } catch {
    return "";
  }
}

// ── Component ────────────────────────────────────────────────────────

export function AgencyLibrarySection() {
  const { setActiveAgencyId } = useAppStore();
  const { user } = useAuth();
  const [agency, setAgency] = useState<AgencyInfo>(null);
  const [data, setData] = useState<AgencyLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [sort, setSort] = useState<"recent" | "most-reused" | "best-performance">("recent");

  // Fork dialog
  const [forkAsset, setForkAsset] = useState<AgencyLibraryAsset | null>(null);
  const [forkTarget, setForkTarget] = useState<string>(""); // workspaceId
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [forking, setForking] = useState(false);

  // Preview dialog
  const [previewAsset, setPreviewAsset] = useState<AgencyLibraryAsset | null>(null);

  // Delete confirmation
  const [deleteAsset, setDeleteAsset] = useState<AgencyLibraryAsset | null>(null);

  const isAdmin = agency?.role === "admin";

  // ── Sync activeAgencyId on mount (best-effort) ───────────────────────
  useEffect(() => {
    if (agency?.agency?.id) {
      setActiveAgencyId(agency.agency.id);
    }
  }, [agency?.agency?.id, setActiveAgencyId]);

  // ── Fetch agency info (to know the role — admin sees delete) ─────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await apiTry(
        () =>
          apiGet<{
            agency: { id: string; name: string; slug: string; status: string; mode: string };
            role: "admin" | "manager" | "creative";
          }>("/api/agency"),
        null
      );
      if (cancelled || !info) return;
      setAgency(info as AgencyInfo);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch library assets ─────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (kindFilter !== "all") params.set("kind", kindFilter);
      if (search.trim()) params.set("search", search.trim());
      if (sort !== "recent") params.set("sort", sort);
      const qs = params.toString();
      const res = await apiGet<AgencyLibraryResponse>(
        `/api/agency/library${qs ? `?${qs}` : ""}`
      );
      setData(res);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Backend injoignable";
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [kindFilter, search, sort]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Fetch accessible clients (for fork picker) ───────────────────────
  const refreshClients = useCallback(async () => {
    try {
      const res = await apiGet<{ clients: AgencyClient[] }>("/api/agency/clients");
      setClients(res.clients ?? []);
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => {
    void refreshClients();
  }, [refreshClients]);

  // ── Fork ─────────────────────────────────────────────────────────────
  const handleFork = async () => {
    if (!forkAsset || !forkTarget) return;
    setForking(true);
    try {
      await apiPost(`/api/agency/library/${forkAsset.id}/fork`, {
        targetWorkspaceId: forkTarget,
      });
      const client = clients.find((c) => c.workspaceId === forkTarget);
      toast.success(`Copié vers ${client?.name ?? "le client"}`, {
        description: forkAsset.title,
      });
      setForkAsset(null);
      setForkTarget("");
      // Optimistic: bump the reuse count on the local asset.
      setData((prev) =>
        prev
          ? {
              ...prev,
              assets: prev.assets.map((a) =>
                a.id === forkAsset.id
                  ? { ...a, reuseCount: a.reuseCount + 1 }
                  : a
              ),
              summary: {
                ...prev.summary,
                totalReuses: prev.summary.totalReuses + 1,
              },
            }
          : prev
      );
      // Background refresh to get the authoritative numbers.
      void refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec du fork";
      toast.error("Fork impossible", { description: msg });
    } finally {
      setForking(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteAsset) return;
    try {
      await apiDelete(`/api/agency/library/${deleteAsset.id}`);
      toast.success("Asset supprimé de la bibliothèque agence");
      setData((prev) =>
        prev
          ? {
              ...prev,
              assets: prev.assets.filter((a) => a.id !== deleteAsset.id),
              summary: {
                ...prev.summary,
                totalAssets: Math.max(0, prev.summary.totalAssets - 1),
                totalReuses: Math.max(
                  0,
                  prev.summary.totalReuses - deleteAsset.reuseCount
                ),
              },
            }
          : prev
      );
      setDeleteAsset(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de la suppression";
      toast.error("Suppression impossible", { description: msg });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────
  const summary = data?.summary;
  const assets = data?.assets ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Agence"
        title="Bibliothèque Agence"
        description="Le coffre-fort des contenus performants de votre agence — réutilisez-les sur tous vos clients en un clic."
        actions={
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Actualiser
          </Button>
        }
      />

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InsightStat
          label="Total assets"
          value={summary ? String(summary.totalAssets) : "—"}
          hint="Dans la bibliothèque"
          tone="default"
        />
        <InsightStat
          label="Réutilisations"
          value={summary ? String(summary.totalReuses) : "—"}
          hint="Forks cumulés"
          tone="good"
        />
        <InsightStat
          label="Perf. moyenne"
          value={
            summary
              ? summary.avgPerformance === null
                ? "—"
                : `${summary.avgPerformance}/100`
              : "—"
          }
          hint="Score moyen"
          tone="default"
        />
        <div className="surface-card flex flex-col gap-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Le plus réutilisé
          </p>
          {summary?.mostReused ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--emerald-accent)] text-white">
                <Trophy className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {summary.mostReused.title}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {summary.mostReused.reuseCount} réutilisations
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Aucun pour l'instant</p>
          )}
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="surface-card flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearch(searchInput);
                }
              }}
              placeholder="Rechercher un asset par titre ou tag…"
              className="h-10 pl-9"
              aria-label="Rechercher"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as AssetKind | "all")}
            >
              <SelectTrigger className="h-10 w-[140px]" aria-label="Type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {KIND_FILTERS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(v) =>
                setSort(v as "recent" | "most-reused" | "best-performance")
              }
            >
              <SelectTrigger className="h-10 w-[160px]" aria-label="Tri">
                <SelectValue placeholder="Tri" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setSearch(searchInput)}
              className="h-10 gap-1.5 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Filtrer</span>
            </Button>
          </div>
        </div>
        {/* Active filter chips */}
        {(kindFilter !== "all" || search.trim() || sort !== "recent") && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Filtres actifs :
            </span>
            {kindFilter !== "all" && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                {KIND_META[kindFilter].label}
                <button
                  type="button"
                  onClick={() => setKindFilter("all")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Retirer le filtre type"
                >
                  ×
                </button>
              </Badge>
            )}
            {search.trim() && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                « {search.trim()} »
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Effacer la recherche"
                >
                  ×
                </button>
              </Badge>
            )}
            {sort !== "recent" && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                {SORT_OPTIONS.find((s) => s.key === sort)?.label}
                <button
                  type="button"
                  onClick={() => setSort("recent")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Réinitialiser le tri"
                >
                  ×
                </button>
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* ── Assets grid ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="surface-card flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de la bibliothèque agence…
        </div>
      ) : error ? (
        <div className="surface-card p-10 text-center text-sm text-rose-600">
          {error}
        </div>
      ) : assets.length === 0 ? (
        <div className="surface-soft flex flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-2xl shadow-sm">
            <Library className="h-6 w-6 text-[color:var(--ink)]" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Votre coffre-fort est vide
          </h3>
          <p className="max-w-md text-sm text-muted-foreground text-pretty">
            Copiez vos meilleurs contenus depuis la bibliothèque d'un client
            (menu « ⋯ » → Copier vers bibliothèque agence) pour les réutiliser
            partout.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <AgencyAssetCard
              key={asset.id}
              asset={asset}
              isAdmin={isAdmin}
              onPreview={() => setPreviewAsset(asset)}
              onFork={() => {
                setForkAsset(asset);
                setForkTarget("");
              }}
              onDelete={() => setDeleteAsset(asset)}
            />
          ))}
        </div>
      )}

      {/* ── Fork dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={!!forkAsset}
        onOpenChange={(o) => {
          if (!o) {
            setForkAsset(null);
            setForkTarget("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Forker vers un client</DialogTitle>
            <DialogDescription>
              Copiez « {forkAsset?.title} » dans la bibliothèque d'un client.
              L'asset restera disponible dans la bibliothèque agence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Client cible
              </label>
              <Select value={forkTarget} onValueChange={setForkTarget}>
                <SelectTrigger className="h-10 w-full" aria-label="Client cible">
                  <SelectValue placeholder="Choisir un client…" />
                </SelectTrigger>
                <SelectContent>
                  {clients.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Aucun client accessible.
                    </div>
                  )}
                  {clients
                    .filter((c) => c.status === "active")
                    .map((c) => (
                      <SelectItem key={c.id} value={c.workspaceId}>
                        <span className="flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px]">
                              {clientInitials(c.name)}
                            </AvatarFallback>
                          </Avatar>
                          {c.name}
                          {c.myRole && (
                            <span className="text-[10px] text-muted-foreground">
                              · vous : {c.myRole}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {forkAsset && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Aperçu
                </p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">
                  {forkAsset.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {KIND_META[forkAsset.kind].label} ·{" "}
                  {forkAsset.originClientName ?? "Origine inconnue"} ·{" "}
                  {forkAsset.reuseCount} réutilisations
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setForkAsset(null);
                setForkTarget("");
              }}
              disabled={forking}
            >
              Annuler
            </Button>
            <Button
              onClick={() => void handleFork()}
              disabled={forking || !forkTarget}
              className="gap-1.5 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              {forking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ───────────────────────────────────────────── */}
      <Dialog
        open={!!previewAsset}
        onOpenChange={(o) => {
          if (!o) setPreviewAsset(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)]">
                {(() => {
                  const Icon = KIND_META[previewAsset?.kind ?? "text"].icon;
                  return <Icon className="h-3.5 w-3.5" />;
                })()}
              </span>
              {previewAsset?.title}
            </DialogTitle>
            <DialogDescription>
              {previewAsset && KIND_META[previewAsset.kind].label} ·{" "}
              {previewAsset?.originClientName ?? "Origine inconnue"}
            </DialogDescription>
          </DialogHeader>
          {previewAsset && (
            <div className="space-y-3">
              {/* Thumbnail (image or gradient) */}
              <div
                className={cn(
                  "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br",
                  KIND_META[previewAsset.kind].gradient
                )}
              >
                {previewAsset.thumb && previewAsset.kind === "image" ? (
                  <img
                    src={previewAsset.thumb}
                    alt={previewAsset.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center">
                    {(() => {
                      const Icon = KIND_META[previewAsset.kind].icon;
                      return <Icon className="h-8 w-8 text-foreground/40" />;
                    })()}
                    <span className="text-xs font-medium text-foreground/60">
                      {KIND_META[previewAsset.kind].label}
                    </span>
                  </div>
                )}
              </div>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Réutilisations
                  </p>
                  <p className="text-base font-semibold text-foreground">
                    {previewAsset.reuseCount}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Perf.
                  </p>
                  <p className="text-base font-semibold text-foreground">
                    {previewAsset.performanceScore === null
                      ? "—"
                      : `${previewAsset.performanceScore}/100`}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Ajouté
                  </p>
                  <p className="text-xs font-medium text-foreground">
                    {relativeTime(previewAsset.createdAt)}
                  </p>
                </div>
              </div>
              {/* Tags */}
              {previewAsset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {previewAsset.tags.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      #{t}
                    </Badge>
                  ))}
                </div>
              )}
              {/* Content preview (if text/template with body) */}
              {previewAsset.content &&
                typeof previewAsset.content === "object" &&
                "body" in previewAsset.content &&
                typeof previewAsset.content.body === "string" && (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {previewAsset.content.body as string}
                    </p>
                  </div>
                )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewAsset(null)}
            >
              Fermer
            </Button>
            <Button
              onClick={() => {
                if (previewAsset) {
                  setForkAsset(previewAsset);
                  setForkTarget("");
                  setPreviewAsset(null);
                }
              }}
              className="gap-1.5 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              <Copy className="h-4 w-4" />
              Forker vers un client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteAsset}
        onOpenChange={(o) => {
          if (!o) setDeleteAsset(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet asset ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteAsset?.title} » sera retiré de la bibliothèque agence.
              Les contenus déjà forkés vers des clients ne sont pas affectés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function AgencyAssetCard({
  asset,
  isAdmin,
  onPreview,
  onFork,
  onDelete,
}: {
  asset: AgencyLibraryAsset;
  isAdmin: boolean;
  onPreview: () => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[asset.kind];
  const Icon = meta.icon;
  return (
    <div className="group surface-card flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
      {/* Thumbnail */}
      <div
        className={cn(
          "relative flex aspect-square items-center justify-center bg-gradient-to-br",
          meta.gradient
        )}
      >
        {asset.thumb && asset.kind === "image" ? (
          <img
            src={asset.thumb}
            alt={asset.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Icon className="h-10 w-10 text-foreground/40" />
            <span className="text-xs font-medium text-foreground/50">
              {meta.label}
            </span>
          </div>
        )}
        {/* Kind badge */}
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-medium text-foreground backdrop-blur-sm">
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
        {/* Reuse count chip (top-right) */}
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-[color:var(--emerald-accent)] px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
          <TrendingUp className="h-3 w-3" />
          {asset.reuseCount}
        </span>
        {/* 3-dot menu */}
        <div className="absolute bottom-2.5 right-2.5 opacity-0 transition-opacity group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-foreground backdrop-blur-sm hover:bg-white"
                aria-label="Plus d'actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onPreview}>
                <Eye className="h-3.5 w-3.5" /> Voir
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onFork}>
                <Copy className="h-3.5 w-3.5" /> Forker vers un client
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem
                  onSelect={onDelete}
                  className="text-rose-600 focus:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium text-foreground text-pretty">
          {asset.title}
        </p>
        {/* Origin client + performance */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[9px]">
                {clientInitials(asset.originClientName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-[11px] text-muted-foreground">
              {asset.originClientName ?? "Origine inconnue"}
            </span>
          </div>
          {asset.performanceScore !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              <Sparkles className="h-2.5 w-2.5 text-[color:var(--emerald-accent)]" />
              {asset.performanceScore}
            </span>
          )}
        </div>
        {/* Tags */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                #{t}
              </Badge>
            ))}
            {asset.tags.length > 3 && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                +{asset.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
        {/* CTA */}
        <Button
          size="sm"
          onClick={onFork}
          className="mt-1 h-9 w-full gap-1.5 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
        >
          <Copy className="h-3.5 w-3.5" />
          Forker vers un client
        </Button>
      </div>
    </div>
  );
}
