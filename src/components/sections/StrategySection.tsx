"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  Eye,
  Heart,
  TrendingUp,
  Layers,
  Target,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Minus,
  Sparkles,
  Lightbulb,
  Wrench,
  Clock,
  Hash,
  Radio,
  FileDown,
  Save,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformBadge } from "@/components/shared/PlatformBadge";
import { MakeItMark } from "@/components/shared/AIBadge";
import { useAppStore } from "@/store/app-store";
import { apiGet, apiPost, apiPatch, apiTry } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  strategyDiagnostic as mockDiagnostic,
  strategyTop as mockTop,
  strategyFlops as mockFlops,
  strategyOpportunities as mockOpportunities,
  type Platform,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DIAG_ICONS: Record<string, React.ReactNode> = {
  visibility: <Eye className="h-4 w-4" />,
  engagement: <Heart className="h-4 w-4" />,
  growth: <TrendingUp className="h-4 w-4" />,
  content: <Layers className="h-4 w-4" />,
  conversion: <Target className="h-4 w-4" />,
};

const SPARKLINES: Record<string, number[]> = {
  visibility: [54, 48, 60, 58, 70, 76, 82],
  engagement: [78, 80, 76, 78, 74, 72, 71],
  growth: [40, 45, 50, 48, 56, 60, 64],
  content: [60, 66, 68, 64, 72, 74, 77],
  conversion: [54, 58, 60, 62, 64, 66, 68],
};

function trendArrow(trend: string) {
  if (trend === "up")
    return <ArrowUp className="h-3.5 w-3.5 text-emerald-600" aria-label="En hausse" />;
  if (trend === "down")
    return <ArrowDown className="h-3.5 w-3.5 text-rose-600" aria-label="En baisse" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="Stable" />;
}

type DiagnosticItem = {
  key: string;
  label: string;
  value: number;
  delta: number;
  insight: string;
};

type ScoreResponse = {
  total: number;
  delta: number;
  subscores: { key: string; label: string; value: number; delta?: number; note?: string }[];
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
  }[];
};

type AnalyticsResponse = {
  metrics: {
    reach: number;
    impressions: number;
    views: number;
    engagement: number;
    clicks: number;
    conversions: number;
    followers: number;
    revenueCents: number;
  };
  byPlatform: { platform: string | null; metrics: { reach: number; engagement: number } }[];
  topContent: { contentId: string; metrics: { reach: number; engagement: number; views: number } }[];
};

/* ------------------------------------------------------------------ */
/*  Diagnostic card                                                    */
/* ------------------------------------------------------------------ */

