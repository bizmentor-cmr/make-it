"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Edit3,
  Image as ImageIcon,
  LayoutTemplate,
  Megaphone,
  MoreHorizontal,
  Search,
  Sparkles,
  Text as TextIcon,
  Trash2,
  Upload,
  Wand2,
  Clapperboard,
  GalleryHorizontal,
  Loader2,
  Building2,
  Radar,
  Plus,
  RefreshCw,
  Bookmark,
  Lightbulb,
  ExternalLink,
  TrendingUp,
  MessageSquare,
  Eye,
  ThumbsUp,
  Share2,
  Hash,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAppStore } from "@/store/app-store";
import {
  libraryAssets,
  type LibraryAsset,
  type Platform,
} from "@/lib/mock-data";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformDot, PlatformBadge } from "@/components/shared/PlatformBadge";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiDelete, apiGet, apiPost, apiTry, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Library / "Bibliothèque"                                                   */
/*  A media library with natural-language search, filters, and an assets grid. */
/* -------------------------------------------------------------------------- */

type FilterKey =
  | "tout"
  | "image"
  | "video"
  | "text"
  | "carousel"
  | "campaign"
  | "template"
  | "published"
  | "drafts"
  | "veille";

const FILTERS: { key: FilterKey; label: string; icon?: LucideIcon }[] = [
  { key: "tout", label: "Tout" },
  { key: "image", label: "Images", icon: ImageIcon },
  { key: "video", label: "Vidéos", icon: Clapperboard },
  { key: "text", label: "Textes", icon: TextIcon },
  { key: "carousel", label: "Carrousels", icon: GalleryHorizontal },
  { key: "campaign", label: "Campagnes", icon: Megaphone },
  { key: "template", label: "Templates", icon: LayoutTemplate },
  { key: "published", label: "Publiés" },
  { key: "drafts", label: "Brouillons" },
  { key: "veille", label: "Veille", icon: Radar },
];

const KIND_META: Record<LibraryAsset["kind"], { emoji: string; label: string }> = {
  image: { emoji: "🖼️", label: "Image" },
  video: { emoji: "🎬", label: "Vidéo" },
  text: { emoji: "✍️", label: "Texte" },
  carousel: { emoji: "🎠", label: "Carousel" },
  campaign: { emoji: "📣", label: "Campagne" },
  template: { emoji: "📐", label: "Template" },
};

const EXAMPLE_CHIPS = [
  "Mes vidéos de promotion",
  "Carrousels de cette semaine",
  "Contenus publiés",
];

// Pretend some assets are "published" or "drafts" so those filters show content
// when no API data is available — kept for the fallback path only.
const PUBLISHED_IDS = new Set(["l2", "l5", "l8"]);
const DRAFTS_IDS = new Set(["l3", "l4", "l6"]);

// Deterministic gradient pool used when the API doesn't supply a thumbnail.
const GRADIENTS = [
  "from-rose-100 to-amber-100",
  "from-emerald-100 to-teal-100",
  "from-amber-100 to-rose-100",
  "from-violet-100 to-rose-100",
  "from-teal-100 to-emerald-100",
  "from-rose-100 to-violet-100",
  "from-emerald-100 to-amber-100",
  "from-teal-100 to-amber-100",
];

// Map backend content types to the LibraryAsset["kind"] union used by the UI.
const CONTENT_KIND_MAP: Record<string, LibraryAsset["kind"]> = {
  image: "image",
  video: "video",
  reel: "video",
  story: "video",
  text: "text",
  article: "text",
  carousel: "carousel",
  ad: "campaign",
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function relativeTime(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
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
}

// ─── API shapes ─────────────────────────────────────────────────────────────
type ContentRow = {
  id: string;
  type: string;
  title: string;
  status: string;
  objective: string | null;
  platforms: string[];
  aiGenerated?: boolean;
  createdAt: string;
  updatedAt: string;
};

type MediaAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "doc" | "thumb";
  filename: string;
  mimeType: string;
  storagePath: string;
  thumbnailPath?: string | null;
  createdAt: string;
};

// Convert a ContentRow into a LibraryAsset (UI shape).
function mapContent(c: ContentRow): LibraryAsset {
  const kind: LibraryAsset["kind"] =
    CONTENT_KIND_MAP[c.type?.toLowerCase()] ?? "text";
  const platform = (c.platforms?.[0] as Platform) ?? "all";
  const thumb = GRADIENTS[hashStr(c.id) % GRADIENTS.length];
  return {
    id: `c_${c.id}`,
    kind,
    title: c.title ?? "Sans titre",
    platform,
    updated: relativeTime(c.updatedAt ?? c.createdAt) || "—",
    thumb,
  };
}

