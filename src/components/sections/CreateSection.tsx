"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowLeft,
  Image as ImageIcon,
  Play,
  Type as TypeIcon,
  Film,
  GalleryHorizontalEnd,
  Smartphone,
  Megaphone,
  Dna,
  Wand2,
  Layers,
  Scissors,
  Trash2,
  Gauge,
  Volume2,
  Undo2,
  Redo2,
  Save,
  Download,
  Plus,
  RefreshCw,
  Pencil,
  Calendar,
  Palette,
  Upload,
  Link as LinkIcon,
  ChevronRight,
  WandSparkles,
  Clapperboard,
  Magnet,
  Send,
  Check,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformBadge, PlatformDot } from "@/components/shared/PlatformBadge";
import { AIBadge } from "@/components/shared/AIBadge";
import { GenerationProgress } from "@/components/shared/GenerationProgress";
import { useAppStore } from "@/store/app-store";
import { apiPost, apiGet, apiTry, ApiError } from "@/lib/api-client";
import { MontageEditor } from "@/components/sections/montage/MontageEditor";
import {
  styleDNA,
  atomizerExample,
  imageEditorTools,
  videoTimeline,
  PLATFORM_META,
  type Platform,
} from "@/lib/mock-data";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type Mode =
  | "home"
  | "text"
  | "image"
  | "video"
  | "carousel"
  | "story"
  | "ad"
  | "style"
  | "image-editor"
  | "video-editor"
  | "atomizer"
  | "multichannel"
  | "montage";

const MODE_LABELS: Record<Mode, string> = {
  home: "Studio",
  text: "Texte",
  image: "Image",
  video: "Vidéo",
  carousel: "Carrousel",
  story: "Story",
  ad: "Publicité",
  style: "Style DNA",
  "image-editor": "Éditeur image",
  "video-editor": "Éditeur vidéo",
  atomizer: "Atomiseur",
  multichannel: "Multicanal",
  montage: "Montage",
};

const PLATFORMS: Platform[] = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "whatsapp",
];

const TONES = ["Premium", "Conversationnel", "Expert", "Punchy"] as const;
const GOALS = ["Notoriété", "Engagement", "Ventes", "Prospects"] as const;
const RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
const STYLE_PRESETS = ["Premium", "Minimaliste", "Coloré", "Sombre", "Lumineux"] as const;
const VIDEO_DURATIONS = ["15s", "30s", "60s"] as const;

const IMG_THUMBS = [
  "from-rose-100 to-amber-100",
  "from-emerald-100 to-teal-100",
  "from-violet-100 to-rose-100",
  "from-amber-100 to-emerald-100",
];

const VIDEO_THUMB = "from-emerald-100 to-teal-100";

const FORMATS: {
  mode: Mode;
  emoji: string;
  title: string;
  subtitle: string;
  tone: string;
}[] = [
  { mode: "text", emoji: "✍️", title: "Texte", subtitle: "Post, légende, article, script", tone: "from-rose-100 to-amber-100" },
  { mode: "image", emoji: "🖼️", title: "Image", subtitle: "Visuel, illustration, mockup", tone: "from-emerald-100 to-teal-100" },
  { mode: "video", emoji: "🎬", title: "Vidéo", subtitle: "Reel, Short, pub vidéo", tone: "from-amber-100 to-rose-100" },
  { mode: "carousel", emoji: "🎠", title: "Carrousel", subtitle: "Slides storytelling", tone: "from-violet-100 to-rose-100" },
  { mode: "story", emoji: "📱", title: "Story", subtitle: "Vertical, stickers, CTA", tone: "from-teal-100 to-emerald-100" },
  { mode: "ad", emoji: "📢", title: "Publicité", subtitle: "Campagne sponsorisée", tone: "from-amber-100 to-violet-100" },
  { mode: "montage", emoji: "🎞️", title: "Montage", subtitle: "Canva/CapCut-style — images, vidéo, texte, filtres", tone: "from-violet-100 to-teal-100" },
];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function ModeShell({
  mode,
  onBack,
  children,
}: {
  mode: Mode;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm" aria-label="Fil d'Ariane">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-[36px]"
        >
          <ArrowLeft className="h-4 w-4" /> Studio
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-medium text-foreground">{MODE_LABELS[mode]}</span>
      </nav>
      {children}
    </div>
  );
}

function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors min-h-[40px]",
        active
          ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
          : "border-border bg-card text-foreground/80 hover:border-foreground/30 hover:bg-muted/60",
        className
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function PlatformRow({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => (
        <Chip key={p} active={value === p} onClick={() => onChange(p)}>
          <PlatformDot platform={p} />
          <span>{PLATFORM_META[p].label}</span>
        </Chip>
      ))}
    </div>
  );
}

function ChoiceRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o} active={value === o} onClick={() => onChange(o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}

function CreditLine({ estimated }: { estimated: number }) {
  const { creditsTotal, creditsUsed, wallet } = useAppStore();
  const remaining = wallet
    ? wallet.available
    : Math.max(0, creditsTotal - creditsUsed);
  const after = Math.max(0, remaining - estimated);
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="text-pretty text-muted-foreground">
        Cette génération devrait utiliser environ{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {estimated.toLocaleString("fr-FR")}
        </span>{" "}
        crédits. Solde actuel{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {remaining.toLocaleString("fr-FR")}
        </span>
        . Solde après génération ≈{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {after.toLocaleString("fr-FR")}
        </span>
        .
      </p>
    </div>
  );
}

// Pre-confirm an async generation. Calls POST /api/ai/estimate with the
// generation type + input, returns { estimated, available, sufficient,
// balanceAfter } so the UI can show "≈420 crédits, solde après ≈860" before
// the user accepts. Falls back to the local `fallback` when the API is down.
async function estimateGeneration(
  type: string,
  input: Record<string, unknown>,
  fallback: number
): Promise<{ estimated: number; available: number; sufficient: boolean; balanceAfter: number }> {
  try {
    return await apiPost("/api/ai/estimate", { type, ...input });
  } catch {
    const { wallet, creditsTotal, creditsUsed } = useAppStore.getState();
    const available = wallet ? wallet.available : Math.max(0, creditsTotal - creditsUsed);
    return {
      estimated: fallback,
      available,
      sufficient: available >= fallback,
      balanceAfter: Math.max(0, available - fallback),
    };
  }
}

// Kick off a real AI job. Returns the jobId (or null when the API is down —
// in that case the caller can fall back to the simulated overlay).
async function startAIJob(
  type: string,
  input: Record<string, unknown>
): Promise<{ jobId: string; estimated: number } | null> {
  try {
    const res = await apiPost<{ jobId: string; estimated: number }>(
      "/api/ai/generate",
      { type, ...input }
    );
    return res;
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) {
      toast.error("Crédits insuffisants", {
        description: "Rechargez votre solde pour lancer cette génération.",
      });
    } else {
      toast.error("Génération indisponible", {
        description: e instanceof Error ? e.message : "Réessayez plus tard.",
      });
    }
    return null;
  }
}

function GradientThumb({
  from,
  to,
  ratio,
  icon,
  label,
  className,
  onClick,
  active,
}: {
  from: string;
  to: string;
  ratio: string;
  icon?: React.ReactNode;
  label?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const ratioCls =
    ratio === "1:1"
      ? "aspect-square"
      : ratio === "4:5"
      ? "aspect-[4/5]"
      : ratio === "9:16"
      ? "aspect-[9/16]"
      : ratio === "16:9"
      ? "aspect-video"
      : "aspect-square";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "relative w-full overflow-hidden rounded-xl bg-gradient-to-br flex items-center justify-center",
        from,
        to,
        ratioCls,
        onClick && "cursor-pointer transition-transform hover:scale-[1.01]",
        active && "ring-2 ring-[color:var(--ink)] ring-offset-2 ring-offset-background",
        className
      )}
    >
      {icon ? (
        <div className="text-foreground/40 [&_svg]:h-8 [&_svg]:w-8">{icon}</div>
      ) : null}
      {label && (
        <span className="absolute bottom-2 left-2 rounded-md bg-white/70 px-2 py-0.5 text-[11px] font-medium text-foreground backdrop-blur-sm">
          {label}
        </span>
      )}
    </Tag>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {children}
    </div>
  );
}