function DiagnosticCard({
  item,
  onAction,
}: {
  item: DiagnosticItem;
  onAction: () => void;
}) {
  const positive = item.delta >= 0;
  const bars = SPARKLINES[item.key] ?? SPARKLINES.content;
  const barColor = positive ? "oklch(0.55 0.13 165 / 0.35)" : "oklch(0.62 0.2 350 / 0.35)";
  const barColorLast = positive ? "oklch(0.55 0.13 165)" : "oklch(0.62 0.2 350)";

  return (
    <div className="surface-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
          {DIAG_ICONS[item.key] ?? <TrendingUp className="h-4 w-4" />}
        </span>
        <span className="text-sm font-medium text-foreground/80">{item.label}</span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
          {item.value}
        </span>
        <span className="text-xs text-muted-foreground">/100</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
            positive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          )}
        >
          {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {positive ? "+" : ""}
          {item.delta}
        </span>
      </div>

      <div className="flex h-8 items-end gap-1" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm transition-colors"
            style={{
              height: `${h}%`,
              background: i === bars.length - 1 ? barColorLast : barColor,
            }}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-pretty">{item.insight}</p>

      <button
        onClick={onAction}
        className="mt-auto inline-flex items-center gap-1 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
      >
        Améliorer <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Opportunity card                                                   */
/* ------------------------------------------------------------------ */

type Opportunity = {
  title: string;
  impact: string;
  effort: string;
  why: string;
};

function OpportunityCard({
  o,
  onCta,
}: {
  o: Opportunity;
  onCta: () => void;
}) {
  const impactCls =
    (o.impact ?? "").includes("Élevé") || (o.impact ?? "").includes("High") || (o.impact ?? "").includes("élev")
      ? "bg-emerald-100 text-emerald-700"
      : "bg-amber-100 text-amber-800";

  return (
    <div className="surface-card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
          <Lightbulb className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground text-balance">{o.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", impactCls)}>
              Impact {o.impact}
            </span>
            <span className="inline-flex items-center rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium text-foreground">
              Effort {o.effort}
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-pretty">{o.why}</p>

      <button
        onClick={onCta}
        className="mt-auto inline-flex items-center gap-1.5 self-start rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-sm font-medium text-[color:var(--primary-foreground)] transition-opacity hover:opacity-90"
      >
        Lancer <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main section                                                       */
/* ------------------------------------------------------------------ */

type BrandingMode = "agency" | "client" | "custom";

type WhiteLabelReportSummary = {
  id: string;
  type: string;
  status: string;
  branding: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    font?: string | null;
    agencyName?: string | null;
    clientName?: string | null;
  };
  content: {
    title: string;
    periodLabel?: string | null;
    commentary?: string | null;
    recommendations?: string[] | null;
    working?: string[] | null;
    declining?: string[] | null;
    growing?: string[] | null;
    toChange?: string[] | null;
    actions?: Array<{ title?: string; cta?: string }> | null;
    metrics?: Record<string, unknown> | null;
    score?: { total: number; delta: number } | null;
  };
  createdAt: string;
};

type ClientBrandingResponse = {
  id: string;
  agencyClientId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  agencyName: string | null;
};

const DEFAULT_REPORT_SECTIONS = {
  working: true,
  declining: true,
  growing: true,
  toChange: true,
  actions: true,
} as const;

/* ------------------------------------------------------------------ */
/*  White-Label Export Dialog                                          */
/* ------------------------------------------------------------------ */

function WhiteLabelExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const activeClientId = useAppStore((s) => s.activeClientId);
  const [brandingMode, setBrandingMode] = useState<BrandingMode>("client");
  const [sections, setSections] = useState<{ [k: string]: boolean }>({
    ...DEFAULT_REPORT_SECTIONS,
  });
  const [customBranding, setCustomBranding] = useState({
    logoUrl: "",
    primaryColor: "#7c3aed",
    secondaryColor: "#10b981",
    agencyName: "",
  });
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<WhiteLabelReportSummary | null>(null);
  const [clientBranding, setClientBranding] = useState<ClientBrandingResponse | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCommentary, setEditCommentary] = useState("");
  const [editRecommendations, setEditRecommendations] = useState("");
  const [agencyName, setAgencyName] = useState<string | null>(null);

  // Fetch the client branding (if the agency is in agency mode + has an active client).
  useEffect(() => {
    if (!open || !activeClientId) return;
    let cancelled = false;
    (async () => {
      const b = await apiTry(
        async () => apiGet<ClientBrandingResponse>(`/api/agency/clients/${activeClientId}/branding`),
        null as ClientBrandingResponse | null
      );
      if (cancelled || !b) return;
      setClientBranding(b);
      setCustomBranding((prev) => ({
        ...prev,
        logoUrl: b.logoUrl ?? prev.logoUrl,
        primaryColor: b.primaryColor ?? prev.primaryColor,
        secondaryColor: b.secondaryColor ?? prev.secondaryColor,
        agencyName: b.agencyName ?? prev.agencyName,
      }));
      setAgencyName(b.agencyName);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeClientId]);

  // Reset report when dialog closes.
  useEffect(() => {
    if (!open) {
      setReport(null);
      setEditTitle("");
      setEditCommentary("");
      setEditRecommendations("");
    }
  }, [open]);

  const resolveBrandingForRequest = () => {
    if (brandingMode === "agency") {
      return { agencyName: null }; // use agency's default branding (no override)
    }
    if (brandingMode === "client") {
      return { agencyName: clientBranding?.agencyName ?? null };
    }
    return {
      logoUrl: customBranding.logoUrl || null,
      primaryColor: customBranding.primaryColor || null,
      secondaryColor: customBranding.secondaryColor || null,
      agencyName: customBranding.agencyName || null,
    };
  };

  const handleGenerate = async () => {
    if (!activeClientId) {
      toast.error("Sélectionnez un client dans le sélecteur d'agence.");
      return;
    }
    setGenerating(true);
    try {
      const created = await apiPost<WhiteLabelReportSummary>(
        `/api/agency/clients/${activeClientId}/reports`,
        {
          type: "monthly",
          branding: resolveBrandingForRequest(),
        }
      );
      setReport(created);
      setEditTitle(created.content.title || "Rapport White Label");
      setEditCommentary(created.content.commentary || "");
      setEditRecommendations((created.content.recommendations ?? []).join("\n"));
      toast.success("Rapport généré", {
        description: "Vous pouvez l'éditer avant export.",
      });

      // If "save template" is on + we have custom branding → persist on the client branding.
      if (saveTemplate && brandingMode === "custom") {
        await apiPatch<ClientBrandingResponse>(
          `/api/agency/clients/${activeClientId}/branding`,
          {
            logoUrl: customBranding.logoUrl || null,
            primaryColor: customBranding.primaryColor || null,
            secondaryColor: customBranding.secondaryColor || null,
            agencyName: customBranding.agencyName || null,
          }
        );
        toast.success("Template de branding enregistré");
      }
    } catch (e) {
      toast.error("Échec de génération du rapport", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!activeClientId || !report) return;
    try {
      const updated = await apiPatch<WhiteLabelReportSummary>(
        `/api/agency/clients/${activeClientId}/reports/${report.id}`,
        {
          content: {
            title: editTitle,
            commentary: editCommentary,
            recommendations: editRecommendations
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        }
      );
      setReport(updated);
      toast.success("Modifications enregistrées");
    } catch (e) {
      toast.error("Échec de l'enregistrement", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleExportPdf = async () => {
    if (!activeClientId || !report) return;
    await handleSaveEdits();
    // Open the printable HTML in a new tab — the user clicks "Imprimer / PDF" there.
    window.open(
      `/api/agency/clients/${activeClientId}/reports/${report.id}/export`,
      "_blank"
    );
  };

  const sectionToggles = [
    { key: "working", label: "Ce qui fonctionne" },
    { key: "declining", label: "Ce qui décline" },
    { key: "growing", label: "Ce qui progresse" },
    { key: "toChange", label: "À ajuster" },
    { key: "actions", label: "Plan d'action" },
  ];

  const previewPrimary =
    brandingMode === "custom"
      ? customBranding.primaryColor
      : clientBranding?.primaryColor ?? "#7c3aed";
  const previewAgencyName =
    brandingMode === "custom"
      ? customBranding.agencyName || "Agence"
      : brandingMode === "agency"
      ? agencyName ?? "Make It for Agencies"
      : clientBranding?.agencyName ?? agencyName ?? "Make It for Agencies";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-4 w-4 text-[color:var(--ink)]" />
            Rapport White Label
          </DialogTitle>
          <DialogDescription>
            Générez un rapport éditable aux couleurs de votre agence ou du client, prêt à imprimer en PDF.
          </DialogDescription>
        </DialogHeader>

        {!activeClientId ? (
          <div className="surface-soft rounded-xl p-6 text-center text-sm text-muted-foreground">
            Sélectionnez un client dans le sélecteur d'agence (en-tête) pour générer son rapport.
          </div>
        ) : !report ? (
          <div className="space-y-5">
            {/* Branding selector */}
            <div>
              <Label className="mb-2 block text-sm font-medium">Branding</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([
                  { v: "agency", label: "Marque agence", hint: "Make It for Agencies" },
                  { v: "client", label: "Marque client", hint: "Logo + couleurs du client" },
                  { v: "custom", label: "Personnalisé", hint: "Vos couleurs + logo" },
                ] as { v: BrandingMode; label: string; hint: string }[]).map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setBrandingMode(opt.v)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      brandingMode === opt.v
                        ? "border-[color:var(--ink)] bg-[color:var(--ink)]/5"
                        : "border-border bg-card hover:bg-foreground/5"
                    )}
                  >
                    <div className="text-sm font-medium text-foreground">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {brandingMode === "custom" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="wl-logo" className="text-xs">URL du logo</Label>
                  <Input
                    id="wl-logo"
                    placeholder="https://..."
                    value={customBranding.logoUrl}
                    onChange={(e) =>
                      setCustomBranding((p) => ({ ...p, logoUrl: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="wl-primary" className="text-xs">Couleur principale</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="wl-primary"
                      type="color"
                      className="h-9 w-12 rounded-md border border-border"
                      value={customBranding.primaryColor}
                      onChange={(e) =>
                        setCustomBranding((p) => ({ ...p, primaryColor: e.target.value }))
                      }
                    />
                    <Input
                      value={customBranding.primaryColor}
                      onChange={(e) =>
                        setCustomBranding((p) => ({ ...p, primaryColor: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="wl-secondary" className="text-xs">Couleur secondaire</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="wl-secondary"
                      type="color"
                      className="h-9 w-12 rounded-md border border-border"
                      value={customBranding.secondaryColor}
                      onChange={(e) =>
                        setCustomBranding((p) => ({ ...p, secondaryColor: e.target.value }))
                      }
                    />
                    <Input
                      value={customBranding.secondaryColor}
                      onChange={(e) =>
                        setCustomBranding((p) => ({ ...p, secondaryColor: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="wl-agency-name" className="text-xs">Nom affiché (agence)</Label>
                  <Input
                    id="wl-agency-name"
                    placeholder="Mon Agence"
                    value={customBranding.agencyName}
                    onChange={(e) =>
                      setCustomBranding((p) => ({ ...p, agencyName: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            {/* Section toggles */}
            <div>
              <Label className="mb-2 block text-sm font-medium">Sections à inclure</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sectionToggles.map((s) => (
                  <label
                    key={s.key}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-sm"
                  >
                    <Checkbox
                      checked={!!sections[s.key]}
                      onCheckedChange={(v) =>
                        setSections((p) => ({ ...p, [s.key]: !!v }))
                      }
                    />
                    <span className="text-foreground">{s.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Les sections désactivées ne figurent pas dans le rapport final.
              </p>
            </div>

            {/* Save template option */}
            <label className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
              <Checkbox
                checked={saveTemplate}
                onCheckedChange={(v) => setSaveTemplate(!!v)}
                disabled={brandingMode !== "custom"}
              />
              <span className="text-foreground">
                Enregistrer comme template {brandingMode !== "custom" && "(réservé au mode personnalisé)"}
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Générer le rapport
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs defaultValue="edit">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="edit">Éditer</TabsTrigger>
                <TabsTrigger value="preview">Aperçu</TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="wl-title" className="text-xs">Titre</Label>
                  <Input
                    id="wl-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="wl-commentary" className="text-xs">Commentaire</Label>
                  <Textarea
                    id="wl-commentary"
                    rows={5}
                    value={editCommentary}
                    onChange={(e) => setEditCommentary(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="wl-reco" className="text-xs">Recommandations (une par ligne)</Label>
                  <Textarea
                    id="wl-reco"
                    rows={4}
                    value={editRecommendations}
                    onChange={(e) => setEditRecommendations(e.target.value)}
                  />
                </div>
                <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                  Sections incluses : {sectionToggles.filter((s) => sections[s.key]).map((s) => s.label).join(" · ")}
                </div>
              </TabsContent>

              <TabsContent value="preview" className="mt-4">
                <div
                  className="rounded-xl border p-5"
                  style={{
                    borderColor: previewPrimary ? `${previewPrimary}33` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: previewPrimary ? `${previewPrimary}33` : undefined }}>
                    <div className="text-sm font-bold" style={{ color: previewPrimary || undefined }}>
                      {previewAgencyName}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {report.content.periodLabel ?? "Période"}
                      {report.content.score && (
                        <div
                          className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                          style={{ background: previewPrimary || undefined }}
                        >
                          Score: {report.content.score.total}/100
                        </div>
                      )}
                    </div>
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-foreground">{editTitle}</h3>
                  {editCommentary && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{editCommentary}</p>
                  )}
                  {sections.working && report.content.working && report.content.working.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-emerald-600">Ce qui fonctionne</div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-foreground/80">
                        {report.content.working.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sections.declining && report.content.declining && report.content.declining.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-rose-600">Ce qui décline</div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-foreground/80">
                        {report.content.declining.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sections.growing && report.content.growing && report.content.growing.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-emerald-600">Ce qui progresse</div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-foreground/80">
                        {report.content.growing.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sections.toChange && report.content.toChange && report.content.toChange.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-amber-600">À ajuster</div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-foreground/80">
                        {report.content.toChange.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sections.actions && editRecommendations && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold" style={{ color: previewPrimary || undefined }}>Recommandations</div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-foreground/80">
                        {editRecommendations.split("\n").filter((s) => s.trim()).map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setReport(null)}>
                Reprendre
              </Button>
              <Button variant="outline" onClick={handleSaveEdits}>
                <Save className="h-4 w-4" />
                Enregistrer
              </Button>
              <Button onClick={handleExportPdf}>
                <FileDown className="h-4 w-4" />
                Générer le PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StrategySection() {
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const setAdvisorOpen = useAppStore((s) => s.setAdvisorOpen);
  const [whiteLabelOpen, setWhiteLabelOpen] = useState(false);

  const [diagnostic, setDiagnostic] = useState<DiagnosticItem[]>([]);
  const [top, setTop] = useState(mockTop);
  const [flops, setFlops] = useState(mockFlops);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(mockOpportunities);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [scoreRes, insightsRes, analyticsRes] = await Promise.all([
        apiTry(async () => apiGet<ScoreResponse>("/api/insights/score"), null as ScoreResponse | null),
        apiTry(async () => apiGet<InsightsResponse>("/api/insights"), null as InsightsResponse | null),
        apiTry(async () => apiGet<AnalyticsResponse>("/api/analytics?range=30"), null as AnalyticsResponse | null),
      ]);
      if (cancelled) return;

      // Diagnostic — from score subscores, fall back to mock.
      if (scoreRes?.subscores?.length) {
        const mapped: DiagnosticItem[] = scoreRes.subscores.slice(0, 5).map((s) => ({
          key: s.key,
          label: s.label,
          value: Math.round(s.value),
          delta: s.delta ?? 0,
          insight: s.note ?? `Votre ${s.label.toLowerCase()} évolue de ${s.delta ?? 0} points.`,
        }));
        setDiagnostic(mapped);
      } else {
        setDiagnostic(mockDiagnostic as unknown as DiagnosticItem[]);
      }

      // Flops — bottom insights with severity "critical" or negative.
      if (insightsRes?.insights?.length) {
        const flopsFromInsights = insightsRes.insights
          .filter((i) => {
            const sev = (i.severity ?? "").toLowerCase();
            const cat = (i.category ?? "").toLowerCase();
            return sev.includes("critical") || sev.includes("high") || cat.includes("decline");
          })
          .slice(0, 3)
          .map((i) => ({
            title: i.recommendation?.slice(0, 80) ?? "Contenu sous-performant",
            platform: "instagram" as Platform,
            format: "Post",
            reason: i.explanation ?? i.evidence ?? "Format ou message peu engageant.",
            metric: "—",
            drop: "−10%",
          }));
        if (flopsFromInsights.length > 0) setFlops(flopsFromInsights as unknown as typeof mockFlops);

        const oppsFromInsights = insightsRes.insights
          .filter((i) => {
            const sev = (i.severity ?? "").toLowerCase();
            return sev.includes("medium") || sev.includes("low") || sev.includes("info") || sev === "";
          })
          .slice(0, 4)
          .map((i) => ({
            title: i.recommendation ?? "Opportunité",
            impact: (i.impactScore ?? 0) >= 7 ? "Élevé" : "Moyen",
            effort: (i.effortScore ?? 0) <= 3 ? "Faible" : "Moyen",
            why: i.explanation ?? i.evidence ?? "Action data-driven.",
          }));
        if (oppsFromInsights.length > 0) {
          setOpportunities(oppsFromInsights as unknown as Opportunity[]);
        } else {
          setOpportunities(mockOpportunities as unknown as Opportunity[]);
        }
      } else {
        setFlops(mockFlops);
        setOpportunities(mockOpportunities as unknown as Opportunity[]);
      }

      // Top content — map from analytics topContent + byPlatform, fall back to mock.
      if (analyticsRes?.topContent?.length) {
        const channels = analyticsRes.byPlatform
          .filter((p) => p.platform && (p.metrics?.reach ?? 0) > 0)
          .slice(0, 5)
          .map((p) => ({
            name: (p.platform ?? "").charAt(0).toUpperCase() + (p.platform ?? "").slice(1),
            share: Math.round((p.metrics.reach / Math.max(1, analyticsRes.metrics.reach)) * 100),
            trend: "up" as const,
          }));
        if (channels.length > 0) {
          setTop({
            ...(mockTop as object),
            channels,
          } as typeof mockTop);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  const exampleQuestions = [
    "Pourquoi mes posts statiques baissent-ils ?",
    "Quels formats tester cette semaine ?",
    "Comment réutiliser mon meilleur Reel ?",
  ];

  return (
    <div className="space-y-8">
      {/* 1. Header */}
      <div className="animate-float-up">
        <SectionHeader
          eyebrow="Diagnostic IA"
          title="Votre stratégie marketing"
          description="Make It a analysé 30 jours de données pour vous indiquer ce qui fonctionne, ce qui plonge et ce qui peut être amélioré."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setWhiteLabelOpen(true)}
                title="Générer un rapport PDF aux couleurs de votre agence"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Exporter le rapport White Label</span>
                <span className="sm:hidden">White Label</span>
              </Button>
              <Button onClick={() => setAdvisorOpen(true)} size="default">
                <Sparkles className="h-4 w-4" />
                Demander à Make It
              </Button>
            </div>
          }
        />
      </div>

      <WhiteLabelExportDialog open={whiteLabelOpen} onOpenChange={setWhiteLabelOpen} />

      {/* 2. Diagnostic grid */}
      <section
        aria-label="Diagnostic"
        className="animate-float-up grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        style={{ animationDelay: "0.05s" }}
      >
        {loading && diagnostic.length === 0
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)
          : diagnostic.map((item) => (
              <DiagnosticCard
                key={item.key}
                item={item}
                onAction={() => setActiveSection("create")}
              />
            ))}
      </section>

      {/* 3. Top performance block */}
      <section
        aria-label="Top performance"
        className="animate-float-up space-y-4"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Top contenus */}
          <div className="surface-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                🏆 Top contenus
              </h2>
              <span className="text-xs text-muted-foreground">30 derniers jours</span>
            </div>
            <ul className="space-y-3">
              {top.contents.map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground text-pretty">
                      {c.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <PlatformBadge
                        platform={c.platform as Platform}
                        size="sm"
                      />
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {c.format}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.metric}</span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <ArrowUp className="h-3 w-3" /> {c.lift}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveSection("create")}
                    className="shrink-0 rounded-full bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
                  >
                    Réutiliser
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Meilleurs formats */}
          <div className="surface-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                📈 Meilleurs formats
              </h2>
              <span className="text-xs text-muted-foreground">Score Make It</span>
            </div>
            <ul className="space-y-4">
              {top.formats.map((f, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-foreground">{f.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {f.score}
                      <span className="text-muted-foreground/70">/100</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className="h-2 rounded-full bg-[color:var(--emerald-accent)]"
                      style={{ width: `${f.score}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{f.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Secondary row: thèmes · horaires · canaux */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="surface-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Meilleurs thèmes</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {top.themes.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="surface-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Meilleurs horaires</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {top.timeSlots.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="surface-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Meilleurs canaux</h3>
            </div>
            <ul className="space-y-2.5">
              {top.channels.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate text-foreground">{c.name}</span>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className="h-1.5 rounded-full bg-foreground/40"
                      style={{ width: `${Math.min(100, c.share * 2.5)}%` }}
                    />
                  </div>
                  <span className="w-9 text-right tabular-nums text-xs text-muted-foreground">
                    {c.share}%
                  </span>
                  {trendArrow(c.trend)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 4. Flops block */}
      <section
        aria-label="Flops"
        className="animate-float-up surface-soft p-6"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            📉 Flops — et pourquoi
          </h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground text-pretty">
          Make It explique chaque échec en langage simple, pour vous aider à
          corriger le tir dès la prochaine publication.
        </p>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {flops.map((f, i) => (
            <li
              key={i}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground text-pretty">
                  {f.title}
                </p>
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                  <ArrowDown className="h-3 w-3" /> {f.drop}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge
                  platform={f.platform as Platform}
                  size="sm"
                  showLabel={false}
                />
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {f.format}
                </span>
                <span className="text-xs text-muted-foreground">{f.metric}</span>
              </div>

              <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                <p className="text-xs text-rose-900 text-pretty">
                  <span className="font-semibold">Pourquoi : </span>
                  {f.reason}
                </p>
              </div>

              <button
                onClick={() => setActiveSection("create")}
                className="mt-auto inline-flex items-center gap-1 self-start rounded-full bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
              >
                <Wrench className="h-3 w-3" /> Réparer
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Opportunities block */}
      <section
        aria-label="Opportunités"
        className="animate-float-up surface-accent p-6"
        style={{ animationDelay: "0.2s" }}
      >
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold">💡 Opportunités</h2>
        </div>
        <p className="mb-4 text-sm text-pretty opacity-80">
          4 leviers actionnables identifiés par Make It, triés par impact.
          Chacun est prêt à être lancé.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {opportunities.map((o, i) => (
            <OpportunityCard
              key={i}
              o={o}
              onCta={() =>
                setActiveSection(
                  (o.title ?? "").toLowerCase().includes("dimanche") ? "planning" : "create"
                )
              }
            />
          ))}
        </div>
      </section>

      {/* 6. Advisor CTA */}
      <section
        aria-label="Demander à Make It"
        className="animate-float-up surface-hero p-8 text-center"
        style={{ animationDelay: "0.25s" }}
      >
        <div className="flex justify-center">
          <MakeItMark />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-foreground text-balance sm:text-2xl">
          Pas sûr par où commencer ? Demandez à Make It.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground text-pretty">
          Posez une question en langage naturel : Make It analyse vos 30
          derniers jours et vous propose un plan d'action concret.
        </p>
        <div className="mt-5 flex justify-center">
          <Button onClick={() => setAdvisorOpen(true)} size="lg">
            <Sparkles className="h-4 w-4" />
            Demander à Make It
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {exampleQuestions.map((q) => (
            <button
              key={q}
              onClick={() => setAdvisorOpen(true)}
              className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/5"
            >
              {q}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