// Convert a MediaAsset into a LibraryAsset (UI shape).
function mapMedia(m: MediaAsset): LibraryAsset {
  const kind: LibraryAsset["kind"] =
    m.kind === "image"
      ? "image"
      : m.kind === "video"
      ? "video"
      : m.kind === "thumb"
      ? "image"
      : "template"; // docs / audio fallback to the template tile
  const thumb = GRADIENTS[hashStr(m.id) % GRADIENTS.length];
  return {
    id: `m_${m.id}`,
    kind,
    title: m.filename ?? "Fichier",
    platform: "all",
    updated: relativeTime(m.createdAt) || "—",
    thumb,
  };
}

// Per-asset status kept in a side-table so the published / drafts filters
// continue to work on top of the API data (the content API returns a `status`
// field; the media API doesn't, so media assets default to "published" only
// when they're files on disk — for the demo we keep them out of the
// published/drafts filters by tagging them as `none`).
type AssetMeta = {
  // "published" → visible in the "Publiés" filter
  // "drafts"    → visible in the "Brouillons" filter
  // "none"     → not visible in either of those filters
  statusFlag: "published" | "drafts" | "none";
};

export function LibrarySection() {
  const { setActiveSection, mode } = useAppStore();
  const isAgency = mode === "agency";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("tout");
  const [searched, setSearched] = useState<string>("");
  const [assets, setAssets] = useState<LibraryAsset[]>(libraryAssets);
  const [metaById, setMetaById] = useState<Record<string, AssetMeta>>({});
  const [uploading, setUploading] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [contentList, mediaList] = await Promise.all([
        apiTry(async () => apiGet<ContentRow[]>("/api/content?limit=50"), null as ContentRow[] | null),
        apiTry(async () => apiGet<MediaAsset[]>("/api/media?limit=50"), null as MediaAsset[] | null),
      ]);
      if (cancelled) return;

      const merged: LibraryAsset[] = [];
      const meta: Record<string, AssetMeta> = {};

      if (contentList && contentList.length > 0) {
        for (const c of contentList) {
          const a = mapContent(c);
          merged.push(a);
          const st = (c.status ?? "").toLowerCase();
          meta[a.id] = {
            statusFlag:
              st === "published"
                ? "published"
                : st === "draft" || st === "idea"
                ? "drafts"
                : "none",
          };
        }
      }
      if (mediaList && mediaList.length > 0) {
        for (const m of mediaList) {
          const a = mapMedia(m);
          merged.push(a);
          meta[a.id] = { statusFlag: "none" };
        }
      }

      if (merged.length > 0) {
        setAssets(merged);
        setMetaById(meta);
      } else {
        // Fall back to the mock library — pre-populate the meta map so the
        // published / drafts filters keep working on the demo data.
        const mockMeta: Record<string, AssetMeta> = {};
        for (const a of libraryAssets) {
          mockMeta[a.id] = {
            statusFlag: PUBLISHED_IDS.has(a.id)
              ? "published"
              : DRAFTS_IDS.has(a.id)
              ? "drafts"
              : "none",
          };
        }
        setAssets(libraryAssets);
        setMetaById(mockMeta);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the merged list after an upload (or any other mutation).
  async function refresh() {
    const [contentList, mediaList] = await Promise.all([
      apiTry(async () => apiGet<ContentRow[]>("/api/content?limit=50"), null as ContentRow[] | null),
      apiTry(async () => apiGet<MediaAsset[]>("/api/media?limit=50"), null as MediaAsset[] | null),
    ]);
    const merged: LibraryAsset[] = [];
    const meta: Record<string, AssetMeta> = {};
    if (contentList && contentList.length > 0) {
      for (const c of contentList) {
        const a = mapContent(c);
        merged.push(a);
        const st = (c.status ?? "").toLowerCase();
        meta[a.id] = {
          statusFlag:
            st === "published"
              ? "published"
              : st === "draft" || st === "idea"
              ? "drafts"
              : "none",
        };
      }
    }
    if (mediaList && mediaList.length > 0) {
      for (const m of mediaList) {
        const a = mapMedia(m);
        merged.push(a);
        meta[a.id] = { statusFlag: "none" };
      }
    }
    if (merged.length > 0) {
      setAssets(merged);
      setMetaById(meta);
    }
  }

  // Real upload — POST multipart/form-data to /api/media.
  async function handleUpload(file: File | null | undefined) {
    if (!file) return;
    if (uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await apiPost("/api/media", fd);
      toast.success("Fichier téléversé", {
        description: file.name,
      });
      await refresh();
    } catch (e) {
      toast.error("Téléversement impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
      // Reset the input so the same file can be selected again later.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const runSearch = (q: string) => {
    setSearched(q);
    if (!q.trim()) return;
    toast.success("Recherche Make It", {
      description: q,
    });
  };

  const filtered = useMemo(() => {
    let list = assets;
    if (filter === "published")
      list = list.filter((a) => metaById[a.id]?.statusFlag === "published");
    else if (filter === "drafts")
      list = list.filter((a) => metaById[a.id]?.statusFlag === "drafts");
    else if (filter !== "tout") list = list.filter((a) => a.kind === filter);
    if (searched.trim()) {
      const q = searched.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) || a.kind.includes(q)
      );
    }
    return list;
  }, [assets, filter, searched, metaById]);

  async function handleDelete(asset: LibraryAsset) {
    // Only media assets (id prefix `m_`) are deletable on the backend. Content
    // items have their own delete endpoint not exposed in this section, so we
    // fall back to a local-only removal.
    if (asset.id.startsWith("m_")) {
      const mediaId = asset.id.slice(2);
      try {
        await apiDelete(`/api/media/${mediaId}`);
        toast.success("Contenu supprimé");
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      } catch (e) {
        toast.error("Suppression impossible", {
          description: e instanceof Error ? e.message : undefined,
        });
      }
    } else {
      toast.success("Contenu supprimé");
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    }
  }

  // P5 — Copy an asset to the agency library (only visible in agency mode).
  // Calls POST /api/agency/library with the asset's data + the active
  // workspace (set via X-Workspace-Id header — the active client workspace).
  async function handleCopyToAgencyLibrary(asset: LibraryAsset) {
    if (copyingId) return;
    setCopyingId(asset.id);
    try {
      // Map LibraryAsset.kind → agency library kind.
      const kindMap: Record<LibraryAsset["kind"], string> = {
        image: "image",
        video: "video",
        text: "text",
        carousel: "carousel",
        campaign: "template",
        template: "template",
      };
      const body: Record<string, unknown> = {
        kind: kindMap[asset.kind] ?? "text",
        title: asset.title,
        thumb: asset.thumb,
        tags: [],
      };
      // Forward the source content / media id so the agency library can record
      // the origin and dedupe on re-copy.
      if (asset.id.startsWith("c_")) body.contentId = asset.id.slice(2);
      else if (asset.id.startsWith("m_")) body.mediaId = asset.id.slice(2);
      await apiPost("/api/agency/library", body);
      toast.success("Copié vers la bibliothèque agence", {
        description: asset.title,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de la copie";
      toast.error("Copie impossible", { description: msg });
    } finally {
      setCopyingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Bibliothèque"
        title="Tous vos contenus"
        description="Images, vidéos, textes, campagnes, templates — retrouvez tout ici."
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setActiveSection("create")}
            >
              <Wand2 className="h-4 w-4" />
              Importer
            </Button>
            <Button
              size="lg"
              className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Téléversement…" : "Téléverser"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                void handleUpload(f);
              }}
            />
          </>
        }
      />

      {/* ── Veille view (rendered when the "🔍 Veille" filter is active). ── */}
      {filter === "veille" ? (
        <VeilleView />
      ) : (
        <>
          {/* ---------- Natural-language search ---------- */}
          <section className="surface-card p-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="lib-search" className="text-sm font-medium text-foreground">
                Recherche en langage naturel
              </label>
              <div className="relative">
                <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--emerald-accent)]" />
                <Input
                  id="lib-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch(query);
                  }}
                  placeholder="Montrez-moi mes vidéos de promotion."
                  className="h-12 pl-11 pr-28 text-base"
                />
                <Button
                  size="sm"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                  onClick={() => runSearch(query)}
                >
                  <Search className="h-4 w-4" />
                  Rechercher
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {EXAMPLE_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setQuery(chip);
                      runSearch(chip);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-[color:var(--emerald-accent)] hover:text-foreground"
                  >
                    <Sparkles className="h-3 w-3" />
                    {chip}
                  </button>
                ))}
                {searched && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearched("");
                      setQuery("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    ✕ Effacer
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* ---------- Filter row ---------- */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-premium">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const Icon = f.icon;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
                    active
                      ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20"
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* ---------- Assets grid ---------- */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isAgency={isAgency}
                  copying={copyingId === asset.id}
                  onDelete={() => handleDelete(asset)}
                  onCopyToAgency={() => handleCopyToAgencyLibrary(asset)}
                />
              ))}
            </div>
          ) : (
            <EmptyState onCreate={() => setActiveSection("create")} />
          )}

          {/* ---------- Bottom recommendation ---------- */}
          <RecommendationCard
            icon={<Sparkles className="h-4 w-4" />}
            title="Vos visuels « Hiver » sont réutilisables pour 3 contenus à venir."
            reason="3 contenus planifiés utilisent un style proche de votre collection Hiver. Réutilisez-les pour gagner du temps et garder la cohérence."
            cta="Voir"
            tone="emerald"
            onCta={() => setActiveSection("planning")}
          />
        </>
      )}
    </div>
  );
}

