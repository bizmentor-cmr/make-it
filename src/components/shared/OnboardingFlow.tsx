"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, Upload, Building2, Target, Share2, Palette, Flag, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "activity", label: "Votre activité", icon: <Building2 className="h-5 w-5" /> },
  { key: "goal", label: "Votre objectif", icon: <Target className="h-5 w-5" /> },
  { key: "platforms", label: "Vos plateformes", icon: <Share2 className="h-5 w-5" /> },
  { key: "brand", label: "Votre marque", icon: <Palette className="h-5 w-5" /> },
  { key: "roadmap", label: "Objectif 90 jours", icon: <Flag className="h-5 w-5" /> },
];

export function OnboardingFlow() {
  const { setOnboardingDone } = useAppStore();
  const [step, setStep] = useState(0);
  const pct = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl surface-card p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--ink)] text-[color:var(--primary-foreground)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold">Bienvenue sur Make It</p>
          </div>
          <span className="text-xs text-muted-foreground">Étape {step + 1} / {STEPS.length}</span>
        </div>

        <div className="mt-4">
          <Progress value={pct} className="h-1.5" />
        </div>

        <div className="mt-6 flex items-center gap-2">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            {STEPS[step].icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{STEPS[step].label}</h2>
            <p className="text-sm text-muted-foreground">Quelques infos et Make It prépare votre plan.</p>
          </div>
        </div>

        <div className="mt-6 min-h-[220px]">
          {step === 0 && <StepActivity />}
          {step === 1 && <StepGoal />}
          {step === 2 && <StepPlatforms />}
          {step === 3 && <StepBrand />}
          {step === 4 && <StepRoadmap />}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft className="h-4 w-4" /> Retour
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>
              Continuer <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => setOnboardingDone(true)}>
              <Check className="h-4 w-4" /> Lancer mon plan
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, placeholder }: { label: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
      />
    </label>
  );
}

function StepActivity() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Nom de l'entreprise" placeholder="Atelier Lumière" />
      <Field label="Secteur" placeholder="Mode & Lifestyle" />
      <Field label="Pays" placeholder="France" />
      <Field label="Site web" placeholder="atelier-lumiere.fr" />
    </div>
  );
}

function StepGoal() {
  const goals = ["Notoriété", "Croissance audience", "Engagement", "Prospects", "Ventes", "Image de marque"];
  const [sel, setSel] = useState<string | null>("Ventes");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {goals.map((g) => (
        <button
          key={g}
          onClick={() => setSel(g)}
          className={cn(
            "rounded-xl border p-4 text-left text-sm font-medium transition-colors",
            sel === g ? "border-[color:var(--emerald-accent)] bg-[color:var(--accent)]" : "border-border bg-card hover:bg-muted"
          )}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function StepPlatforms() {
  const platforms = ["Facebook", "Instagram", "TikTok", "LinkedIn", "YouTube", "Google Business", "WhatsApp"];
  const [sel, setSel] = useState<string[]>(["Instagram", "TikTok", "WhatsApp"]);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {platforms.map((p) => {
        const active = sel.includes(p);
        return (
          <button
            key={p}
            onClick={() => setSel((s) => (active ? s.filter((x) => x !== p) : [...s, p]))}
            className={cn(
              "rounded-xl border p-4 text-left text-sm font-medium transition-colors",
              active ? "border-[color:var(--emerald-accent)] bg-[color:var(--accent)]" : "border-border bg-card hover:bg-muted"
            )}
          >
            <span className="flex items-center justify-between">
              {p}
              {active && <Check className="h-4 w-4 text-emerald-600" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StepBrand() {
  const items = ["Logo", "Photos", "Couleurs", "Charte", "Contenus existants"];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i} className="rounded-xl border border-dashed border-border bg-muted/40 p-5 text-center text-sm text-muted-foreground">
            <Upload className="mx-auto h-5 w-5" />
            <p className="mt-2">{i}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Make It analyse automatiquement vos fichiers pour respecter votre identité.</p>
    </div>
  );
}

function StepRoadmap() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[color:var(--accent)]/40 border border-[color:var(--emerald-accent)]/30 p-4">
        <p className="text-sm font-medium">Make It prépare votre feuille de route 90 jours</p>
        <p className="mt-1 text-xs text-muted-foreground">3 piliers · 12 contenus · 2 campagnes · calibrés à votre objectif.</p>
      </div>
      <ul className="space-y-2 text-sm">
        {["Mois 1 — Notoriété & visibilité", "Mois 2 — Engagement & preuve sociale", "Mois 3 — Conversion & fidélisation"].map((r) => (
          <li key={r} className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" /> {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
