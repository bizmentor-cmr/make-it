"use client";

// Make It — Registration form (client component, mounted inside <Suspense>).
//
// Uses `useSearchParams` to read the optional `?ref=` code. On submit we:
//   1. POST /api/auth/register { name, email, password, ref } → creates the
//      user + workspace + (best-effort) referral signup reward.
//   2. Auto sign-in via the NextAuth credentials flow (CSRF → POST
//      /api/auth/callback/credentials → refresh /api/auth/me).
//   3. On success: router.push("/") to land in the freshly-authenticated home.
//
// If `?ref=` is present and validates via GET /api/referral/validate, we show
// a "Parrainé par [name]" badge above the form so the user knows the referral
// was applied.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Loader2,
  Gift,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { AIBadge, MakeItMark } from "@/components/shared/AIBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

type ValidateResult = {
  valid: boolean;
  referrerName: string | null;
  code: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();

  const ref = (searchParams.get("ref") ?? "").trim().toLowerCase();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  // Validate the referral code if present (shows the "Parrainé par" badge).
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    (async () => {
      const res = await apiTry(
        async () =>
          apiGet<ValidateResult>(`/api/referral/validate?code=${encodeURIComponent(ref)}`),
        { valid: false, referrerName: null, code: null } as ValidateResult
      );
      if (cancelled) return;
      if (res?.valid && res.referrerName) {
        setReferrerName(res.referrerName);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Client-side validation (the backend re-checks, but we want instant UX).
    if (!name || name.trim().length < 2) {
      toast.error("Nom requis", { description: "2 caractères minimum." });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      toast.error("Email invalide");
      return;
    }
    if (password.length < 6) {
      toast.error("Mot de passe trop court", { description: "6 caractères minimum." });
      return;
    }
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }

    setBusy(true);
    try {
      // 1) Create the account (registers the user + workspace + referral
      //    signup reward as a side effect if `ref` is provided).
      await apiPost("/api/auth/register", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        ref: ref || undefined,
      });

      // 2) Auto sign-in via the NextAuth credentials flow.
      const csrfRes = await fetch("/api/auth/csrf", { credentials: "include" });
      if (!csrfRes.ok) throw new Error("CSRF indisponible");
      const csrf = (await csrfRes.json()) as { csrfToken: string };
      const formBody = new URLSearchParams({
        email: email.trim().toLowerCase(),
        password,
        csrfToken: csrf.csrfToken,
        json: "true",
      });
      const signInRes = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
        credentials: "include",
      });
      if (!signInRes.ok) {
        // Account was created but auto sign-in failed — send to "/" so the
        // LoginScreen (rendered at "/" for guests) is shown. The toast tells
        // the user what happened.
        toast.success("Compte créé", {
          description: "Connectez-vous pour accéder à votre espace.",
        });
        router.push("/");
        return;
      }

      // 3) Resync the session (so the AuthProvider picks up the new cookies
      //    + workspace before we land on "/").
      try {
        await refresh();
      } catch {
        /* ignore — the redirect will hit "/" which re-probes /api/auth/me */
      }

      toast.success("Bienvenue 👋", {
        description: "Votre compte Make It est prêt.",
      });
      router.push("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Inscription impossible", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-dotted opacity-60" aria-hidden />
      <div className="relative w-full max-w-md">
        <div className="surface-card p-6 shadow-xl sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="mt-4">
              <MakeItMark />
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
              Créer mon compte
            </h1>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Votre équipe marketing digitale, propulsée par l&apos;IA.
            </p>
            <div className="mt-3">
              <AIBadge label="Conseiller IA · Studio · Calendrier" />
            </div>
          </div>

          {/* Referrer badge (only if ref present + validated) */}
          {ref && referrerName && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-[color:var(--accent)] bg-[color:var(--accent)]/50 px-3 py-2.5 text-sm">
              <Gift className="h-4 w-4 text-[color:var(--accent-foreground)]" />
              <p className="text-foreground text-pretty">
                Parrainé par <span className="font-semibold">{referrerName}</span> —{" "}
                <span className="text-[color:var(--accent-foreground)]">30 crédits offerts à l&apos;inscription</span>
              </p>
            </div>
          )}
          {ref && !referrerName && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <Gift className="h-3.5 w-3.5" />
              Code de parrainage <span className="font-mono">{ref}</span> — vérification…
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="reg-name" className="text-sm font-medium">
                Nom complet
              </Label>
              <Input
                id="reg-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Camille Atelier"
                className="h-11"
                required
                minLength={2}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="h-11"
                required
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-pwd" className="text-sm font-medium">
                Mot de passe
              </Label>
              <div className="relative">
                <Input
                  id="reg-pwd"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 pr-11"
                  required
                  minLength={6}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">6 caractères minimum.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-confirm" className="text-sm font-medium">
                Confirmer le mot de passe
              </Label>
              <Input
                id="reg-confirm"
                type={showPwd ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="h-11"
                required
                minLength={6}
                disabled={busy}
              />
              {confirm && confirm !== password && (
                <p className="text-xs text-rose-600">Les mots de passe ne correspondent pas.</p>
              )}
              {confirm && confirm === password && (
                <p className="inline-flex items-center gap-1 text-xs text-[color:var(--emerald-accent)]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Mots de passe identiques.
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Création…
                </>
              ) : (
                <>
                  Créer mon compte <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link
              href="/"
              className="font-semibold text-[color:var(--ink)] hover:underline"
            >
              Se connecter
            </Link>
          </p>

          {/* Hidden ref hint (kept in DOM for screen readers + the referrer badge logic) */}
          {ref && (
            <input type="hidden" name="ref" value={ref} readOnly aria-hidden />
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground/70">
          En continuant, vous acceptez les conditions d&apos;utilisation de Make It.
        </p>
      </div>
    </div>
  );
}
