"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Bell,
  Check,
  CreditCard,
  Link2,
  LogOut,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Sun,
  User,
  Building2,
  Users,
  ArrowRight,
  Loader2,
  Power,
  Gift,
  Copy,
  Share2,
  MousePointerClick,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { CreditBuyCard } from "@/components/shared/CreditMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiGet, apiPost, apiDelete, apiTry, type Wallet } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Settings / "Paramètres"                                                    */
/*  A clean, sectioned settings page (not a wall of toggles).                  */
/* -------------------------------------------------------------------------- */

type TabKey =
  | "profil"
  | "preferences"
  | "reseaux"
  | "agency"
  | "credits"
  | "parrainage"
  | "notifications"
  | "apparence";

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "profil", label: "Profil", icon: User },
  { key: "preferences", label: "Préférences", icon: Palette },
  { key: "reseaux", label: "Réseaux sociaux", icon: Link2 },
  { key: "agency", label: "Mode Agence", icon: Building2 },
  { key: "credits", label: "Crédits & facturation", icon: CreditCard },
  { key: "parrainage", label: "Parrainage", icon: Gift },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "apparence", label: "Apparence", icon: Sun },
];

const PLATFORMS_SOCIAL = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "google", label: "Google" },
] as const;

const DEFAULT_PLATFORMS = [
  { id: "instagram", label: "Instagram", checked: true },
  { id: "tiktok", label: "TikTok", checked: true },
  { id: "facebook", label: "Facebook", checked: false },
  { id: "linkedin", label: "LinkedIn", checked: false },
  { id: "youtube", label: "YouTube", checked: false },
  { id: "whatsapp", label: "WhatsApp", checked: false },
];

const NOTIFICATION_TYPES = [
  { id: "content_ready", label: "Contenu prêt", desc: "Un contenu fini d'être généré par Make It." },
  { id: "publish_success", label: "Publication réussie", desc: "Un contenu a été publié sur un réseau." },
  { id: "publish_failed", label: "Publication échouée", desc: "Une publication a échoué. Action requise." },
  { id: "campaign_under", label: "Campagne sous-performante", desc: "Une campagne dérive sous l'objectif." },
  { id: "credits_low", label: "Crédits faibles", desc: "Il vous reste moins de 1000 crédits." },
  { id: "report_ready", label: "Rapport disponible", desc: "Votre résumé mensuel est prêt." },
];

const TIMEZONES = ["Africa/Douala", "Europe/Paris", "Africa/Casablanca", "Africa/Dakar"];
const LANGS = ["Français", "English", "Español", "العربية"];
const TONES = ["Premium", "Conversationnel", "Expert", "Punchy"];

// ─── API types ──────────────────────────────────────────────────────────────
type SocialAccount = {
  id: string;
  platform: string;
  accountName: string | null;
  handle: string | null;
  status: string;
};

type SocialListResponse = { accounts: SocialAccount[] };

type SubscriptionPlan = {
  id: string;
  name: string;
  monthlyPrice: number;
  includedCredits: number;
  storageLimitMb: number;
  socialAccountsLimit: number;
  teamMembersLimit: number;
};

type PlansResponse = { plans: SubscriptionPlan[] };
type SubscriptionResponse = {
  subscription: {
    id: string;
    planId: string;
    status: string;
    currentPeriodEnd: string;
  } | null;
  plan: {
    id: string;
    name: string;
    monthlyPrice: number;
    includedCredits: number;
  } | null;
};

