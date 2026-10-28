"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AIAdvisor, AdvisorFab } from "@/components/shared/AIAdvisor";
import { CreditPopover } from "@/components/shared/CreditPopover";
import { NotificationsCenter } from "@/components/shared/NotificationsCenter";
import { OnboardingFlow } from "@/components/shared/OnboardingFlow";
import { AIBadge, MakeItMark } from "@/components/shared/AIBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { activeSection, creditsOpen, notificationsOpen, onboardingDone } = useAppStore();
  const { status, refreshWallet } = useAuth();
  const isStudioSection = activeSection === "studio";

  // Pull the wallet once on mount when authed (in case the socket hasn't pushed
  // an update yet) — this also seeds `renewalDate` / `plan` which the socket
  // event doesn't include.
  useEffect(() => {
    if (status === "authed") void refreshWallet();
     
  }, [status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-[color:var(--emerald-accent)]" />
          <p className="text-sm">Chargement de Make It…</p>
        </div>
      </div>
    );
  }

  if (status === "guest") {
    return <LoginScreen />;
  }

  return (
    <div className={cn("flex w-full bg-background", isStudioSection ? "h-dvh overflow-hidden" : "min-h-screen")}>
      <Sidebar />
      <div className={cn("flex flex-1 flex-col md:pl-0", isStudioSection ? "min-h-0" : "min-h-screen")}>
        <Header />
        <main className={cn("flex-1 px-4 py-5 md:px-6 md:py-6", isStudioSection && "min-h-0 overflow-hidden p-0")}>
          <div className={cn("mx-auto w-full max-w-7xl", isStudioSection && "h-full max-w-none")}>{children}</div>
        </main>
        <footer className={cn("mt-auto border-t border-border bg-background/60 px-4 py-4 md:px-6", isStudioSection && "hidden")}>
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
            <p>Make It — Votre équipe marketing digitale propulsée par l'IA.</p>
            <p>Connecté · Mises à jour en temps réel actives.</p>
          </div>
        </footer>
      </div>

      {/* Overlays */}
      <AIAdvisor />
      <AdvisorFab />
      {creditsOpen && <CreditPopover />}
      {notificationsOpen && <NotificationsCenter />}
      {!onboardingDone && <OnboardingFlow />}
    </div>
  );
}

function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("demo@makeit.app");
  const [password, setPassword] = useState("makeit");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      toast.success("Bienvenue 👋", { description: "Connexion réussie." });
    } catch (err) {
      toast.error("Connexion impossible", {
        description: err instanceof Error ? err.message : "Réessayez.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 bg-dotted opacity-60"
        aria-hidden
      />
      <div className="relative w-full max-w-md">
        <div className="surface-card p-6 sm:p-8 shadow-xl">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="mt-4">
              <MakeItMark />
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
              Make It
            </h1>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Votre équipe marketing digitale, propulsée par l'IA.
            </p>
            <div className="mt-3">
              <AIBadge label="Conseiller IA · Studio · Calendrier" />
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-pwd" className="text-sm font-medium">
                Mot de passe
              </label>
              <Input
                id="login-pwd"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={busy}
              className={cn(
                "h-11 w-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90",
                busy && "opacity-70"
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connexion…
                </>
              ) : (
                <>
                  Se connecter <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Compte démo</p>
            <p className="mt-0.5 text-pretty">
              Pré-rempli : <span className="font-mono">demo@makeit.app</span> /{" "}
              <span className="font-mono">makeit</span>. Camille, Atelier
              Lumière, 5 000 crédits IA, contenu et campagnes de démonstration.
            </p>
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <a
              href="/register"
              className="font-semibold text-[color:var(--ink)] hover:underline"
            >
              Créer un compte
            </a>
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground/70">
          En continuant, vous acceptez les conditions d'utilisation de Make It.
        </p>
      </div>
    </div>
  );
}