function GenOverlay({
  open,
  steps,
  estimated,
  used,
  total,
  onDone,
  jobId,
  onOutput,
}: {
  open: boolean;
  steps: string[];
  estimated: number;
  used: number;
  total: number;
  onDone: () => void;
  jobId?: string;
  onOutput?: (output: unknown) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md">
        <GenerationProgress
          steps={steps}
          estimated={estimated}
          used={used}
          total={total}
          open={open}
          onDone={onDone}
          jobId={jobId}
          onOutput={onOutput}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export function CreateSection() {
  const { creditsTotal, creditsUsed, spendCredits, setActiveSection, wallet, createPrefill, setCreatePrefill } = useAppStore();
  const [mode, setMode] = useState<Mode>("home");

  // Shared generation state
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [genSteps, setGenSteps] = useState<string[]>([]);
  const [genEstimated, setGenEstimated] = useState(0);
  // Real job tracking — when set, the <GenOverlay> polls GET /api/jobs/[id]
  // and subscribes to the socket `job:progress`/`job:completed` events.
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [genOutput, setGenOutput] = useState<unknown>(null);
  // Style DNA — populated by POST /api/ai/style/analyze (real) or fallback mock.
  const [styleDna, setStyleDna] = useState<typeof styleDNA | null>(null);
  // Atomizer variants — populated by POST /api/atomizer (real) or fallback mock.
  const [atomVariants, setAtomVariants] = useState<typeof atomizerExample.variants | null>(null);

  // Idea (shared across "Décrire mon idée" + text mode)
  const [idea, setIdea] = useState("");

  // Text brief state
  const [textBrief, setTextBrief] = useState("");
  const [textPlatform, setTextPlatform] = useState<Platform>("instagram");
  const [textTone, setTextTone] = useState<(typeof TONES)[number]>("Premium");
  const [textGoal, setTextGoal] = useState<(typeof GOALS)[number]>("Engagement");

  // Image brief state
  const [imgMode, setImgMode] = useState<string>("Générer avec une description");
  const [imgDescription, setImgDescription] = useState("");
  const [imgRatio, setImgRatio] = useState<(typeof RATIOS)[number]>("1:1");
  const [imgStyle, setImgStyle] = useState<(typeof STYLE_PRESETS)[number]>("Premium");
  const [imgSelected, setImgSelected] = useState(0);

  // Video brief state
  const [vidDescription, setVidDescription] = useState("");
  const [vidDuration, setVidDuration] = useState<(typeof VIDEO_DURATIONS)[number]>("30s");
  const [vidStyle, setVidStyle] = useState<(typeof STYLE_PRESETS)[number]>("Premium");
  const [vidVoice, setVidVoice] = useState(true);
  const [vidCaptions, setVidCaptions] = useState(true);
  const [vidRatio, setVidRatio] = useState<"16:9" | "9:16">("9:16");

  // Carousel / Story / Ad state
  const [carouselSlides, setCarouselSlides] = useState<3 | 5 | 8>(3);
  const [storySticker, setStorySticker] = useState("Sondage");
  const [storyCta, setStoryCta] = useState("En savoir plus");
  const [adObjective, setAdObjective] = useState<"Messages" | "Ventes" | "Trafic">("Ventes");
  const [adBudget, setAdBudget] = useState(50);
  const [adAudience, setAdAudience] = useState<string[]>(["Femmes 25-40", "Urbaines"]);

  // Style DNA state
  const [styleTab, setStyleTab] = useState<"image" | "video" | "url">("image");
  const [styleUrl, setStyleUrl] = useState("");
  const [styleContent, setStyleContent] = useState("");

  // Atomizer state
  const [atomIdea, setAtomIdea] = useState(atomizerExample.idea);
  const [atomSelected, setAtomSelected] = useState<string[]>(
    atomizerExample.variants.map((v) => v.platform)
  );

  // Video editor state
  const [selectedClip, setSelectedClip] = useState<string>("v2");

  // Multichannel validation state
  const [validated, setValidated] = useState<Platform[]>([]);

  // Reset transient state when mode changes
  function goTo(next: Mode) {
    setMode(next);
    setGenerating(false);
    setGenerated(false);
    setGenSteps([]);
    setGenEstimated(0);
    setGenJobId(null);
    setGenOutput(null);
  }

  // Start a simulated generation overlay (the legacy behaviour, kept for the
  // editor modes that don't have a backend endpoint).
  function startGen(steps: string[], estimated: number) {
    setGenSteps(steps);
    setGenEstimated(estimated);
    setGenerated(false);
    setGenerating(true);
    setGenJobId(null);
    setGenOutput(null);
    spendCredits(estimated);
  }

  // Start a REAL generation: kicks off POST /api/ai/generate, then opens the
  // overlay with the returned jobId so the <GenerationProgress> polls the
  // real job. Falls back to the simulated flow when the API is unreachable.
  async function startRealGen(
    steps: string[],
    fallbackEstimated: number,
    type: string,
    input: Record<string, unknown>
  ) {
    // 1) Show the overlay immediately so the user gets feedback.
    setGenSteps(steps);
    setGenEstimated(fallbackEstimated);
    setGenerated(false);
    setGenerating(true);
    setGenJobId(null);
    setGenOutput(null);
    spendCredits(fallbackEstimated);
    // 2) Kick off the job in the background.
    const job = await startAIJob(type, input);
    if (job) {
      setGenJobId(job.jobId);
      setGenEstimated(job.estimated || fallbackEstimated);
    }
    // When job is null, the simulated overlay takes over (no jobId).
  }

  function onGenDone() {
    setGenerating(false);
    setGenerated(true);
    toast.success("Génération terminée", {
      description: `${genEstimated.toLocaleString("fr-FR")} crédits utilisés.`,
    });
    // Refresh the wallet so the credit meter reflects the real consumption.
    void refreshWalletSafe();
  }

  async function refreshWalletSafe() {
    try {
      const w = await apiGet<{
        subscriptionCredits: number;
        purchasedCredits: number;
        reservedCredits: number;
        totalConsumed: number;
        available: number;
      }>("/api/credits");
      useAppStore.getState().setWallet(w);
    } catch {
      /* ignore */
    }
  }

  // Auto-prefill text brief from idea
  useEffect(() => {
    if (mode === "text" && !textBrief && idea) setTextBrief(idea);
  }, [mode, textBrief, idea]);

  // Consume any pending createPrefill (e.g. dropped by the "S'en inspirer"
  // flow from the trends Veille) — set the idea + jump to text mode so the
  // user can immediately edit the inspired idea.
  useEffect(() => {
    if (!createPrefill) return;
    if (createPrefill.idea) {
      setIdea(createPrefill.idea);
      // Also prefill the text brief so the user sees the idea in the editor.
      setTextBrief(createPrefill.idea);
    }
    if (createPrefill.idea) {
      setMode("text");
      toast.success("Idée de contenu créée", {
        description: "Inspirez-vous de cette tendance pour votre prochain post.",
      });
    }
    // Clear the prefill so it doesn't re-apply on every mount.
    setCreatePrefill(null);
  }, [createPrefill]);

  return (
    <div className="space-y-8">
      {mode !== "home" && (
        <ModeShell mode={mode} onBack={() => goTo("home")}>
          {mode === "text" && renderText()}
          {mode === "image" && renderImage()}
          {mode === "video" && renderVideo()}
          {mode === "carousel" && renderCarousel()}
          {mode === "story" && renderStory()}
          {mode === "ad" && renderAd()}
          {mode === "style" && renderStyle()}
          {mode === "image-editor" && renderImageEditor()}
          {mode === "video-editor" && renderVideoEditor()}
          {mode === "atomizer" && renderAtomizer()}
          {mode === "multichannel" && renderMultichannel()}
          {mode === "montage" && <MontageEditor />}
        </ModeShell>
      )}

      {mode === "home" && renderHome()}

      <GenOverlay
        open={generating}
        steps={genSteps}
        estimated={genEstimated}
        used={creditsUsed}
        total={creditsTotal}
        onDone={onGenDone}
        jobId={genJobId ?? undefined}
        onOutput={(out) => {
          setGenOutput(out);
          // Style DNA / atomizer outputs land in their own state so the
          // result panel can render the real data.
          if (out && typeof out === "object") {
            const o = out as Record<string, unknown>;
            if (o.styleDNA || o.styleDna) {
              setStyleDna((o.styleDNA ?? o.styleDna) as typeof styleDNA);
            }
            if (o.variants && Array.isArray(o.variants)) {
              setAtomVariants(o.variants as typeof atomizerExample.variants);
            }
          }
        }}
      />
    </div>
  );

  // --------------------------------------------------------------------------
  // HOME
  // --------------------------------------------------------------------------

  function renderHome() {
    return (
      <div className="space-y-8">
        <section className="surface-hero bg-dotted p-6 sm:p-8">
          <SectionHeader
            eyebrow="Studio"
            title="Que voulez-vous créer ?"
            description="Décrivez simplement votre idée. Make It choisit le meilleur format, le rédige, l'illustre et l'adapte à vos plateformes."
            actions={
              <span className="hidden sm:inline-flex">
                <AIBadge label="Studio IA" />
              </span>
            }
          />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {FORMATS.map((f) => (
              <button
                key={f.mode}
                onClick={() => goTo(f.mode)}
                className="surface-card group flex flex-col items-start gap-3 p-5 text-left transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <span
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br text-xl",
                    f.tone
                  )}
                >
                  {f.emoji}
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-semibold text-foreground">
                    {f.title}
                  </span>
                  <span className="block text-xs text-muted-foreground text-pretty">
                    {f.subtitle}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="surface-card p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[color:var(--emerald-accent)]" />
            <h2 className="text-lg font-semibold">Décrire mon idée</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Écrivez en une phrase ce que vous voulez publier. Make It choisira le format idéal et le générera pour vous.
          </p>
          <div className="mt-4 space-y-3">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Expliquez simplement ce que vous voulez publier... ex: Je veux annoncer une réduction de 20% sur ma collection."
              className="min-h-[120px] resize-y text-base"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Astuce : plus votre idée est claire, meilleur est le résultat.
              </p>
              <Button
                onClick={() => {
                  if (!idea.trim()) {
                    toast.error("Décrivez d'abord votre idée.");
                    return;
                  }
                  goTo("text");
                }}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Make It crée
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => goTo("style")}
            className="surface-card flex items-center gap-4 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Dna className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-foreground">
                Copier un style (Style DNA)
              </span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Importez une référence, on extrait sa signature visuelle.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
          <button
            onClick={() => goTo("atomizer")}
            className="surface-card flex items-center gap-4 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Wand2 className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-foreground">
                Transformer 1 idée en plusieurs contenus
              </span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Un brief, 6 déclinaisons prêtes pour vos plateformes.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </section>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // TEXT
  // --------------------------------------------------------------------------

  function renderText() {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Texte"
          title="Générez votre copy"
          description="Le brief précis, le ton juste, le bon appel à l'action — déclinés par plateforme."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Brief panel */}
          <div className="surface-card space-y-5 p-6">
            <Field label="Mon idée" hint="éditable">
              <Textarea
                value={textBrief}
                onChange={(e) => setTextBrief(e.target.value)}
                placeholder="Expliquez ce que vous voulez publier..."
                className="min-h-[120px] resize-y"
              />
            </Field>
            <Field label="Plateforme">
              <PlatformRow value={textPlatform} onChange={setTextPlatform} />
            </Field>
            <Field label="Ton">
              <ChoiceRow options={TONES} value={textTone} onChange={setTextTone} />
            </Field>
            <Field label="Objectif">
              <ChoiceRow options={GOALS} value={textGoal} onChange={setTextGoal} />
            </Field>
            <Separator />
            <CreditLine estimated={420} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Analyse", "Concept", "Rédaction", "Optimisation", "Déclinaison"],
                    420,
                    "text",
                    {
                      idea: textBrief || idea,
                      platform: textPlatform,
                      objective: textGoal,
                      format: "post",
                    }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>

          {/* Result panel */}
          <div className="surface-soft space-y-4 p-6">
            {!generated ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <TypeIcon className="h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 max-w-xs text-pretty">
                  Lancez la génération pour voir votre copy apparaître ici, hook, corps, CTA et hashtags inclus.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={textPlatform} size="sm" />
                    <Badge variant="secondary" className="font-normal">{textTone}</Badge>
                    <Badge variant="secondary" className="font-normal">{textGoal}</Badge>
                  </div>
                  <AIBadge />
                </div>
                <div className="surface-card space-y-3 p-4 whitespace-pre-line">
                  <p className="text-base font-semibold text-foreground text-balance">
                    {textHook()}
                  </p>
                  <p className="text-sm text-foreground/80 text-pretty leading-relaxed">
                    {textBody()}
                  </p>
                  <p className="text-sm font-semibold text-[color:var(--emerald-accent)]">
                    {textCta()}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {textHashtags()}
                  </p>
                  {typeof genOutput === "string" && genOutput.length > 0 && (
                    <Separator />
                  )}
                  {typeof genOutput === "string" && genOutput.length > 0 && (
                    <p className="text-xs text-muted-foreground leading-relaxed text-pretty">
                      {genOutput}
                    </p>
                  )}
                  {genOutput !== null && typeof genOutput === "object" && (
                    <>
                      <Separator />
                      <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground leading-relaxed font-mono">
                        {JSON.stringify(genOutput, null, 2)}
                      </pre>
                    </>
                  )}
                </div>
                <ActionBar>
                  <Button variant="outline" className="min-h-[40px]">
                    <Wand2 className="h-4 w-4" /> Améliorer avec l'IA
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => goTo("multichannel")}
                    className="min-h-[40px]"
                  >
                    <Layers className="h-4 w-4" /> Décliner sur mes plateformes
                  </Button>
                </ActionBar>
                <Separator />
                <ActionBar>
                  <Button className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[40px]">
                    <Send className="h-4 w-4" /> Publier
                  </Button>
                  <Button variant="outline" onClick={() => setActiveSection("planning")} className="min-h-[40px]">
                    <Calendar className="h-4 w-4" /> Programmer
                  </Button>
                </ActionBar>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // IMAGE
  // --------------------------------------------------------------------------

  function renderImage() {
    const imgModes = [
      "Générer avec une description",
      "À partir de mon produit",
      "Améliorer une image",
      "Transformer une image",
      "Reproduire un style",
      "Créer un visuel de campagne",
    ];
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Image"
          title="Créez un visuel"
          description="Choisissez votre mode, décrivez l'ambiance, Make It génère 4 propositions."
        />
        <div className="flex flex-wrap gap-2">
          {imgModes.map((m) => (
            <Chip key={m} active={imgMode === m} onClick={() => setImgMode(m)}>
              {m}
            </Chip>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card space-y-5 p-6">
            <Field label="Description visuelle">
              <Textarea
                value={imgDescription}
                onChange={(e) => setImgDescription(e.target.value)}
                placeholder="Un visuel premium d'un nouveau produit, lumière douce, fond neutre..."
                className="min-h-[110px] resize-y"
              />
            </Field>
            <Field label="Format">
              <ChoiceRow options={RATIOS} value={imgRatio} onChange={setImgRatio} />
            </Field>
            <Field label="Style">
              <ChoiceRow options={STYLE_PRESETS} value={imgStyle} onChange={setImgStyle} />
            </Field>
            <Separator />
            <CreditLine estimated={350} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Analyse", "Concept", "Composition", "Génération", "Retouche"],
                    350,
                    "image",
                    { prompt: imgDescription || idea, size: "1024x1024", format: "image" }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>

          <div className="surface-soft space-y-4 p-6">
            {!generated ? (
              <div className="grid h-full min-h-[320px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    Vos 4 propositions apparaîtront ici. Sélectionnez-en une pour l'ouvrir dans l'éditeur.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {IMG_THUMBS.map((g, i) => (
                    <GradientThumb
                      key={i}
                      from={g.split(" ")[0]}
                      to={g.split(" ")[1]}
                      ratio={imgRatio}
                      icon={<ImageIcon />}
                      label={`Variante ${i + 1}`}
                      active={imgSelected === i}
                      onClick={() => setImgSelected(i)}
                    />
                  ))}
                </div>
                <div className="surface-card p-4">
                  <GradientThumb
                    from={IMG_THUMBS[imgSelected].split(" ")[0]}
                    to={IMG_THUMBS[imgSelected].split(" ")[1]}
                    ratio={imgRatio}
                    icon={<ImageIcon />}
                    label="Aperçu"
                  />
                  <ActionBar>
                    <Button
                      onClick={() => goTo("image-editor")}
                      className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[40px]"
                    >
                      <Pencil className="h-4 w-4" /> Ouvrir l'éditeur
                    </Button>
                    <Button variant="outline" className="min-h-[40px]">
                      <Download className="h-4 w-4" /> Exporter
                    </Button>
                  </ActionBar>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // VIDEO
  // --------------------------------------------------------------------------

  function renderVideo() {
    const quickActions = [
      { icon: <Clapperboard className="h-3.5 w-3.5" />, label: "Transformer en Reel" },
      { icon: <Scissors className="h-3.5 w-3.5" />, label: "Supprimer les moments faibles" },
      { icon: <Magnet className="h-3.5 w-3.5" />, label: "Améliorer le Hook" },
    ];
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Vidéo"
          title="Créez une vidéo"
          description="Décrivez le sujet, la durée, le style. Make It écrit, monte, ajoute sous-titres et voix-off."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card space-y-5 p-6">
            <Field label="De quoi parle la vidéo ?">
              <Textarea
                value={vidDescription}
                onChange={(e) => setVidDescription(e.target.value)}
                placeholder="Présentation de mon nouveau produit, ton dynamique, focalisation sur le bénéfice client..."
                className="min-h-[110px] resize-y"
              />
            </Field>
            <Field label="Durée">
              <ChoiceRow options={VIDEO_DURATIONS} value={vidDuration} onChange={setVidDuration} />
            </Field>
            <Field label="Style">
              <ChoiceRow options={STYLE_PRESETS} value={vidStyle} onChange={setVidStyle} />
            </Field>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={vidVoice} onCheckedChange={setVidVoice} /> Voix-off
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={vidCaptions} onCheckedChange={setVidCaptions} /> Sous-titres
              </label>
            </div>
            <Separator />
            <CreditLine estimated={680} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Brief", "Script", "Voix-off", "Storyboard", "Montage"],
                    680,
                    "text",
                    {
                      idea: vidDescription || idea,
                      platform: "tiktok",
                      objective: "engagement",
                      format: "reel",
                    }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>

          <div className="surface-soft space-y-4 p-6">
            {!generated ? (
              <div className="grid h-full min-h-[320px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Film className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    Votre vidéo (preview 9:16) apparaîtra ici, avec un bouton lecture.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mx-auto max-w-[260px]">
                  <GradientThumb
                    from={VIDEO_THUMB.split(" ")[0]}
                    to={VIDEO_THUMB.split(" ")[1]}
                    ratio="9:16"
                    icon={
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-foreground/80 shadow-lg">
                        <Play className="h-6 w-6 fill-current" />
                      </span>
                    }
                    label={vidDuration}
                  />
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickActions.map((q) => (
                    <Chip key={q.label} onClick={() => toast.success(q.label)}>
                      {q.icon}
                      {q.label}
                    </Chip>
                  ))}
                </div>
                <div className="surface-card p-4">
                  <ActionBar>
                    <Button
                      onClick={() => goTo("video-editor")}
                      className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[40px]"
                    >
                      <Film className="h-4 w-4" /> Ouvrir l'éditeur vidéo
                    </Button>
                    <Button variant="outline" className="min-h-[40px]">
                      <Download className="h-4 w-4" /> Exporter
                    </Button>
                  </ActionBar>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // CAROUSEL
  // --------------------------------------------------------------------------

  function renderCarousel() {
    const slides = carouselSlides;
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Carrousel"
          title="Créez un carrousel"
          description="Storytelling en slides, chaque slide se tient seule et complète la précédente."
        />
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="surface-card space-y-5 p-6">
            <Field label="Idée du carrousel">
              <Textarea
                defaultValue="3 choses à savoir avant d'acheter une pièce premium."
                className="min-h-[100px] resize-y"
              />
            </Field>
            <Field label="Nombre de slides">
              <ChoiceRow
                options={[3, 5, 8] as const}
                value={carouselSlides}
                onChange={setCarouselSlides}
              />
            </Field>
            <Field label="Style">
              <ChoiceRow options={STYLE_PRESETS} value={imgStyle} onChange={setImgStyle} />
            </Field>
            <Separator />
            <CreditLine estimated={540} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Concept", "Découpage", "Slides", "Visuels", "Optimisation"],
                    540,
                    "text",
                    { idea: idea, platform: "instagram", objective: "engagement", format: "carousel" }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>
          <div className="surface-soft space-y-4 p-6">
            {!generated ? (
              <div className="grid h-full min-h-[320px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <GalleryHorizontalEnd className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    Vos {slides} slides apparaîtront ici, chacune avec son visuel et son texte.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: slides }).map((_, i) => (
                  <div key={i} className="surface-card overflow-hidden">
                    <GradientThumb
                      from={IMG_THUMBS[i % IMG_THUMBS.length].split(" ")[0]}
                      to={IMG_THUMBS[i % IMG_THUMBS.length].split(" ")[1]}
                      ratio="1:1"
                    />
                    <div className="p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Slide {i + 1}
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground text-pretty">
                        {[
                          "Le hook",
                          "Le problème",
                          "La solution",
                          "La preuve",
                          "Le bénéfice",
                          "Le CTA",
                          "Bonus",
                          "Récap",
                        ][i] || "Slide"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STORY
  // --------------------------------------------------------------------------

  function renderStory() {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Story"
          title="Créez une story"
          description="Format vertical 9:16, stickers, sondages et CTA interactifs."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card space-y-5 p-6">
            <Field label="Message de la story">
              <Textarea
                defaultValue="On lance une nouveauté demain à 18h. Soyez les premiers 👀"
                className="min-h-[100px] resize-y"
              />
            </Field>
            <Field label="Sticker interactif">
              <ChoiceRow
                options={["Sondage", "Quiz", "Compteur", "Question", "Lien"]}
                value={storySticker}
                onChange={setStorySticker}
              />
            </Field>
            <Field label="Call-to-action">
              <ChoiceRow
                options={["En savoir plus", "Acheter", "S'abonner", "Réserver", "Link en bio"]}
                value={storyCta}
                onChange={setStoryCta}
              />
            </Field>
            <Separator />
            <CreditLine estimated={280} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Brief", "Visuel", "Sticker", "CTA", "Export"],
                    280,
                    "image",
                    { prompt: idea || "Story Instagram", size: "1080x1920", format: "story" }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>
          <div className="surface-soft grid place-items-center p-6">
            {!generated ? (
              <div className="grid h-full min-h-[420px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Smartphone className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    Aperçu vertical 9:16 de votre story avec sticker et CTA.
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative w-[260px]">
                <GradientThumb
                  from="from-rose-100"
                  to="to-violet-100"
                  ratio="9:16"
                  className="ring-1 ring-border"
                />
                <div className="absolute inset-0 flex flex-col justify-between p-4">
                  <div className="self-end rounded-full bg-white/70 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
                    {storySticker}
                  </div>
                  <div className="self-center rounded-xl bg-white/80 px-3 py-1.5 text-sm font-medium text-foreground backdrop-blur-sm">
                    👀 Nouveauté demain 18h
                  </div>
                  <button className="self-center rounded-full bg-[color:var(--ink)] px-4 py-2 text-xs font-semibold text-[color:var(--primary-foreground)]">
                    {storyCta}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // AD
  // --------------------------------------------------------------------------

  function renderAd() {
    const audiences = [
      "Femmes 25-40",
      "Urbaines",
      "Intéressées mode",
      "Acheteuses en ligne",
      "Abonnés concurrents",
    ];
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Publicité"
          title="Créez une publicité"
          description="Définissez l'objectif, le budget et l'audience. Make It génère le visuel et le copy."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card space-y-5 p-6">
            <Field label="Objectif">
              <ChoiceRow
                options={["Messages", "Ventes", "Trafic"] as const}
                value={adObjective}
                onChange={setAdObjective}
              />
            </Field>
            <Field label="Budget quotidien (€)">
              <div className="space-y-3">
                <Slider
                  value={[adBudget]}
                  min={5}
                  max={200}
                  step={5}
                  onValueChange={(v) => setAdBudget(v[0])}
                />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">5 €</span>
                  <span className="font-semibold tabular-nums">{adBudget} €/jour</span>
                  <span className="text-muted-foreground">200 €</span>
                </div>
              </div>
            </Field>
            <Field label="Audience">
              <div className="flex flex-wrap gap-2">
                {audiences.map((a) => {
                  const active = adAudience.includes(a);
                  return (
                    <Chip
                      key={a}
                      active={active}
                      onClick={() =>
                        setAdAudience((prev) =>
                          active ? prev.filter((x) => x !== a) : [...prev, a]
                        )
                      }
                    >
                      <Users className="h-3.5 w-3.5" />
                      {a}
                    </Chip>
                  );
                })}
              </div>
            </Field>
            <Separator />
            <CreditLine estimated={620} />
            <ActionBar>
              <Button
                onClick={() =>
                  startRealGen(
                    ["Brief", "Audience", "Visuel", "Copy", "Préview"],
                    620,
                    "text",
                    {
                      idea: idea,
                      platform: "facebook",
                      objective: "sales",
                      format: "ad",
                    }
                  )
                }
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>

          <div className="surface-soft space-y-4 p-6">
            {!generated ? (
              <div className="grid h-full min-h-[320px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    L'aperçu de votre publicité (visuel + copy) apparaîtra ici.
                  </p>
                </div>
              </div>
            ) : (
              <div className="surface-card overflow-hidden">
                <GradientThumb
                  from="from-amber-100"
                  to="to-violet-100"
                  ratio="1:1"
                  icon={<Megaphone />}
                />
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform="instagram" size="sm" />
                    <Badge variant="secondary" className="font-normal">Sponsorisé</Badge>
                    <Badge variant="secondary" className="font-normal">{adObjective}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground text-balance">
                    {textHook()}
                  </p>
                  <p className="text-sm text-foreground/80 text-pretty leading-relaxed">
                    {textBody()}
                  </p>
                  <button className="rounded-lg bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--primary-foreground)]">
                    {textCta()}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Budget estimé : <span className="font-semibold">{adBudget} €/jour</span> · portée estimée ≈{" "}
                    {(adBudget * 380).toLocaleString("fr-FR")} impressions / jour
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STYLE DNA
  // --------------------------------------------------------------------------

  function renderStyle() {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Style DNA"
          title="Copier un style"
          description="Importez une référence visuelle, Make It extrait sa signature esthétique puis génère une création originale qui s'en inspire."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card space-y-5 p-6">
            <Tabs value={styleTab} onValueChange={(v) => setStyleTab(v as typeof styleTab)}>
              <TabsList className="w-full justify-stretch">
                <TabsTrigger value="image" className="flex-1">
                  <ImageIcon className="h-3.5 w-3.5" /> Image
                </TabsTrigger>
                <TabsTrigger value="video" className="flex-1">
                  <Film className="h-3.5 w-3.5" /> Vidéo
                </TabsTrigger>
                <TabsTrigger value="url" className="flex-1">
                  <LinkIcon className="h-3.5 w-3.5" /> URL
                </TabsTrigger>
              </TabsList>
              <TabsContent value="image" className="mt-4">
                <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 p-4 text-center">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground text-pretty">
                    Importez une image ou déposez-la ici. PNG, JPG, WebP.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="video" className="mt-4">
                <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 p-4 text-center">
                  <Film className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground text-pretty">
                    Importez une vidéo courte (≤ 30s) ou collez un lien Reel/TikTok.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="url" className="mt-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    URL de la référence
                  </Label>
                  <Input
                    value={styleUrl}
                    onChange={(e) => setStyleUrl(e.target.value)}
                    placeholder="https://instagram.com/p/... ou lien direct"
                  />
                </div>
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground text-pretty">
              L'analyse reste locale à votre espace. Aucune référence n'est conservée sans votre accord.
            </p>
            <Separator />
            <CreditLine estimated={240} />
            <ActionBar>
              <Button
                onClick={async () => {
                  // First call POST /api/ai/style/analyze to get the StyleDNA job,
                  // then start the simulated overlay (the analyze endpoint is
                  // async — it returns a jobId that we poll via the overlay).
                  setGenSteps([
                    "Analyse visuelle",
                    "Extraction palette",
                    "Cadrage & lumière",
                    "Typographie",
                    "Rythme",
                  ]);
                  setGenEstimated(240);
                  setGenerated(false);
                  setGenerating(true);
                  setGenJobId(null);
                  setGenOutput(null);
                  spendCredits(240);
                  try {
                    const res = await apiPost<{ jobId: string; estimated?: number }>(
                      "/api/ai/style/analyze",
                      {
                        sourceType: styleTab,
                        sourceUrl: styleUrl || undefined,
                      }
                    );
                    if (res?.jobId) {
                      setGenJobId(res.jobId);
                      if (res.estimated) setGenEstimated(res.estimated);
                    }
                  } catch (e) {
                    toast.error("Analyse de style indisponible", {
                      description: e instanceof Error ? e.message : "Réessayez plus tard.",
                    });
                  }
                }}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Dna className="h-4 w-4" /> Analyser le style
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </ActionBar>
          </div>

          <div className="surface-soft space-y-5 p-6">
            {!generated ? (
              <div className="grid h-full min-h-[420px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Dna className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 max-w-xs text-pretty">
                    Le Style DNA de votre référence apparaîtra ici : mood, palette, composition, typographie et rythme.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Mood
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground text-balance">
                    {(styleDna ?? styleDNA).mood}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Palette
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(styleDna ?? styleDNA).palette.map((c) => (
                      <span
                        key={c}
                        className="h-10 w-10 rounded-full border border-border shadow-sm"
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StyleRow label="Composition" value={(styleDna ?? styleDNA).composition} />
                  <StyleRow label="Typographie" value={(styleDna ?? styleDNA).typography} />
                  <StyleRow label="Rythme" value={(styleDna ?? styleDNA).rhythm} />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tags
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(styleDna ?? styleDNA).tags.map((t) => (
                      <Badge key={t} variant="secondary" className="font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {generated && (
          <section className="surface-card space-y-5 p-6">
            <div className="flex items-center gap-2">
              <WandSparkles className="h-5 w-5 text-[color:var(--emerald-accent)]" />
              <h3 className="text-base font-semibold">Créer avec ce style</h3>
            </div>
            <p className="text-sm text-muted-foreground text-pretty">
              Décrivez votre propre contenu. Make It génère une création originale qui réutilise la palette, le cadrage et le rythme analysés.
            </p>
            <Textarea
              value={styleContent}
              onChange={(e) => setStyleContent(e.target.value)}
              placeholder="Mon nouveau visuel pour annoncer la collection Hiver..."
              className="min-h-[100px] resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CreditLine estimated={380} />
              <Button
                onClick={async () => {
                  // Try POST /api/ai/style/recreate with the styleDNA id from the
                  // analyze job output (if available). Falls back to /api/ai/generate
                  // type=image when there's no styleDNAId yet.
                  setGenSteps([
                    "Brief",
                    "Composition",
                    "Palette",
                    "Typographie",
                    "Rendu",
                  ]);
                  setGenEstimated(380);
                  setGenerated(false);
                  setGenerating(true);
                  setGenJobId(null);
                  setGenOutput(null);
                  spendCredits(380);
                  const styleDNAId =
                    genOutput && typeof genOutput === "object"
                      ? ((genOutput as Record<string, unknown>).styleDNAId ??
                        (genOutput as Record<string, unknown>).id ??
                        genJobId) as string | undefined
                      : (genJobId ?? undefined);
                  try {
                    if (styleDNAId) {
                      const res = await apiPost<{ jobId: string; estimated?: number }>(
                        "/api/ai/style/recreate",
                        { styleDNAId, brief: styleContent, format: "image" }
                      );
                      if (res?.jobId) {
                        setGenJobId(res.jobId);
                        if (res.estimated) setGenEstimated(res.estimated);
                      }
                    } else {
                      const job = await startAIJob("image", {
                        prompt: styleContent,
                        size: "1024x1024",
                        format: "image",
                      });
                      if (job) {
                        setGenJobId(job.jobId);
                        setGenEstimated(job.estimated || 380);
                      }
                    }
                  } catch (e) {
                    toast.error("Recréation indisponible", {
                      description: e instanceof Error ? e.message : "Réessayez plus tard.",
                    });
                  }
                  setTimeout(() => {
                    setStyleContent("");
                  }, 100);
                }}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {IMG_THUMBS.map((g, i) => (
                <GradientThumb
                  key={i}
                  from={g.split(" ")[0]}
                  to={g.split(" ")[1]}
                  ratio="1:1"
                  icon={<ImageIcon />}
                  label={`Style ${i + 1}`}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // IMAGE EDITOR
  // --------------------------------------------------------------------------

  function renderImageEditor() {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Studio · Éditeur image"
          title="Éditeur visuel"
          description="Retouchez, ajoutez du texte, des calques et des objets. Boostez avec l'IA."
        />
        {/* Top toolbar */}
        <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="Annuler">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Rétablir">
              <Redo2 className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button size="sm" className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90">
              <Sparkles className="h-3.5 w-3.5" /> Améliorer avec l'IA
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Save className="h-3.5 w-3.5" /> Enregistrer
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" /> Exporter
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_1fr_240px]">
          {/* Left toolbar */}
          <div className="surface-card max-h-[520px] overflow-y-auto p-3 scroll-premium">
            <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Outils
            </p>
            <div className="space-y-4">
              {imageEditorTools.map((group) => (
                <div key={group.group} className="space-y-1.5">
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {group.group}
                  </p>
                  {group.items.map((it) => (
                    <button
                      key={it}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground/80 hover:bg-muted"
                    >
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      {it}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Center canvas */}
          <div className="surface-soft relative grid place-items-center p-6 min-h-[520px]">
            <div className="relative w-full max-w-[420px]">
              <GradientThumb from="from-rose-100" to="to-amber-100" ratio="1:1" icon={<ImageIcon className="h-12 w-12" />} />
              {/* Layer chips overlaid */}
              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
                  Calque · Logo
                </span>
                <span className="rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
                  Calque · Texte
                </span>
              </div>
              <div className="absolute bottom-3 right-3">
                <span className="rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
                  1080 × 1080
                </span>
              </div>
            </div>
          </div>

          {/* Right properties */}
          <div className="surface-card space-y-4 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Propriétés
            </p>
            <Field label="Opacité">
              <Slider defaultValue={[100]} max={100} step={1} />
            </Field>
            <Field label="Rotation (°)">
              <Slider defaultValue={[0]} min={-180} max={180} step={1} />
            </Field>
            <Field label="Taille (%)">
              <Slider defaultValue={[80]} min={10} max={200} step={1} />
            </Field>
            <Separator />
            <Field label="Texte">
              <Input defaultValue="Nouvelle collection" />
            </Field>
            <Field label="Couleur">
              <div className="flex gap-2">
                {styleDNA.palette.map((c) => (
                  <span
                    key={c}
                    className="h-7 w-7 rounded-full border border-border"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // VIDEO EDITOR
  // --------------------------------------------------------------------------

  function renderVideoEditor() {
    const total = 17; // seconds
    const tracks = [
      { key: "video", label: "Vidéo", color: "bg-emerald-200 text-emerald-900", segments: videoTimeline.video },
      { key: "audio", label: "Audio", color: "bg-amber-200 text-amber-900", segments: videoTimeline.audio },
      { key: "text", label: "Texte", color: "bg-violet-200 text-violet-900", segments: videoTimeline.text },
      { key: "captions", label: "Sous-titres", color: "bg-rose-200 text-rose-900", segments: videoTimeline.captions },
    ] as const;

    const topActions = [
      { icon: <WandSparkles className="h-3.5 w-3.5" />, label: "Montage automatique" },
      { icon: <Clapperboard className="h-3.5 w-3.5" />, label: "Transformer en Reel" },
      { icon: <Scissors className="h-3.5 w-3.5" />, label: "Supprimer les moments faibles" },
      { icon: <Magnet className="h-3.5 w-3.5" />, label: "Améliorer le Hook" },
    ];

    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Studio · Éditeur vidéo"
          title="Éditeur vidéo"
          description="Montage marketing assisté. Timeline, transitions, hooks et adaptation Reel."
        />
        {/* Top toolbar */}
        <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {topActions.map((a) => (
              <Button
                key={a.label}
                variant="outline"
                size="sm"
                onClick={() => toast.success(a.label)}
                className="min-h-[36px]"
              >
                {a.icon}
                {a.label}
              </Button>
            ))}
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button variant="ghost" size="sm" aria-label="Couper">
              <Scissors className="h-4 w-4" /> Couper
            </Button>
            <Button variant="ghost" size="sm" aria-label="Supprimer">
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
            <Button variant="ghost" size="sm" aria-label="Vitesse">
              <Gauge className="h-4 w-4" /> Vitesse
            </Button>
            <Button variant="ghost" size="sm" aria-label="Volume">
              <Volume2 className="h-4 w-4" /> Volume
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Save className="h-3.5 w-3.5" /> Enregistrer
            </Button>
            <Button size="sm" className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> Exporter
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[200px_1fr_240px]">
          {/* Library */}
          <div className="surface-card max-h-[480px] overflow-y-auto p-3 scroll-premium">
            <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bibliothèque
            </p>
            <div className="space-y-2">
              {[
                "Intro · atelier",
                "Produit · gros plan",
                "Démo · geste main",
                "CTA · fin",
                "Musique · Lofi Premium",
                "Voix-off · FR",
              ].map((c, i) => (
                <button
                  key={c}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-card p-2 text-left text-xs hover:border-foreground/30"
                >
                  <span
                    className={cn(
                      "h-9 w-12 shrink-0 rounded-md bg-gradient-to-br",
                      IMG_THUMBS[i % IMG_THUMBS.length]
                    )}
                  />
                  <span className="flex-1 text-foreground/80">{c}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Preview + timeline */}
          <div className="space-y-3">
            <div className="surface-soft grid place-items-center p-4">
              <div className="flex items-center justify-end gap-2 pb-3" style={{ width: "100%" }}>
                <ChoiceRow
                  options={["16:9", "9:16"] as const}
                  value={vidRatio}
                  onChange={setVidRatio}
                />
              </div>
              <div className="w-full max-w-[420px]">
                <GradientThumb
                  from={VIDEO_THUMB.split(" ")[0]}
                  to={VIDEO_THUMB.split(" ")[1]}
                  ratio={vidRatio}
                  icon={
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-foreground/80 shadow-lg">
                      <Play className="h-6 w-6 fill-current" />
                    </span>
                  }
                />
              </div>
            </div>

            {/* Timeline */}
            <div className="surface-card space-y-2 p-3">
              {/* Ruler */}
              <div className="relative h-6 w-full">
                <div className="absolute inset-0 flex items-end justify-between text-[10px] text-muted-foreground">
                  {Array.from({ length: total + 1 }).map((_, i) => (
                    <span key={i} className="flex flex-col items-center gap-0.5">
                      <span className="h-2 w-px bg-border" />
                      <span>{i}s</span>
                    </span>
                  ))}
                </div>
              </div>
              {/* Tracks */}
              <div className="relative space-y-1.5">
                {tracks.map((t) => (
                  <div key={t.key} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[11px] font-medium text-muted-foreground">
                      {t.label}
                    </span>
                    <div className="relative h-8 flex-1 rounded-md bg-muted/60">
                      {t.segments.map((s) => {
                        const left = (s.start / total) * 100;
                        const width = (s.duration / total) * 100;
                        const isSel = t.key === "video" && s.id === selectedClip;
                        return (
                          <button
                            key={s.id}
                            onClick={() => t.key === "video" && setSelectedClip(s.id)}
                            className={cn(
                              "absolute top-1 flex h-6 items-center rounded px-2 text-[10px] font-medium truncate",
                              t.color,
                              isSel && "ring-2 ring-[color:var(--ink)]"
                            )}
                            style={{ left: `${left}%`, width: `${width}%` }}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {/* Transitions row */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="w-16 shrink-0 text-[11px] font-medium text-muted-foreground">
                    Transitions
                  </span>
                  <div className="relative h-5 flex-1">
                    {videoTimeline.transitions.map((tr) => (
                      <span
                        key={tr.id}
                        className="absolute top-1 inline-flex h-3 w-3 rotate-45 items-center justify-center bg-[color:var(--emerald-accent)]"
                        style={{ left: `calc(${(tr.at / total) * 100}% - 6px)` }}
                        title={tr.kind}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Properties */}
          <div className="surface-card space-y-4 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Clip sélectionné
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {videoTimeline.video.find((v) => v.id === selectedClip)?.label || "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {videoTimeline.video.find((v) => v.id === selectedClip)?.duration}s · vidéo
              </p>
            </div>
            <Field label="Volume">
              <Slider defaultValue={[80]} max={100} />
            </Field>
            <Field label="Vitesse">
              <Slider defaultValue={[100]} min={25} max={200} step={5} />
            </Field>
            <Field label="Filtre">
              <div className="flex flex-wrap gap-2">
                {["Aucun", "Chaud", "Froid", "Vintage"].map((f, i) => (
                  <Chip key={f} active={i === 0}>
                    {f}
                  </Chip>
                ))}
              </div>
            </Field>
            <Separator />
            <Button variant="outline" size="sm" className="w-full">
              <Plus className="h-3.5 w-3.5" /> Ajouter une transition
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ATOMIZER
  // --------------------------------------------------------------------------

  function renderAtomizer() {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Atomiseur"
          title="Transformer 1 idée en plusieurs contenus"
          description="Un brief, 6 déclinaisons adaptées à chaque plateforme. Cochez, générez, publiez."
        />
        <div className="surface-card space-y-4 p-6">
          <Field label="Votre idée">
            <Textarea
              value={atomIdea}
              onChange={(e) => setAtomIdea(e.target.value)}
              className="min-h-[100px] resize-y"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CreditLine estimated={320} />
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  // POST /api/atomizer is async — it returns a jobId that we
                  // poll via the overlay.
                  setGenSteps([
                    "Analyse",
                    "Déclinaison",
                    "Hooks",
                    "Tons",
                    "Formats",
                  ]);
                  setGenEstimated(320);
                  setGenerated(false);
                  setGenerating(true);
                  setGenJobId(null);
                  setGenOutput(null);
                  spendCredits(320);
                  try {
                    const res = await apiPost<{ jobId: string; estimated?: number }>(
                      "/api/atomizer",
                      {
                        idea: atomIdea,
                        platforms: atomSelected,
                        objective: "engagement",
                      }
                    );
                    if (res?.jobId) {
                      setGenJobId(res.jobId);
                      if (res.estimated) setGenEstimated(res.estimated);
                    }
                  } catch (e) {
                    toast.error("Atomiseur indisponible", {
                      description: e instanceof Error ? e.message : "Réessayez plus tard.",
                    });
                  }
                }}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Wand2 className="h-4 w-4" /> Atomiser
              </Button>
              <Button variant="outline" onClick={() => goTo("home")} className="min-h-[44px]">
                Annuler
              </Button>
            </div>
          </div>
        </div>

        {generated && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(atomVariants ?? atomizerExample.variants).map((v) => {
                const platform = (v.platform as Platform) ?? "instagram";
                const sel = atomSelected.includes(platform);
                return (
                  <div
                    key={platform}
                    className={cn(
                      "surface-card p-4 transition-all",
                      sel && "ring-1 ring-[color:var(--ink)]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <PlatformBadge platform={platform} size="sm" />
                      <button
                        onClick={() =>
                          setAtomSelected((prev) =>
                            sel ? prev.filter((x) => x !== platform) : [...prev, platform]
                          )
                        }
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                          sel
                            ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                            : "border-border bg-card"
                        )}
                        aria-pressed={sel}
                        aria-label={sel ? "Désélectionner" : "Sélectionner"}
                      >
                        {sel && <Check className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {v.format}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground text-balance">
                      {v.hook}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="font-normal">
                        {v.tone}
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        {v.length}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="surface-accent flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-semibold">
                  {atomSelected.length} format{atomSelected.length > 1 ? "s" : ""} sélectionné{atomSelected.length > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-[color:var(--accent-foreground)]/80">
                  Make It va générer chaque variation adaptée à sa plateforme.
                </p>
              </div>
              <Button
                onClick={() => goTo("multichannel")}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" /> Générer les formats sélectionnés
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // MULTICHANNEL
  // --------------------------------------------------------------------------

  function renderMultichannel() {
    const notes: Record<Platform, string> = {
      instagram: "Version premium visuelle, hook fort + CTA engageant.",
      facebook: "Version conversationnelle, plus narrative.",
      linkedin: "Version experte, angle pro et preuve.",
      tiktok: "Hook + script vidéo 30s, rythme rapide.",
      youtube: "Démo verticale 60s pour Shorts.",
      whatsapp: "Version directe orientée conversion, ultra-courte.",
      google: "Annonce search concise avec CTA.",
    };
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Studio · Multicanal"
          title="Make It adapte ce contenu à vos plateformes"
          description="Une idée, six variantes adaptées. Validez, publiez ou programmez en une action."
        />

        {/* Tree visualization */}
        <div className="surface-card overflow-x-auto p-6">
          <pre className="text-sm leading-relaxed text-foreground/80 font-mono">
            <span className="font-semibold text-foreground">ORIGINAL</span>
            {"\n│"}
            {PLATFORMS.map((p, i) => {
              const isLast = i === PLATFORMS.length - 1;
              const ok = validated.includes(p);
              return `${isLast ? "└── " : "├── "}${PLATFORM_META[p].label} ${ok ? "✓" : "○"}\n`;
            }).join("")}
          </pre>
        </div>

        {/* Variants */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => (
            <PlatformVariantCard
              key={p}
              platform={p}
              note={notes[p]}
              validated={validated.includes(p)}
              onValidate={() =>
                setValidated((prev) =>
                  prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                )
              }
              onRegen={() => {
                spendCredits(60);
                toast.success(`Variante ${PLATFORM_META[p].label} régénérée`, {
                  description: "60 crédits utilisés.",
                });
              }}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="surface-accent flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold">
              Publier sur {PLATFORMS.length} plateformes en une action
            </p>
            <p className="text-xs text-[color:var(--accent-foreground)]/80 text-pretty">
              {validated.length}/{PLATFORMS.length} variantes validées. Les variantes non validées seront publiées en brouillon.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => toast.success("Publications envoyées", { description: `${PLATFORMS.length} plateformes · ${validated.length} validées` })}
              className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 min-h-[44px]"
            >
              <Send className="h-4 w-4" /> Publier maintenant
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveSection("planning")}
              className="min-h-[44px] border-[color:var(--accent-foreground)]/30 bg-white/60 text-[color:var(--accent-foreground)] hover:bg-white/80"
            >
              <Calendar className="h-4 w-4" /> Programmer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Sample copy builders
  // --------------------------------------------------------------------------

  function textHook(): string {
    if (idea && idea.toLowerCase().includes("réduction")) {
      return "🔥 -20% sur toute la collection, dès aujourd'hui.";
    }
    return "Le voilà enfin ✨";
  }
  function textBody(): string {
    if (idea && idea.toLowerCase().includes("réduction")) {
      return "Pendant 72h, profitez de -20% sur notre nouvelle collection. Des pièces premium pensées pour durer, à un prix exceptionnel. Stock limité.";
    }
    return "On a gardé le meilleur pour la fin. Notre nouveau produit arrive, conçu pour celles et ceux qui veulent du beau, du durable et du simple.";
  }
  function textCta(): string {
    if (textGoal === "Ventes") return "J'en profite →";
    if (textGoal === "Prospects") return "Recevoir le guide";
    if (textGoal === "Notoriété") return "Voir la collection";
    return "Réagir 👇";
  }
  function textHashtags(): string {
    return "#MakeIt #NouvelleCollection #StylePremium #AtelierLumiere #ModeDurable";
  }
}

// ----------------------------------------------------------------------------
// Inline subcomponents
// ----------------------------------------------------------------------------

function StyleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground text-pretty">{value}</p>
    </div>
  );
}

function PlatformVariantCard({
  platform,
  note,
  validated,
  onValidate,
  onRegen,
}: {
  platform: Platform;
  note: string;
  validated: boolean;
  onValidate: () => void;
  onRegen: () => void;
}) {
  return (
    <div className="surface-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <PlatformBadge platform={platform} size="sm" />
        {validated && (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {/* Mini mock post */}
      <div className="surface-soft space-y-2 p-3">
        <p className="text-sm font-semibold text-foreground text-balance">
          {platform === "linkedin"
            ? "9 mois de R&D, voici le résultat."
            : platform === "tiktok"
            ? "POV : tu découvres notre nouveau produit 👀"
            : "Le voilà enfin ✨"}
        </p>
        <p className="text-xs text-foreground/70 text-pretty leading-relaxed">
          {platform === "whatsapp"
            ? "Notre nouveau produit est dispo. Réponds OUI pour le découvrir en avant-première."
            : platform === "youtube"
            ? "Démo verticale en 60s : le produit, le bénéfice, le CTA."
            : "Une pièce premium, pensée pour durer. Dispo dès maintenant."}
        </p>
        <p className="text-xs font-semibold text-[color:var(--emerald-accent)]">
          {platform === "whatsapp" ? "Réponds OUI →" : "J'en profite →"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground text-pretty">{note}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" size="sm" className="min-h-[36px]">
          <Pencil className="h-3.5 w-3.5" /> Modifier
        </Button>
        <Button variant="outline" size="sm" onClick={onRegen} className="min-h-[36px]">
          <RefreshCw className="h-3.5 w-3.5" /> Regénérer
        </Button>
        <Button
          size="sm"
          onClick={onValidate}
          className={cn(
            "min-h-[36px]",
            validated
              ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
              : "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          )}
        >
          <Check className="h-3.5 w-3.5" /> {validated ? "Validé" : "Valider"}
        </Button>
      </div>
    </div>
  );
}