export function SettingsSection() {
  const {
    setOnboardingDone,
    setCreditsOpen,
    creditsTotal,
    creditsUsed,
    wallet: storeWallet,
    mode,
    setMode,
    setActiveAgencyId,
    setActiveSection,
  } = useAppStore();
  const { user, signOut, workspace } = useAuth();
  const [tab, setTab] = useState<TabKey>("profil");
  const { theme, setTheme } = useTheme();

  // ─── Profile state — prefill name/email from the auth context ──────────
  const [profile, setProfile] = useState({
    name: user?.name ?? "Camille",
    email: user?.email ?? "camille@atelier-lumiere.fr",
    company: "Atelier Lumière",
    role: "Fondatrice & Directrice marketing",
  });

  // Keep the profile in sync if the auth context resolves after first render.
  useEffect(() => {
    if (user?.name) {
      setProfile((p) => ({ ...p, name: user.name, email: user.email }));
    }
  }, [user]);

  // ─── Preferences state (local only, per the brief) ─────────────────────
  const [prefs, setPrefs] = useState({
    lang: "Français",
    tz: "Africa/Douala",
    tone: "Premium",
  });
  const [defaultPlats, setDefaultPlats] = useState<Record<string, boolean>>(
    Object.fromEntries(DEFAULT_PLATFORMS.map((p) => [p.id, p.checked]))
  );

  // ─── Notifications state (local only) ──────────────────────────────────
  const [notif, setNotif] = useState<Record<string, boolean>>({
    content_ready: true,
    publish_success: true,
    publish_failed: true,
    campaign_under: true,
    credits_low: true,
    report_ready: false,
  });

  // ─── Social connections (real — from /api/social) ──────────────────────
  const [social, setSocial] = useState<SocialAccount[]>([]);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);

  // ─── Billing state (real — /api/billing/plans + subscription + /api/credits) ─
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [sub, setSub] = useState<SubscriptionResponse | null>(null);
  const [credits, setCredits] = useState<Wallet | null>(storeWallet);
  const [planBusy, setPlanBusy] = useState<string | null>(null);

  // ─── Agency state (real — /api/agency GET + POST activate + DELETE deactivate)
  type AgencyInfo = {
    agency: {
      id: string;
      name: string;
      slug: string;
      status: string;
      mode: string;
      createdAt: string;
    };
    role: "admin" | "manager" | "creative";
    wallet: {
      totalCredits: number;
      reservedCredits: number;
      totalConsumed: number;
      available: number;
    };
    clientCount: number;
    memberCount: number;
  } | null;
  const [agency, setAgency] = useState<AgencyInfo>(null);
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAgencyLoading(true);
      const res = await apiTry(
        async () => apiGet<AgencyInfo>("/api/agency"),
        null as AgencyInfo
      );
      if (cancelled) return;
      setAgency(res);
      if (res?.agency.id) {
        setActiveAgencyId(res.agency.id);
        // If the user already has an agency but the store says solo, sync up.
        if (mode === "solo") setMode("agency");
      }
      setAgencyLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function activateAgency() {
    if (activating) return;
    setActivating(true);
    try {
      const name = workspace?.name || user?.name || "Mon Agence";
      const res = await apiPost<{
        agency: { id: string; name: string; slug: string };
        role: string;
        firstClientId: string;
        firstClientName: string;
        activated: boolean;
      }>("/api/agency", { name });

      // The POST succeeded — the agency is now active. Use the returned agency
      // id immediately so the store flips to agency mode even if the refresh
      // GET below fails (e.g. transient network issue).
      if (res.agency?.id) setActiveAgencyId(res.agency.id);

      // Best-effort refresh of the full agency info (wallet, clientCount, etc.).
      // If this fails, we still proceed — the POST already confirmed activation.
      try {
        const fresh = await apiGet<AgencyInfo>("/api/agency");
        setAgency(fresh);
        if (fresh?.agency.id) setActiveAgencyId(fresh.agency.id);
      } catch {
        // Ignore — the POST response is enough to proceed.
        setAgency({
          agency: {
            id: res.agency.id,
            name: res.agency.name,
            slug: res.agency.slug,
            status: "active",
            mode: "pool",
            createdAt: new Date().toISOString(),
          },
          role: (res.role as "admin" | "manager" | "creative") || "admin",
          wallet: { totalCredits: 0, reservedCredits: 0, totalConsumed: 0, available: 0 },
          clientCount: 0,
          memberCount: 1,
        });
      }

      // Flip the store → the app re-renders with the agency theme.
      setMode("agency");
      toast.success("Mode agence activé", {
        description: `Bienvenue dans Make It for Agencies — ${res.agency.name}.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      // If the agency already exists (the POST is idempotent and returns the
      // existing agency), the error might be a stale session. Try a GET as a
      // fallback — if it finds an agency, flip the mode anyway.
      if (msg.includes("401") || msg.includes("Non authentifi") || msg.includes("session")) {
        try {
          const fresh = await apiGet<AgencyInfo>("/api/agency");
          if (fresh?.agency?.id) {
            setAgency(fresh);
            setActiveAgencyId(fresh.agency.id);
            setMode("agency");
            toast.success("Mode agence activé", {
              description: `Bienvenue dans Make It for Agencies — ${fresh.agency.name}.`,
            });
            return;
          }
        } catch {
          // Fall through to the error toast below.
        }
      }
      toast.error("Impossible d'activer le mode agence", {
        description: msg,
      });
    } finally {
      setActivating(false);
    }
  }

  async function deactivateAgency() {
    if (deactivating) return;
    setDeactivating(true);
    try {
      await apiDelete("/api/agency", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      setAgency(null);
      setActiveAgencyId(null);
      setMode("solo");
      toast.success("Mode agence désactivé", {
        description: "Vos clients ont été archivés. Les données sont conservées.",
      });
    } catch (e) {
      toast.error("Impossible de désactiver le mode agence", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDeactivating(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [socialRes, plansRes, subRes, creditsRes] = await Promise.all([
        apiTry(
          async () => apiGet<SocialListResponse>("/api/social"),
          null as SocialListResponse | null
        ),
        apiTry(
          async () => apiGet<PlansResponse>("/api/billing/plans"),
          null as PlansResponse | null
        ),
        apiTry(
          async () => apiGet<SubscriptionResponse>("/api/billing/subscription"),
          null as SubscriptionResponse | null
        ),
        apiTry(
          async () => apiGet<Wallet>("/api/credits"),
          null as Wallet | null
        ),
      ]);
      if (cancelled) return;
      if (socialRes?.accounts) setSocial(socialRes.accounts);
      if (plansRes?.plans) setPlans(plansRes.plans);
      if (subRes) setSub(subRes);
      if (creditsRes) setCredits(creditsRes);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSocial() {
    const res = await apiTry(
      async () => apiGet<SocialListResponse>("/api/social"),
      null as SocialListResponse | null
    );
    if (res?.accounts) setSocial(res.accounts);
  }

  async function refreshSubscription() {
    const [subRes, creditsRes] = await Promise.all([
      apiTry(
        async () => apiGet<SubscriptionResponse>("/api/billing/subscription"),
        null as SubscriptionResponse | null
      ),
      apiTry(async () => apiGet<Wallet>("/api/credits"), null as Wallet | null),
    ]);
    if (subRes) setSub(subRes);
    if (creditsRes) setCredits(creditsRes);
  }

  // ─── Social connect / disconnect ───────────────────────────────────────
  async function connectPlatform(platformId: string) {
    if (socialBusy) return;
    setSocialBusy(platformId);
    try {
      await apiPost("/api/social", {
        platform: platformId,
        accountName: "Nouveau compte",
        handle: "@nouveau",
      });
      toast.success("Compte connecté", {
        description: "Votre compte social a été ajouté.",
      });
      await refreshSocial();
    } catch (e) {
      toast.error("Connexion impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSocialBusy(null);
    }
  }

  async function disconnectAccount(accountId: string, label: string) {
    if (socialBusy) return;
    setSocialBusy(accountId);
    try {
      await apiDelete(`/api/social/${accountId}`);
      toast.success(`${label} déconnecté`);
      await refreshSocial();
    } catch (e) {
      toast.error("Déconnexion impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSocialBusy(null);
    }
  }

  // ─── Plan change ───────────────────────────────────────────────────────
  async function changePlan(plan: SubscriptionPlan) {
    if (planBusy) return;
    if (sub?.plan?.id === plan.id) return;
    setPlanBusy(plan.id);
    try {
      await apiPost("/api/billing/subscription", { planId: plan.id });
      toast.success("Abonnement mis à jour", {
        description: `Plan ${plan.name} activé.`,
      });
      await refreshSubscription();
    } catch (e) {
      toast.error("Changement de plan impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPlanBusy(null);
    }
  }

  // ─── Derived display values ────────────────────────────────────────────
  const remaining =
    credits?.available ??
    Math.max(0, creditsTotal - creditsUsed);
  const total =
    credits && (credits.subscriptionCredits ?? 0) + (credits.purchasedCredits ?? 0) > 0
      ? (credits.subscriptionCredits ?? 0) + (credits.purchasedCredits ?? 0)
      : creditsTotal;
  const used =
    credits && (credits.totalConsumed ?? 0) + (credits.reservedCredits ?? 0) > 0
      ? (credits.totalConsumed ?? 0) + (credits.reservedCredits ?? 0)
      : creditsUsed;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const renewalInDays = credits?.renewalInDays ?? 18;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Paramètres"
        title="Réglages"
        description="Compte, préférences, intégrations, facturation."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* ---------- Vertical tabs (lg) / horizontal scroll (mobile) ---------- */}
        <nav
          aria-label="Réglages"
          className="lg:sticky lg:top-4 lg:self-start"
        >
          <div className="flex gap-1.5 overflow-x-auto pb-1 scroll-premium lg:flex-col lg:overflow-visible lg:pb-0">
            {TABS.map((t) => {
              const active = tab === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors lg:w-full lg:justify-start",
                    active
                      ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ---------- Tab content ---------- */}
        <div className="space-y-6">
          {tab === "profil" && (
            <SectionCard
              title="Profil"
              desc="Vos informations personnelles et l'entreprise représentée."
            >
              <Row label="Nom complet">
                <Input
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  className="h-10 max-w-md"
                />
              </Row>
              <Row label="Email">
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  className="h-10 max-w-md"
                />
              </Row>
              <Row label="Entreprise">
                <Input
                  value={profile.company}
                  onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                  className="h-10 max-w-md"
                />
              </Row>
              <Row label="Rôle">
                <Input
                  value={profile.role}
                  onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                  className="h-10 max-w-md"
                />
              </Row>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOnboardingDone(false);
                    toast.success("Onboarding relancé", {
                      description: "Vous allez revivre l'onboarding Make It.",
                    });
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refaire l&apos;onboarding
                </Button>
                <Button
                  size="sm"
                  className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                  onClick={() => toast.success("Profil enregistré")}
                >
                  <Save className="h-3.5 w-3.5" />
                  Enregistrer
                </Button>
              </div>
            </SectionCard>
          )}

          {tab === "preferences" && (
            <SectionCard
              title="Préférences"
              desc="Langue, fuseau horaire, plateformes par défaut et ton de marque."
            >
              <Row label="Langue de l'interface">
                <Select value={prefs.lang} onValueChange={(v) => setPrefs({ ...prefs, lang: v })}>
                  <SelectTrigger className="h-10 w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Fuseau horaire">
                <Select value={prefs.tz} onValueChange={(v) => setPrefs({ ...prefs, tz: v })}>
                  <SelectTrigger className="h-10 w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Plateformes par défaut" hint="Utilisées lors de la création de nouveaux contenus.">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 max-w-md">
                  {DEFAULT_PLATFORMS.map((p) => (
                    <label
                      key={p.id}
                      htmlFor={`pref-${p.id}`}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium hover:border-foreground/20"
                    >
                      <Checkbox
                        id={`pref-${p.id}`}
                        checked={defaultPlats[p.id]}
                        onCheckedChange={(v) =>
                          setDefaultPlats({ ...defaultPlats, [p.id]: v === true })
                        }
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              </Row>
              <Row label="Ton de marque par défaut">
                <Select value={prefs.tone} onValueChange={(v) => setPrefs({ ...prefs, tone: v })}>
                  <SelectTrigger className="h-10 w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                  onClick={() => toast.success("Préférences enregistrées")}
                >
                  <Save className="h-3.5 w-3.5" />
                  Enregistrer
                </Button>
              </div>
            </SectionCard>
          )}

          {tab === "reseaux" && (
            <SectionCard
              title="Réseaux sociaux"
              desc="Connectez vos comptes pour publier et analyser depuis Make It."
            >
              <ul className="divide-y divide-border">
                {PLATFORMS_SOCIAL.map((p) => {
                  // Look up any API-side account for this platform. A platform
                  // is "connected" when at least one account exists with status
                  // "connected".
                  const acct = social.find(
                    (a) =>
                      a.platform === p.id &&
                      (a.status ?? "connected") === "connected"
                  );
                  const on = !!acct;
                  const busy = socialBusy === p.id || (acct && socialBusy === acct.id);
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-sm font-semibold uppercase">
                          {p.label.slice(0, 2)}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{p.label}</p>
                          <p className={cn("text-xs", on ? "text-[color:var(--emerald-accent)]" : "text-muted-foreground")}>
                            {on ? `Connecté · ${acct?.handle ?? "@nouveau"}` : "Non connecté"}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant={on ? "outline" : "default"}
                        size="sm"
                        disabled={!!busy}
                        className={cn(
                          !on && "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90",
                          on && "border-[color:var(--emerald-accent)] text-[color:var(--emerald-accent)] hover:bg-[color:var(--accent)]/40"
                        )}
                        onClick={() => {
                          if (on && acct) {
                            void disconnectAccount(acct.id, p.label);
                          } else {
                            void connectPlatform(p.id);
                          }
                        }}
                      >
                        {busy ? "…" : on ? "Connecté" : "Connecter"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}

          {tab === "agency" && (
            <AgencyTab
              agency={agency}
              loading={agencyLoading}
              activating={activating}
              deactivating={deactivating}
              onActivate={activateAgency}
              onDeactivate={deactivateAgency}
              onGoToPortfolio={() => setActiveSection("agency-portfolio")}
            />
          )}

          {tab === "credits" && (
            <SectionCard
              title="Crédits & facturation"
              desc="Gérez vos crédits IA et rechargez quand vous en avez besoin."
            >
              <div className="surface-soft p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--emerald-accent)]">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Crédits IA</p>
                      <p className="text-xs text-muted-foreground">Cycle en cours</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {remaining.toLocaleString("fr-FR")} / {total.toLocaleString("fr-FR")}
                  </span>
                </div>
                <Progress value={pct} className="mt-3 h-2" />
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {used.toLocaleString("fr-FR")} utilisés · Renouvellement dans {renewalInDays} jour{renewalInDays > 1 ? "s" : ""}
                  </p>
                  <Button
                    size="sm"
                    className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                    onClick={() => setCreditsOpen(true)}
                  >
                    Recharger
                  </Button>
                </div>
              </div>

              {/* Plans selector — real from /api/billing/plans + /api/billing/subscription */}
              {plans.length > 0 && (
                <div className="mt-5">
                  <p className="mb-3 text-sm font-semibold text-foreground">Votre formule</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {plans.map((plan) => {
                      const active = sub?.plan?.id === plan.id;
                      const busy = planBusy === plan.id;
                      return (
                        <div
                          key={plan.id}
                          className={cn(
                            "relative flex flex-col gap-2 rounded-xl border p-4 transition-shadow hover:shadow-sm",
                            active
                              ? "border-[color:var(--emerald-accent)] bg-[color:var(--accent)]/40"
                              : "border-border bg-card"
                          )}
                        >
                          {active && (
                            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[color:var(--emerald-accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                              <Check className="h-3 w-3" /> Actuel
                            </span>
                          )}
                          <p className="text-base font-semibold text-foreground">{plan.name}</p>
                          <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                            {(plan.monthlyPrice ?? 0).toLocaleString("fr-FR", {
                              minimumFractionDigits: plan.monthlyPrice % 100 === 0 ? 0 : 2,
                            })} €
                            <span className="ml-1 text-xs font-normal text-muted-foreground">/ mois</span>
                          </p>
                          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                            <li>{(plan.includedCredits ?? 0).toLocaleString("fr-FR")} crédits IA / mois</li>
                            <li>{plan.socialAccountsLimit ?? 0} comptes sociaux</li>
                            <li>{plan.storageLimitMb ?? 0} Mo de stockage</li>
                            <li>{plan.teamMembersLimit ?? 0} membres</li>
                          </ul>
                          <Button
                            size="sm"
                            variant={active ? "outline" : "default"}
                            disabled={busy || active}
                            onClick={() => changePlan(plan)}
                            className={cn(
                              "mt-2",
                              !active &&
                                "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                            )}
                          >
                            {busy ? "Changement…" : active ? "Plan actuel" : "Changer"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-5">
                <p className="mb-3 text-sm font-semibold text-foreground">Packs disponibles</p>
                <CreditBuyCard />
              </div>

              <div className="mt-5 flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Carte enregistrée</span>
                  <span className="text-xs text-muted-foreground">•••• 4242</span>
                </div>
                <Button variant="ghost" size="sm">Modifier</Button>
              </div>
            </SectionCard>
          )}

          {tab === "parrainage" && <ReferralTab />}

          {tab === "notifications" && (
            <SectionCard
              title="Notifications"
              desc="Choisissez ce que Make It doit vous signaler."
            >
              <ul className="divide-y divide-border">
                {NOTIFICATION_TYPES.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{n.label}</p>
                      <p className="text-xs text-muted-foreground text-pretty">{n.desc}</p>
                    </div>
                    <Switch
                      checked={notif[n.id]}
                      onCheckedChange={(v) =>
                        setNotif({ ...notif, [n.id]: v })
                      }
                      aria-label={n.label}
                    />
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {tab === "apparence" && (
            <SectionCard
              title="Apparence"
              desc="Choisissez le thème de l'interface."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-md">
                <ThemeOption
                  active={theme !== "dark"}
                  label="Clair"
                  icon={<Sun className="h-4 w-4" />}
                  description="Lumineux, épuré"
                  onClick={() => setTheme("light")}
                />
                <ThemeOption
                  active={theme === "dark"}
                  label="Sombre"
                  icon={<Moon className="h-4 w-4" />}
                  description="Reposant le soir"
                  onClick={() => setTheme("dark")}
                />
              </div>
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/40 px-3 py-2 text-xs font-medium text-[color:var(--emerald-accent)]">
                <Sparkles className="h-3.5 w-3.5" />
                Make It est optimisé pour le mode clair.
              </p>
            </SectionCard>
          )}
        </div>
      </div>

      {/* ---------- Bottom: logout ---------- */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await signOut();
              toast.success("Vous êtes déconnecté");
            } catch (e) {
              toast.error("Déconnexion impossible", {
                description: e instanceof Error ? e.message : undefined,
              });
            }
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 hover:text-rose-700"
        >
          <LogOut className="h-3.5 w-3.5" />
          Déconnexion
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- Subcomponents ----------------------------- */

function SectionCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {desc && <p className="mt-1 text-sm text-muted-foreground text-pretty">{desc}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function ThemeOption({
  active,
  label,
  icon,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors",
        active
          ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
          : "border-border bg-card hover:border-foreground/20"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-lg",
            active ? "bg-white/10 text-[color:var(--primary-foreground)]" : "bg-muted/60 text-foreground"
          )}
        >
          {icon}
        </span>
        <div>
          <p className={cn("text-sm font-semibold", active ? "text-[color:var(--primary-foreground)]" : "text-foreground")}>
            {label}
          </p>
          <p className={cn("text-xs", active ? "text-[color:var(--primary-foreground)]/80" : "text-muted-foreground")}>
            {description}
          </p>
        </div>
      </div>
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full border-2",
          active ? "border-[color:var(--primary-foreground)] bg-[color:var(--primary-foreground)]" : "border-border"
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-[color:var(--ink)]" />}
      </span>
    </button>
  );
}

/* ----------------------------- Agency tab ----------------------------- */

type AgencyTabProps = {
  agency: {
    agency: {
      id: string;
      name: string;
      slug: string;
      status: string;
      mode: string;
      createdAt: string;
    };
    role: "admin" | "manager" | "creative";
    wallet: {
      totalCredits: number;
      reservedCredits: number;
      totalConsumed: number;
      available: number;
    };
    clientCount: number;
    memberCount: number;
  } | null;
  loading: boolean;
  activating: boolean;
  deactivating: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onGoToPortfolio: () => void;
};

function AgencyTab({
  agency,
  loading,
  activating,
  deactivating,
  onActivate,
  onDeactivate,
  onGoToPortfolio,
}: AgencyTabProps) {
  if (loading) {
    return (
      <SectionCard title="Mode Agence" desc="Chargement…">
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Vérification de l'activation…
        </div>
      </SectionCard>
    );
  }

  // NOT activated — show the activation card.
  if (!agency) {
    return (
      <SectionCard
        title="Mode Agence"
        desc="Gérez tous vos clients depuis un seul compte."
      >
        <div className="surface-hero overflow-hidden p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
              <Building2 className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                Make It for Agencies
              </h3>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground text-pretty">
                Gérez tous vos clients depuis un seul compte. Centralisez vos
                crédits, votre équipe et votre bibliothèque de contenus.
                Basculez d'un client à l'autre en un clic.
              </p>
            </div>
          </div>

          <ul className="mt-5 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
            <Feature text="Portfolio clients avec scores Make It" />
            <Feature text="Crédits mutualisés ou quotas par client" />
            <Feature text="Équipe (managers, créatifs, admin)" />
            <Feature text="Bibliothèque de contenus réutilisables" />
            <Feature text="Workflow de validation (CDP + client)" />
            <Feature text="Rapports en marque blanche" />
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={activating}
              onClick={onActivate}
              className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              {activating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Activation…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Activer le mode agence
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Votre workspace actuel devient le premier client de l'agence.
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  // ACTIVATED — show the overview.
  const roleLabel =
    agency.role === "admin"
      ? "Administrateur"
      : agency.role === "manager"
      ? "Manager"
      : "Créatif";
  return (
    <SectionCard
      title="Mode Agence"
      desc="Votre agence est active. Gérez vos clients, votre équipe et vos crédits."
    >
      {/* Hero overview */}
      <div className="surface-accent overflow-hidden p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">
                {agency.agency.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {roleLabel} · Mode {agency.agency.mode === "quotas" ? "quotas" : "pool"} ·{" "}
                <span className="text-[color:var(--emerald-accent)]">Actif</span>
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onGoToPortfolio}
            className="border-[color:var(--emerald-accent)] text-[color:var(--emerald-accent)] hover:bg-[color:var(--accent)]/40"
          >
            Aller au Portfolio agence
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AgencyStat
          icon={<Building2 className="h-4 w-4" />}
          label="Clients"
          value={agency.clientCount}
        />
        <AgencyStat
          icon={<Users className="h-4 w-4" />}
          label="Membres"
          value={agency.memberCount}
        />
        <AgencyStat
          icon={<Sparkles className="h-4 w-4" />}
          label="Crédits dispo"
          value={agency.wallet.available}
        />
        <AgencyStat
          icon={<CreditCard className="h-4 w-4" />}
          label="Consommés"
          value={agency.wallet.totalConsumed}
        />
      </div>

      {/* Deactivation */}
      <div className="mt-2 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Désactiver le mode agence
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Vos clients seront archivés (données conservées). Vous pourrez
            réactiver le mode agence à tout moment. Cette action est réservée
            aux administrateurs.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={deactivating || agency.role !== "admin"}
              className="border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Power className="h-3.5 w-3.5" />
              {deactivating ? "Désactivation…" : "Désactiver"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Désactiver le mode agence ?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Cette action va archiver les {agency.clientCount} client
                {agency.clientCount > 1 ? "s" : ""} de votre agence. Les
                données seront conservées et vous pourrez réactiver le mode
                agence à tout moment. Les membres de l'équipe perdront leur
                accès aux clients archivés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deactivating}>
                Annuler
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onDeactivate}
                disabled={deactivating}
                className="bg-rose-600 text-white hover:bg-rose-700"
              >
                {deactivating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Désactivation…
                  </>
                ) : (
                  "Désactiver"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SectionCard>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-xs text-foreground">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--emerald-accent)]" />
      <span className="text-pretty">{text}</span>
    </li>
  );
}

function AgencyStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="surface-card flex items-center gap-2.5 p-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-base font-semibold tabular-nums text-foreground">
          {value.toLocaleString("fr-FR")}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------- Parrainage tab ----------------------------- */

type ReferralStatsResponse = {
  code: string;
  link: string;
  clicks: number;
  signups: number;
  conversions: number;
  creditsEarned: number;
  pendingReferrals: number;
  recentReferrals: Array<{
    id: string;
    referredEmail: string;
    referredName: string | null;
    status: "pending" | "signed_up" | "converted" | "expired";
    invitedAt: string;
    signedUpAt: string | null;
    convertedAt: string | null;
  }>;
};

const REFERRAL_STATUS_META: Record<
  "pending" | "signed_up" | "converted" | "expired",
  { label: string; cls: string }
> = {
  pending: {
    label: "En attente",
    cls: "bg-muted text-muted-foreground",
  },
  signed_up: {
    label: "Inscrit",
    cls:
      "bg-[color:var(--amber-accent)]/15 text-[color:var(--amber-accent)]",
  },
  converted: {
    label: "Abonné",
    cls:
      "bg-[color:var(--emerald-accent)]/15 text-[color:var(--emerald-accent)]",
  },
  expired: {
    label: "Expiré",
    cls: "bg-[color:var(--rose-accent)]/15 text-[color:var(--rose-accent)]",
  },
};

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function ReferralTab() {
  const [stats, setStats] = useState<ReferralStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await apiTry(
        async () => apiGet<ReferralStatsResponse>("/api/referral"),
        null as ReferralStatsResponse | null
      );
      if (cancelled) return;
      setStats(res);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function shareLinkUrl(): string {
    if (!stats) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://makeit.app";
    return `${origin}${stats.link}`;
  }

  async function copyLink() {
    if (!stats) return;
    const url = shareLinkUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Lien copié", { description: "Partagez-le avec vos amis." });
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error("Impossible de copier le lien", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function shareLink() {
    if (!stats) return;
    const url = shareLinkUrl();
    const shareData = {
      title: "Rejoins-moi sur Make It",
      text: "Gérez votre marketing avec l'IA — 30 crédits offerts à l'inscription.",
      url,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled — silent.
      }
    } else {
      await copyLink();
    }
  }

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const res = await apiPost<{ code: string; id: string; createdAt: string }>(
        "/api/referral",
        { confirm: true }
      );
      // Refresh stats — the new code is now active, the old one is dead.
      const fresh = await apiGet<ReferralStatsResponse>("/api/referral");
      setStats(fresh);
      toast.success("Code régénéré", {
        description: `Nouveau code : ${res.code}. Les anciens liens ne fonctionnent plus.`,
      });
    } catch (e) {
      toast.error("Impossible de régénérer le code", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <SectionCard title="Parrainage" desc="Chargement…">
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Récupération de votre code…
        </div>
      </SectionCard>
    );
  }

  if (!stats) {
    return (
      <SectionCard
        title="Parrainage"
        desc="Invitez vos amis, gagnez des crédits IA."
      >
        <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Impossible de charger vos statistiques de parrainage. Rechargez la
          page pour réessayer.
        </div>
      </SectionCard>
    );
  }

  const linkUrl = shareLinkUrl();

  return (
    <SectionCard
      title="Parrainage"
      desc="Invitez vos amis, gagnez des crédits IA."
    >
      {/* Hero */}
      <div className="surface-hero overflow-hidden p-5">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
            <Gift className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              Invitez vos amis, gagnez des crédits IA
            </h3>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              <span className="font-semibold text-[color:var(--ink)]">
                30 crédits
              </span>{" "}
              par inscription confirmée,{" "}
              <span className="font-semibold text-[color:var(--ink)]">
                500 crédits
              </span>{" "}
              par abonnement souscrit. Cumulez sans limite.
            </p>
          </div>
        </div>
      </div>

      {/* Referral link */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-foreground">
          Votre lien de parrainage
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 overflow-hidden rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="truncate font-mono text-sm text-foreground">
              {linkUrl}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copyLink()}
              className="h-11 px-3"
              aria-label="Copier le lien"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copié
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copier
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void shareLink()}
              className="h-11 bg-[color:var(--ink)] px-3 text-[color:var(--primary-foreground)] hover:opacity-90"
              aria-label="Partager le lien"
            >
              <Share2 className="h-4 w-4" /> Partager
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Code : <span className="font-mono font-semibold">{stats.code}</span>
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReferralStat
          icon={<MousePointerClick className="h-4 w-4" />}
          label="Clics"
          value={stats.clicks}
        />
        <ReferralStat
          icon={<UserPlus className="h-4 w-4" />}
          label="Inscriptions"
          value={stats.signups}
        />
        <ReferralStat
          icon={<CreditCard className="h-4 w-4" />}
          label="Abonnements"
          value={stats.conversions}
        />
        <ReferralStat
          icon={<Sparkles className="h-4 w-4" />}
          label="Crédits gagnés"
          value={stats.creditsEarned}
          accent
        />
      </div>

      {/* Recent referrals */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">
            Filleuls récents
          </p>
          {stats.pendingReferrals > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--amber-accent)]/15 px-2 py-0.5 text-[11px] font-medium text-[color:var(--amber-accent)]">
              {stats.pendingReferrals} en attente
            </span>
          )}
        </div>
        {stats.recentReferrals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            Aucun filleul pour le moment. Partagez votre lien pour inviter vos
            amis.
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border scroll-premium">
            {stats.recentReferrals.map((r) => {
              const meta = REFERRAL_STATUS_META[r.status] ?? REFERRAL_STATUS_META.pending;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.referredName || maskEmail(r.referredEmail)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {maskEmail(r.referredEmail)} · Invité le{" "}
                      {formatDate(r.invitedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        meta.cls
                      )}
                    >
                      {meta.label}
                    </span>
                    {r.status === "converted" && r.convertedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Abonné le {formatDate(r.convertedAt)}
                      </span>
                    )}
                    {r.status === "signed_up" && r.signedUpAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Inscrit le {formatDate(r.signedUpAt)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Regenerate */}
      <div className="mt-2 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Régénérer mon code
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Un nouveau code sera créé. Les liens déjà partagés avec l&apos;ancien
            code ne fonctionneront plus. Vos filleuls existants sont conservés.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={regenerating}
              className="h-11 border-[color:var(--ink)] text-[color:var(--ink)] hover:bg-[color:var(--accent)]/40"
            >
              {regenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Régénération…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Régénérer
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Régénérer votre code de parrainage ?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Cette action crée un nouveau code et désactive l&apos;ancien.
                Tous les liens partagés avec le code{" "}
                <span className="font-mono font-semibold">{stats.code}</span>{" "}
                ne fonctionneront plus. Vous ne perdez aucun filleul — seuls
                les futurs visiteurs devront utiliser le nouveau lien.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={regenerating}>
                Annuler
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void regenerate()}
                disabled={regenerating}
                className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
              >
                {regenerating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Régénération…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" /> Régénérer
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Help / open the link myself */}
      <div className="flex items-center justify-end">
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Voir ma page de parrainage
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </SectionCard>
  );
}

function ReferralStat({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border p-3",
        accent
          ? "border-[color:var(--ink)]/30 bg-[color:var(--accent)]/40"
          : "border-border bg-card"
      )}
    >
      <span
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg",
          accent
            ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
            : "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-base font-semibold tabular-nums text-foreground">
          {value.toLocaleString("fr-FR")}
        </p>
      </div>
    </div>
  );
}
