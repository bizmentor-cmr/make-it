"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Globe,
  MapPin,
  Plus,
  Sparkles,
  Type,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useAppStore } from "@/store/app-store";
import { brandProfile } from "@/lib/mock-data";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Brand / "Ma marque"                                                        */
/*  Identity & guidelines hub. Make It respects your colors, voice, audience. */
/* -------------------------------------------------------------------------- */

const TONE_SAMPLES: { label: string; text: string }[] = [
  { label: "Accroche", text: "Le savoir-faire qui transforme vos matières premières en objets rares." },
  { label: "Storytelling", text: "Derrière chaque pièce, des heures de travail et une obsession : la justesse." },
  { label: "CTA", text: "Découvrez la nouvelle collection, en édition limitée." },
];

const AUDIENCE_ICONS = ["🧳", "🎨", "🛍️"];

const REFERENCE_TILES = [
  { label: "Logo principal", grad: "from-zinc-100 to-zinc-200", emoji: "✦" },
  { label: "Logo secondaire", grad: "from-emerald-100 to-teal-100", emoji: "✦" },
  { label: "Photo atelier", grad: "from-amber-100 to-rose-100", emoji: "📷" },
  { label: "Photo produit", grad: "from-rose-100 to-violet-100", emoji: "🖼️" },
];

// ─── API types ─────────────────────────────────────────────────────────────
type BrandProfileApi = {
  id?: string;
  businessName: string | null;
  description?: string | null;
  industry?: string | null;
  website?: string | null;
  country?: string | null;
  language?: string | null;
  timezone?: string | null;
  targetMarket?: string | null;
  positioning?: string | null;
  valueProposition?: string | null;
  objectives?: string[];
};

type BrandIdentityApi = {
  id?: string;
  colors: string[];
  fonts: string[];
  logoUrl?: string | null;
  visualStyle?: string | null;
  imageryStyle?: string | null;
};

type BrandVoiceApi = {
  id?: string;
  tone: string | null;
  personality?: string | null;
  vocabulary?: string[];
  formality?: string | null;
  humor?: string | null;
  localExpressions?: string[];
};

type BrandRulesApi = {
  id?: string;
  topicsToPromote: string[];
  topicsToAvoid: string[];
  wordsToUse: string[];
  wordsToAvoid: string[];
  claims: string[];
  ctaPreferences: string[];
};

type BrandResponse = {
  profile: BrandProfileApi | null;
  identity: BrandIdentityApi | null;
  voice: BrandVoiceApi | null;
  rules: BrandRulesApi | null;
};

// Normalized UI shape — mirrors the original mock `brandProfile`.
type BrandUi = {
  name: string;
  sector: string;
  country: string;
  website: string;
  colors: string[];
  fonts: string[];
  voice: string;
  audiences: string[];
  guidelines: string[];
};