/* --------------------------------- Asset card -------------------------------- */

function AssetCard({
  asset,
  isAgency,
  copying,
  onDelete,
  onCopyToAgency,
}: {
  asset: LibraryAsset;
  isAgency: boolean;
  copying: boolean;
  onDelete: () => void;
  onCopyToAgency: () => void;
}) {
  const { setActiveSection } = useAppStore();
  const kind = KIND_META[asset.kind];
  return (
    <div className="group surface-card overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
      <div
        className={cn(
          "relative aspect-square bg-gradient-to-br",
          asset.thumb
        )}
      >
        {/* Kind badge */}
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-medium text-foreground backdrop-blur-sm">
          <span>{kind.emoji}</span>
          {kind.label}
        </span>

        {/* 3-dot menu */}
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
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
              <DropdownMenuItem onSelect={() => setActiveSection("create")}>
                <Edit3 className="h-3.5 w-3.5" /> Modifier
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast.success("Contenu dupliqué")}>
                <Copy className="h-3.5 w-3.5" /> Dupliquer
              </DropdownMenuItem>
              {isAgency && (
                <DropdownMenuItem
                  onSelect={onCopyToAgency}
                  disabled={copying}
                >
                  {copying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5" />
                  )}
                  Copier vers bibliothèque agence
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-rose-600 focus:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium text-foreground text-pretty">
            {asset.title}
          </p>
        </div>
        <div className="flex items-center justify-between">
          {asset.platform === "all" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Toutes
            </span>
          ) : (
            <PlatformDot platform={asset.platform as Platform} />
          )}
          <span className="text-[11px] text-muted-foreground">{asset.updated}</span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Empty state ------------------------------- */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="surface-soft flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-2xl shadow-sm">
        🗂️
      </div>
      <h3 className="text-base font-semibold text-foreground">Rien ici pour l'instant</h3>
      <p className="max-w-md text-sm text-muted-foreground text-pretty">
        Aucun contenu ne correspond à ce filtre. Créez un nouveau contenu et il
        apparaîtra ici automatiquement.
      </p>
      <Button
        size="lg"
        className="mt-2 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
        onClick={onCreate}
      >
        <Sparkles className="h-4 w-4" />
        Créer
      </Button>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────── */
/*  Veille / Trend watching                                                  */
/*  Rendered when the "🔍 Veille" filter is active in the Library.           */
/* ───────────────────────────────────────────────────────────────────────── */

type TrendWatch = {
  id: string;
  name: string;
  platforms: string[];
  keywords: string[];
  sector: string | null;
  competitors: string[];
  language: string;
  active: boolean;
  lastSyncAt: string | null;
  syncIntervalH: number;
  postCount: number;
};

type TrendInsights = {
  watchCount: number;
  postCount: number;
  topHashtags: { tag: string; count: number }[];
  topPlatforms: { platform: string; count: number; avgEngagement: number | null }[];
  topAngles: { angle: string; platform: string; engagementRate: number | null }[];
  recentKeywords: string[];
  sector: string | null;
  lastSyncAt: string | null;
};

type TrendPost = {
  id: string;
  watchId: string;
  platform: string;
  authorHandle: string | null;
  authorName: string | null;
  authorFollowers: number | null;
  externalId: string | null;
  url: string | null;
  caption: string | null;
  hashtags: string[];
  mediaType: string | null;
  thumbnailUrl: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  engagementRate: number | null;
  summary: string | null;
  contentAngle: string | null;
  relevanceScore: number | null;
  postedAt: string | null;
  discoveredAt: string;
  isSaved: boolean;
  inspiredContentId: string | null;
};

const VEILLE_PLATFORMS = ["instagram", "tiktok", "linkedin", "youtube", "facebook"] as const;

function VeilleView() {
  const { setActiveSection, setCreatePrefill } = useAppStore();
  const [watches, setWatches] = useState<TrendWatch[]>([]);
  const [insights, setInsights] = useState<TrendInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Tracks which watch is currently expanded to show its TrendPosts feed.
  const [expandedWatchId, setExpandedWatchId] = useState<string | null>(null);

  async function load() {
    const res = await apiTry(
      async () =>
        apiGet<{ watches: TrendWatch[]; insights: TrendInsights | null }>(
          "/api/trends"
        ),
      null
    );
    if (res) {
      setWatches(res.watches ?? []);
      setInsights(res.insights ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry(
        async () =>
          apiGet<{ watches: TrendWatch[]; insights: TrendInsights | null }>(
            "/api/trends"
          ),
        null
      );
      if (cancelled) return;
      if (res) {
        setWatches(res.watches ?? []);
        setInsights(res.insights ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSync(watchId: string) {
    toast.info("Synchronisation en cours…", {
      description: "Make It scanne le web pour les tendances. Peut prendre 5–15 s.",
    });
    try {
      const res = await apiPost<{
        inserted: number;
        skipped: number;
        failed: number;
        discovered: number;
        posts: TrendPost[];
        syncedAt: string;
      }>(`/api/trends/${watchId}/sync?maxResults=10`);
      toast.success("Veille synchronisée", {
        description: `${res.inserted} nouveau(x) post(s) — ${res.skipped} déjà connu(s).`,
      });
      await load();
    } catch (e) {
      toast.error("Synchronisation impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function handleDelete(watchId: string) {
    if (!confirm("Supprimer cette veille et tous ses posts ?")) return;
    try {
      await apiDelete(`/api/trends/${watchId}`);
      toast.success("Veille supprimée");
      if (expandedWatchId === watchId) setExpandedWatchId(null);
      await load();
    } catch (e) {
      toast.error("Suppression impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function handleToggleSave(post: TrendPost) {
    const next = !post.isSaved;
    try {
      await apiPost(`/api/trends/posts/${post.id}/save`, { saved: next });
      toast.success(next ? "Post sauvegardé" : "Post retiré", {
        description: next ? "Disponible dans vos inspirations." : undefined,
      });
      // If the post is currently visible in the expanded feed, refresh it.
      if (expandedWatchId) {
        await refreshPosts(expandedWatchId);
      }
    } catch (e) {
      toast.error("Action impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function handleInspire(post: TrendPost) {
    if (post.inspiredContentId) {
      // Already inspired — drop into Create with the existing contentId.
      setCreatePrefill({
        contentId: post.inspiredContentId,
        idea: post.contentAngle ?? post.caption ?? undefined,
        source: "trend_post",
      });
      setActiveSection("create");
      return;
    }
    try {
      const res = await apiPost<{ contentId: string }>(
        `/api/trends/posts/${post.id}/inspire`
      );
      toast.success("Idée de contenu créée", {
        description: "Direction le Studio pour la peaufiner.",
      });
      // Refresh so the post shows "déjà inspiré".
      if (expandedWatchId) {
        await refreshPosts(expandedWatchId);
      }
      // Navigate to Create with the prefill — CreateSection consumes + clears it.
      setCreatePrefill({
        contentId: res.contentId,
        idea: post.contentAngle ?? post.caption ?? undefined,
        source: "trend_post",
      });
      setActiveSection("create");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Échec";
      toast.error("Impossible de créer l'idée", { description: msg });
    }
  }

  // Refresh only the TrendPosts feed of one watch (after save / inspire).
  async function refreshPosts(_watchId: string) {
    // The feed component re-fetches via its own effect when its `refreshKey`
    // prop changes. We bump that key from inside the TrendPostsFeed.
    // To keep this minimal we just reload the whole Veille list — cheap.
    await load();
  }

  // ── Empty state ──────────────────────────────────────────────────────
  if (!loading && watches.length === 0) {
    return (
      <>
        <div className="surface-hero bg-dotted p-6 sm:p-10">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-3 py-1 text-xs font-medium text-[color:var(--accent-foreground)]">
                <Radar className="h-3.5 w-3.5" />
                Veille concurrentielle
              </div>
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
                Surveillez les tendances de votre marché
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground text-pretty">
                Configurez une veille sur une ou plusieurs plateformes. Make It
                scanne le web pour les contenus tendance liés à vos
                mots-clés, les enrichit avec une analyse IA, et vous propose des
                angles réutilisables pour votre propre calendrier.
              </p>
            </div>
            <Button
              size="lg"
              className="min-h-[44px] bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Créer une veille
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              emoji: "🔎",
              title: "Mots-clés + secteur",
              body: "Ciblez les sujets qui comptent pour votre audience. Make It découvre les posts qui décollent.",
            },
            {
              emoji: "🧠",
              title: "Enrichissement IA",
              body: "Chaque post est analysé : pourquoi il performe, et quel angle réutiliser dans votre marque.",
            },
            {
              emoji: "✨",
              title: "S'en inspirer",
              body: "Transformez une tendance en idée de contenu en un clic — direction le Studio Create.",
            },
          ].map((c) => (
            <div key={c.title} className="surface-card p-5">
              <div className="text-2xl">{c.emoji}</div>
              <p className="mt-2 text-sm font-semibold text-foreground">{c.title}</p>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">{c.body}</p>
            </div>
          ))}
        </div>

        <CreateWatchDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      </>
    );
  }

  // ── Loaded view ──────────────────────────────────────────────────────
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {watches.length} veille{watches.length > 1 ? "s" : ""} active{watches.length > 1 ? "s" : ""}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            Synchronisez pour découvrir les derniers posts tendance. Chaque
            carte révèle un angle marketing réutilisable.
          </p>
        </div>
        <Button
          size="lg"
          className="min-h-[44px] bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Nouvelle veille
        </Button>
      </div>

      {/* Insights summary — surfaces top hashtags + top platforms + top angles */}
      {insights && insights.postCount > 0 && (
        <section className="surface-soft p-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[color:var(--emerald-accent)]" />
            <h3 className="text-sm font-semibold text-foreground">
              Signaux récents — {insights.postCount} posts analysés
            </h3>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top hashtags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {insights.topHashtags.slice(0, 8).map((h) => (
                  <Badge
                    key={h.tag}
                    variant="outline"
                    className="gap-1 border-border bg-card text-foreground"
                  >
                    <Hash className="h-3 w-3" />
                    {h.tag.replace(/^#/, "")}
                    <span className="text-muted-foreground">·{h.count}</span>
                  </Badge>
                ))}
                {insights.topHashtags.length === 0 && (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top plateformes
              </p>
              <div className="flex flex-wrap gap-2">
                {insights.topPlatforms.map((p) => (
                  <span
                    key={p.platform}
                    className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm"
                  >
                    <PlatformBadge platform={p.platform as Platform} />
                    {p.count}
                    {p.avgEngagement != null && (
                      <span className="text-muted-foreground">
                        · {p.avgEngagement.toFixed(1)}%
                      </span>
                    )}
                  </span>
                ))}
                {insights.topPlatforms.length === 0 && (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top angles marketing
              </p>
              <ul className="space-y-1 text-xs text-foreground">
                {insights.topAngles.slice(0, 4).map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-pretty">
                    <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--emerald-accent)]" />
                    <span className="line-clamp-1">{a.angle}</span>
                  </li>
                ))}
                {insights.topAngles.length === 0 && (
                  <li className="text-muted-foreground">—</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Watches grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="surface-card h-40 w-full animate-pulse rounded-2xl bg-muted/40"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {watches.map((w) => (
            <WatchCard
              key={w.id}
              watch={w}
              expanded={expandedWatchId === w.id}
              onToggleExpand={() =>
                setExpandedWatchId((prev) => (prev === w.id ? null : w.id))
              }
              onSync={() => handleSync(w.id)}
              onDelete={() => handleDelete(w.id)}
              onToggleSave={handleToggleSave}
              onInspire={handleInspire}
            />
          ))}
        </div>
      )}

      <CreateWatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </>
  );
}

/* ───────────────────────── Watch card + posts feed ────────────────────── */

function WatchCard({
  watch,
  expanded,
  onToggleExpand,
  onSync,
  onDelete,
  onToggleSave,
  onInspire,
}: {
  watch: TrendWatch;
  expanded: boolean;
  onToggleExpand: () => void;
  onSync: () => void;
  onDelete: () => void;
  onToggleSave: (post: TrendPost) => void;
  onInspire: (post: TrendPost) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  return (
    <div className="surface-card flex flex-col gap-3 p-5">
      {/* Header — name + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-[color:var(--emerald-accent)]" />
            <p className="truncate text-sm font-semibold text-foreground">{watch.name}</p>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {watch.sector ?? "Secteur non précisé"} · langue {watch.language}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                await onSync();
              } finally {
                setSyncing(false);
              }
            }}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {syncing ? "Sync…" : "Sync"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-rose-600 hover:bg-rose-50"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Platforms */}
      <div className="flex flex-wrap items-center gap-1.5">
        {watch.platforms.length === 0 && (
          <span className="text-xs text-muted-foreground">Toutes les plateformes</span>
        )}
        {watch.platforms.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[11px] font-medium capitalize text-foreground"
          >
            <PlatformDot platform={p as Platform} />
            {p}
          </span>
        ))}
      </div>

      {/* Keywords + competitors */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {watch.keywords.map((k) => (
            <Badge
              key={k}
              variant="outline"
              className="gap-1 border-border bg-card text-foreground"
            >
              <Hash className="h-3 w-3" />
              {k}
            </Badge>
          ))}
          {watch.competitors.map((c) => (
            <Badge
              key={c}
              variant="outline"
              className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
            >
              {c}
            </Badge>
          ))}
        </div>
      </div>

      {/* Footer — last sync + post count + expand */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            {watch.lastSyncAt ? relativeTime(watch.lastSyncAt) : "Jamais synchronisé"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {watch.postCount} post{watch.postCount > 1 ? "s" : ""}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={onToggleExpand}
        >
          {expanded ? "Masquer" : "Voir les posts"}
        </Button>
      </div>

      {/* Expanded posts feed */}
      {expanded && (
        <TrendPostsFeed
          watchId={watch.id}
          onToggleSave={onToggleSave}
          onInspire={onInspire}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Trend posts feed ─────────────────────────── */

function TrendPostsFeed({
  watchId,
  onToggleSave,
  onInspire,
}: {
  watchId: string;
  onToggleSave: (post: TrendPost) => void;
  onInspire: (post: TrendPost) => void;
}) {
  const [posts, setPosts] = useState<TrendPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"engagementRate" | "relevanceScore" | "discoveredAt">("engagementRate");
  const [platform, setPlatform] = useState<string>("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({
      sortBy,
      limit: "20",
    });
    if (platform) params.set("platform", platform);
    try {
      const res = await apiGet<TrendPost[]>(`/api/trends/${watchId}/posts?${params}`);
      setPosts(res ?? []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [watchId, sortBy, platform]);

  if (loading) {
    return (
      <div className="surface-soft mt-3 flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des posts…
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="surface-soft mt-3 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Radar className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">Aucun post découvert</p>
        <p className="text-xs text-muted-foreground text-pretty">
          Lancez une synchronisation pour que Make It scanne le web et enrichisse
          les contenus tendance.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Trier
        </span>
        {([
          { v: "engagementRate", l: "Engagement" },
          { v: "relevanceScore", l: "Pertinence" },
          { v: "discoveredAt", l: "Récent" },
        ] as const).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setSortBy(o.v)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
              sortBy === o.v
                ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {o.l}
          </button>
        ))}
      </div>

      <div className="max-h-[600px] space-y-3 overflow-y-auto pr-1 scroll-premium">
        {posts.map((p) => (
          <TrendPostCard
            key={p.id}
            post={p}
            onToggleSave={() => onToggleSave(p)}
            onInspire={() => onInspire(p)}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Single trend post card ────────────────────── */

function TrendPostCard({
  post,
  onToggleSave,
  onInspire,
}: {
  post: TrendPost;
  onToggleSave: () => void;
  onInspire: () => void;
}) {
  return (
    <article className="surface-card p-4">
      {/* Header — platform + author + engagement */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--accent)]">
            <PlatformBadge platform={post.platform as Platform} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {post.authorName ?? post.authorHandle ?? "Auteur inconnu"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {post.authorHandle ?? "—"}
              {post.authorFollowers != null && (
                <> · {formatCompact(post.authorFollowers)} abonnés</>
              )}
            </p>
          </div>
        </div>
        {post.engagementRate != null && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <TrendingUp className="h-3 w-3" />
            {post.engagementRate.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Thumbnail + caption */}
      <div className="mt-3 flex gap-3">
        {post.thumbnailUrl && (
          <img
            src={post.thumbnailUrl}
            alt=""
            className="h-24 w-24 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="line-clamp-3 text-xs text-foreground text-pretty">
            {post.caption ?? "—"}
          </p>
          {post.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {post.hashtags.slice(0, 6).map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-0.5 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                >
                  <Hash className="h-2.5 w-2.5" />
                  {h.replace(/^#/, "")}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Engagement metrics */}
      {(post.likes != null ||
        post.comments != null ||
        post.shares != null ||
        post.views != null) && (
        <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-muted/40 p-2 text-center">
          {post.likes != null && (
            <Metric icon={<ThumbsUp className="h-3 w-3" />} value={post.likes} label="J'aime" />
          )}
          {post.comments != null && (
            <Metric icon={<MessageSquare className="h-3 w-3" />} value={post.comments} label="Comm." />
          )}
          {post.shares != null && (
            <Metric icon={<Share2 className="h-3 w-3" />} value={post.shares} label="Partages" />
          )}
          {post.views != null && (
            <Metric icon={<Eye className="h-3 w-3" />} value={post.views} label="Vues" />
          )}
        </div>
      )}

      {/* AI summary + content angle */}
      {post.summary && (
        <div className="mt-3 rounded-lg border border-[color:var(--emerald-accent)]/30 bg-[color:var(--emerald-accent)]/5 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Pourquoi ça marche
          </p>
          <p className="mt-0.5 text-xs text-foreground text-pretty">{post.summary}</p>
        </div>
      )}
      {post.contentAngle && (
        <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
            <Lightbulb className="h-3 w-3" />
            Angle réutilisable
          </p>
          <p className="mt-0.5 text-xs text-foreground text-pretty">{post.contentAngle}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant={post.isSaved ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-9 gap-1.5",
            post.isSaved
              ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
              : ""
          )}
          onClick={onToggleSave}
        >
          <Bookmark className={cn("h-3.5 w-3.5", post.isSaved && "fill-current")} />
          {post.isSaved ? "Sauvegardé" : "Sauvegarder"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={onInspire}
          disabled={!!post.inspiredContentId}
        >
          {post.inspiredContentId ? (
            <Lightbulb className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {post.inspiredContentId ? "Idée créée" : "S'en inspirer"}
        </Button>
        {post.url && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            asChild
          >
            <a href={post.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Voir sur la plateforme
            </a>
          </Button>
        )}
      </div>
    </article>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
      </div>
      <p className="text-[11px] font-semibold tabular-nums text-foreground">
        {formatCompact(value)}
      </p>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

/* ───────────────────────── Create watch dialog ──────────────────────── */

function CreateWatchDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram"]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [sector, setSector] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [competitorInput, setCompetitorInput] = useState("");
  const [language, setLanguage] = useState("fr");
  const [submitting, setSubmitting] = useState(false);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function addKeyword() {
    const t = keywordInput.trim();
    if (!t) return;
    if (!keywords.includes(t)) setKeywords((prev) => [...prev, t]);
    setKeywordInput("");
  }
  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k));
  }
  function addCompetitor() {
    const t = competitorInput.trim().replace(/^@/, "");
    if (!t) return;
    if (!competitors.includes(t)) setCompetitors((prev) => [...prev, t]);
    setCompetitorInput("");
  }
  function removeCompetitor(c: string) {
    setCompetitors((prev) => prev.filter((x) => x !== c));
  }

  function reset() {
    setName("");
    setPlatforms(["instagram"]);
    setKeywords([]);
    setKeywordInput("");
    setSector("");
    setCompetitors([]);
    setCompetitorInput("");
    setLanguage("fr");
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Donnez un nom à votre veille");
      return;
    }
    if (platforms.length === 0) {
      toast.error("Sélectionnez au moins une plateforme");
      return;
    }
    if (keywords.length === 0) {
      toast.error("Ajoutez au moins un mot-clé");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/trends", {
        name: name.trim(),
        platforms,
        keywords,
        sector: sector.trim() || null,
        competitors,
        language,
      });
      toast.success("Veille créée", {
        description: "Lancez une première synchronisation pour découvrir des posts.",
      });
      reset();
      onCreated();
    } catch (e) {
      toast.error("Création échouée", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-[color:var(--emerald-accent)]" />
            Nouvelle veille
          </DialogTitle>
          <DialogDescription>
            Configurez les plateformes + mots-clés à surveiller. Make It
            découvre les contenus tendance et les enrichit pour vous.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="veille-name">Nom de la veille *</Label>
            <Input
              id="veille-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Mode Hiver · Instagram"
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Plateformes *</Label>
            <div className="flex flex-wrap gap-1.5">
              {VEILLE_PLATFORMS.map((p) => {
                const active = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                      active
                        ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                        : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                    )}
                  >
                    <PlatformDot platform={p as Platform} />
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="veille-keywords">Mots-clés *</Label>
            <div className="flex gap-2">
              <Input
                id="veille-keywords"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="ex. mode, hiver, promotion"
                className="h-11"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={addKeyword}
                disabled={!keywordInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((k) => (
                  <Badge
                    key={k}
                    variant="outline"
                    className="gap-1 border-border bg-card text-foreground"
                  >
                    <Hash className="h-3 w-3" />
                    {k}
                    <button
                      type="button"
                      onClick={() => removeKeyword(k)}
                      className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      aria-label={`Retirer ${k}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="veille-sector">Secteur</Label>
              <Input
                id="veille-sector"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="ex. Mode & Lifestyle"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="veille-language">Langue</Label>
              <select
                id="veille-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="es">Espagnol</option>
                <option value="de">Allemand</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="veille-competitors">Concurrents (handles)</Label>
            <div className="flex gap-2">
              <Input
                id="veille-competitors"
                value={competitorInput}
                onChange={(e) => setCompetitorInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCompetitor();
                  }
                }}
                placeholder="ex. @maison_x"
                className="h-11"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={addCompetitor}
                disabled={!competitorInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {competitors.map((c) => (
                  <Badge
                    key={c}
                    variant="outline"
                    className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
                  >
                    @{c}
                    <button
                      type="button"
                      onClick={() => removeCompetitor(c)}
                      className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-700/70 hover:bg-amber-100"
                      aria-label={`Retirer @${c}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            {submitting ? "Création…" : "Créer la veille"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Helpers ──────────────────────────────────── */

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}