function toBrandUi(b: BrandResponse | null): BrandUi {
  // Fall back to the mock for any missing piece so the UI never breaks.
  const profile = b?.profile;
  const identity = b?.identity;
  const voice = b?.voice;
  const rules = b?.rules;

  // Target market is a free-form text field on the backend; split on commas
  // (or bullets) to rebuild the audience list. If empty, keep the mock.
  const targetMarket = profile?.targetMarket?.trim();
  const audiencesFromApi = targetMarket
    ? targetMarket
        .split(/[,;•\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Guidelines (charte) — combine the rule lists into a flat checklist.
  const guidelinesFromApi: string[] = [];
  if (rules) {
    if (rules.topicsToPromote?.length)
      guidelinesFromApi.push(
        ...rules.topicsToPromote.map((t) => `Promouvoir : ${t}`)
      );
    if (rules.topicsToAvoid?.length)
      guidelinesFromApi.push(
        ...rules.topicsToAvoid.map((t) => `À éviter : ${t}`)
      );
    if (rules.wordsToUse?.length)
      guidelinesFromApi.push(
        ...rules.wordsToUse.map((t) => `Mots à utiliser : ${t}`)
      );
    if (rules.wordsToAvoid?.length)
      guidelinesFromApi.push(
        ...rules.wordsToAvoid.map((t) => `Mots à éviter : ${t}`)
      );
    if (rules.ctaPreferences?.length)
      guidelinesFromApi.push(
        ...rules.ctaPreferences.map((t) => `CTA privilégié : ${t}`)
      );
    if (rules.claims?.length)
      guidelinesFromApi.push(...rules.claims.map((t) => `Promesse : ${t}`));
  }

  return {
    name: profile?.businessName ?? brandProfile.name,
    sector:
      profile?.industry && profile.industry.trim().length > 0
        ? profile.industry
        : brandProfile.sector,
    country:
      profile?.country && profile.country.trim().length > 0
        ? profile.country
        : brandProfile.country,
    website:
      profile?.website && profile.website.trim().length > 0
        ? profile.website
        : brandProfile.website,
    colors:
      identity?.colors && identity.colors.length > 0
        ? identity.colors
        : brandProfile.colors,
    fonts:
      identity?.fonts && identity.fonts.length > 0
        ? identity.fonts
        : brandProfile.fonts,
    voice:
      voice?.tone && voice.tone.trim().length > 0 ? voice.tone : brandProfile.voice,
    audiences:
      audiencesFromApi.length > 0 ? audiencesFromApi : brandProfile.audiences,
    guidelines:
      guidelinesFromApi.length > 0 ? guidelinesFromApi : brandProfile.guidelines,
  };
}

export function BrandSection() {
  const { setAdvisorOpen, setActiveSection } = useAppStore();
  const [swatchHover, setSwatchHover] = useState<number | null>(null);
  const [brand, setBrand] = useState<BrandUi>({
    name: brandProfile.name,
    sector: brandProfile.sector,
    country: brandProfile.country,
    website: brandProfile.website,
    colors: brandProfile.colors,
    fonts: brandProfile.fonts,
    voice: brandProfile.voice,
    audiences: brandProfile.audiences,
    guidelines: brandProfile.guidelines,
  });
  const [raw, setRaw] = useState<BrandResponse | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry(
        async () => apiGet<BrandResponse>("/api/brand"),
        null as BrandResponse | null
      );
      if (cancelled) return;
      setRaw(res);
      setBrand(toBrandUi(res));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Mutations ─────────────────────────────────────────────────────────
  async function saveProfile() {
    if (savingKey) return;
    setSavingKey("profile");
    try {
      const audiences = brand.audiences.join(", ");
      await apiPost("/api/brand/profile", {
        businessName: brand.name,
        industry: brand.sector,
        country: brand.country,
        website: brand.website,
        language: "fr",
        timezone: "Europe/Paris",
        targetMarket: audiences,
        positioning: null,
        valueProposition: null,
        objectives: [],
      });
      toast.success("Identité mise à jour", {
        description: "Le profil de marque a été enregistré.",
      });
      // Refresh the merged brand object so the UI reflects the saved state.
      const fresh = await apiTry(
        async () => apiGet<BrandResponse>("/api/brand"),
        null as BrandResponse | null
      );
      setRaw(fresh);
      setBrand(toBrandUi(fresh));
    } catch (e) {
      toast.error("Échec de l'enregistrement", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function saveIdentity() {
    if (savingKey) return;
    setSavingKey("identity");
    try {
      await apiPost("/api/brand/identity", {
        colors: brand.colors,
        fonts: brand.fonts,
        logoUrl: raw?.identity?.logoUrl ?? null,
        visualStyle: raw?.identity?.visualStyle ?? null,
        imageryStyle: raw?.identity?.imageryStyle ?? null,
      });
      toast.success("Identité mise à jour", {
        description: "Palette et typographies enregistrées.",
      });
    } catch (e) {
      toast.error("Échec de l'enregistrement", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function saveVoice() {
    if (savingKey) return;
    setSavingKey("voice");
    try {
      await apiPost("/api/brand/voice", {
        tone: brand.voice,
        personality: raw?.voice?.personality ?? null,
        vocabulary: raw?.voice?.vocabulary ?? [],
        formality: raw?.voice?.formality ?? null,
        humor: raw?.voice?.humor ?? null,
        localExpressions: raw?.voice?.localExpressions ?? [],
      });
      toast.success("Identité mise à jour", {
        description: "Le ton de voix a été enregistré.",
      });
    } catch (e) {
      toast.error("Échec de l'enregistrement", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function saveRules() {
    if (savingKey) return;
    setSavingKey("rules");
    try {
      // Re-derive the rules lists from the current guidelines so the charte
      // remains editable in a backward-compatible way.
      const topicsToPromote: string[] = [];
      const topicsToAvoid: string[] = [];
      const wordsToUse: string[] = [];
      const wordsToAvoid: string[] = [];
      const claims: string[] = [];
      const ctaPreferences: string[] = [];
      for (const g of brand.guidelines) {
        if (g.startsWith("Promouvoir : ")) topicsToPromote.push(g.slice(13));
        else if (g.startsWith("À éviter : ")) topicsToAvoid.push(g.slice(10));
        else if (g.startsWith("Mots à utiliser : ")) wordsToUse.push(g.slice(18));
        else if (g.startsWith("Mots à éviter : ")) wordsToAvoid.push(g.slice(15));
        else if (g.startsWith("CTA privilégié : ")) ctaPreferences.push(g.slice(16));
        else if (g.startsWith("Promesse : ")) claims.push(g.slice(11));
        else topicsToPromote.push(g);
      }
      await apiPost("/api/brand/rules", {
        topicsToPromote,
        topicsToAvoid,
        wordsToUse,
        wordsToAvoid,
        claims,
        ctaPreferences,
      });
      toast.success("Identité mise à jour", {
        description: "La charte de marque a été enregistrée.",
      });
    } catch (e) {
      toast.error("Échec de l'enregistrement", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Identité"
        title="Ma marque"
        description="Make It respecte votre identité dans chaque création. Vos couleurs, votre ton, vos audiences."
        actions={
          <Button
            size="lg"
            className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            onClick={saveProfile}
            disabled={savingKey === "profile"}
          >
            {savingKey === "profile" ? "Enregistrement…" : "Modifier"}
          </Button>
        }
      />

      {/* ---------- Brand hero ---------- */}
      <section className="surface-hero bg-dotted p-6 md:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Marque
              </p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight text-foreground text-balance">
                {brand.name}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-[color:var(--emerald-accent)]" />
                {brand.sector}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {brand.country}
              </span>
              <a
                href={`https://${brand.website}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-[color:var(--emerald-accent)] hover:shadow-sm"
              >
                <Globe className="h-3.5 w-3.5" />
                {brand.website}
              </a>
            </div>
          </div>

          {/* Color swatches as big circles */}
          <div className="flex flex-wrap items-end gap-4">
            {brand.colors.map((c, i) => (
              <div
                key={`${c}-${i}`}
                className="flex flex-col items-center gap-2"
                onMouseEnter={() => setSwatchHover(i)}
                onMouseLeave={() => setSwatchHover(null)}
              >
                <div
                  className="h-14 w-14 rounded-full ring-1 ring-black/5 shadow-sm transition-transform hover:scale-105"
                  style={{ background: c }}
                  aria-label={`Couleur ${c}`}
                />
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums transition-opacity",
                    swatchHover === i ? "text-foreground opacity-100" : "text-muted-foreground opacity-70"
                  )}
                >
                  {c.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Fonts chips with preview letter */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Type className="h-4 w-4" /> Typographies
          </span>
          {brand.fonts.map((font, i) => (
            <span
              key={`${font}-${i}`}
              className={cn(
                "inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium",
                i === 1 && "font-serif"
              )}
            >
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--ink)] text-base font-semibold text-[color:var(--primary-foreground)]",
                  i === 1 && "font-serif"
                )}
              >
                {font.charAt(0)}
              </span>
              {font}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- 3-col grid: Palette / Ton / Audiences ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Palette card */}
        <div className="surface-card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">🎨 Palette</h3>
            <span className="text-xs text-muted-foreground">{brand.colors.length} couleurs</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {brand.colors.map((c, i) => (
              <div key={`${c}-${i}`} className="group">
                <div
                  className="aspect-square rounded-xl ring-1 ring-black/5 shadow-sm transition-transform group-hover:scale-105"
                  style={{ background: c }}
                />
                <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {c.toUpperCase()}
                </p>
              </div>
            ))}
            <button
              type="button"
              className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[color:var(--emerald-accent)] hover:text-[color:var(--emerald-accent)]"
              onClick={() => setAdvisorOpen(true)}
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Ton de voix card */}
        <div className="surface-card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">✍️ Ton de voix</h3>
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">{brand.voice}</p>
          <div className="mt-4 space-y-2.5">
            {TONE_SAMPLES.map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-1 text-sm text-foreground text-pretty">{s.text}</p>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={saveVoice}
            disabled={savingKey === "voice"}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {savingKey === "voice" ? "Enregistrement…" : "Ajuster le ton"}
          </Button>
        </div>

        {/* Audiences card */}
        <div className="surface-card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">👥 Audiences</h3>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            {brand.audiences.map((aud, i) => (
              <div
                key={`${aud}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-card text-lg shadow-sm">
                  {AUDIENCE_ICONS[i % AUDIENCE_ICONS.length]}
                </span>
                <span className="text-sm font-medium text-foreground">{aud}</span>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full text-[color:var(--emerald-accent)] hover:text-[color:var(--emerald-accent)]"
            onClick={saveProfile}
            disabled={savingKey === "profile"}
          >
            + Ajouter une audience
          </Button>
        </div>
      </div>

      {/* ---------- Charte (guidelines checklist) ---------- */}
      <section className="surface-soft p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">📋 Charte</h3>
            <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
              Vos règles de marque, appliquées automatiquement à chaque création.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={saveRules}
            disabled={savingKey === "rules"}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {savingKey === "rules" ? "Enregistrement…" : "Enrichir avec l'IA"}
          </Button>
        </div>
        <ul className="mt-5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {brand.guidelines.map((g, i) => (
            <li
              key={`${g.slice(0, 32)}-${i}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--emerald-accent)]">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm text-foreground text-pretty">{g}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Contenus de référence ---------- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Contenus de référence</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-[color:var(--emerald-accent)] hover:text-[color:var(--emerald-accent)]"
            onClick={saveIdentity}
            disabled={savingKey === "identity"}
          >
            <Plus className="h-3.5 w-3.5" /> {savingKey === "identity" ? "Ajout…" : "Ajouter"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {REFERENCE_TILES.map((t) => (
            <div
              key={t.label}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-xl border border-border bg-gradient-to-br shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md",
                t.grad
              )}
            >
              <div className="absolute inset-0 flex items-center justify-center text-3xl opacity-50 transition-transform group-hover:scale-110">
                {t.emoji}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/10 to-transparent px-3 py-2">
                <span className="text-xs font-medium text-foreground">{t.label}</span>
                <Upload className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Bottom recommendation ---------- */}
      <RecommendationCard
        icon={<Check className="h-4 w-4" />}
        title="Votre identité est cohérente sur 4 réseaux. Ajoutez un logo secondaire pour les fonds colorés."
        reason="Un logo décliné sur fond clair et sur fond sombre garantit une lisibilité parfaite sur chaque plateforme."
        cta="Téléverser"
        tone="emerald"
        onCta={() => setActiveSection("library")}
      />
    </div>
  );
}
