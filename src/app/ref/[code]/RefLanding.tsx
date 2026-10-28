"use client";

// Make It — Referral landing component.
// Mounted by /ref/[code]/page.tsx inside <Suspense>.
//
// We resolve the [code] route param asynchronously (Next.js 16 returns a
// Promise for params), validate the code via GET /api/referral/validate, and
// fire-and-forget POST /api/referral/track. If the user is already authed we
// show the "Aller à mon espace" + "Créer un nouveau compte" buttons; otherwise
// the main "Créer mon compte" CTA.

import { useEffect, useState, use, useRef } from "react";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Users,
  Gift,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AIBadge, MakeItMark } from "@/components/shared/AIBadge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";

type ValidateResult = {
  valid: boolean;
  referrerName: string | null;
  code: string | null;
};

type TrackResult = {
  recorded: boolean;
  referrerName: string | null;
};

export function RefLanding({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode).toLowerCase();
  const { status } = useAuth();

  const [validate, setValidate] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(true);
  const trackedRef = useRef(false);

  // Validate the code on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setValidating(true);
      const res = await apiTry(
        async () =>
          apiGet<ValidateResult>(`/api/referral/validate?code=${encodeURIComponent(code)}`),
        { valid: false, referrerName: null, code: null } as ValidateResult
      );
      if (cancelled) return;
      setValidate(res);
      setValidating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Track the click — fire-and-forget, only once. We use a ref guard so the
  // setState lint rule doesn't fire (and we don't trigger cascading renders).
  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;
    void apiTry(
      async () => apiPost<TrackResult>("/api/referral/track", { code }),
      { recorded: false, referrerName: null } as TrackResult
    );
  }, [code]);

  const valid = validate?.valid === true;
  const referrerName = validate?.referrerName ?? null;
  const isAuthed = status === "authed";

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-dotted opacity-60" aria-hidden />
      <div className="relative w-full max-w-2xl">
        {/* Brand header */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" aria-label="Make It — accueil">
            <MakeItMark />
          </Link>
          <AIBadge label="Parrainage" />
        </div>

        <div className="surface-hero overflow-hidden p-6 shadow-xl sm:p-10">
          {validating ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-[color:var(--ink)]" />
              <p className="text-sm">Vérification du code…</p>
            </div>
          ) : valid ? (
            <div className="flex flex-col items-center text-center">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm">
                <Sparkles className="h-7 w-7" />
              </span>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {referrerName
                  ? <>Invité par <span className="text-[color:var(--ink)]">{referrerName}</span></>
                  : "Bienvenue sur Make It"}
              </h1>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground text-pretty sm:text-base">
                Rejoignez Make It — votre équipe marketing digitale propulsée
                par l&apos;IA. Stratège, créateur, community manager, analyste :
                tout dans une seule application.
              </p>
              <div className="mt-4">
                <AIBadge label="Conseiller IA · Studio · Calendrier" />
              </div>

              {/* Benefits */}
              <ul className="mt-6 grid w-full grid-cols-1 gap-2.5 text-left text-sm sm:grid-cols-2">
                <Benefit icon={<Gift className="h-4 w-4" />} text="30 crédits IA offerts à l'inscription" />
                <Benefit icon={<Users className="h-4 w-4" />} text="500 crédits IA bonus à l'abonnement" />
                <Benefit icon={<Sparkles className="h-4 w-4" />} text="Génération de contenu par IA" />
                <Benefit icon={<CheckCircle2 className="h-4 w-4" />} text="Sans engagement, sans carte bancaire" />
              </ul>

              {/* CTAs */}
              <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
                {isAuthed ? (
                  <>
                    <Link href="/" className="flex-1 sm:flex-none">
                      <Button
                        size="lg"
                        className="h-12 w-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 sm:w-auto sm:px-8"
                      >
                        Aller à mon espace <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Link
                      href={`/register?ref=${encodeURIComponent(code)}`}
                      className="flex-1 sm:flex-none"
                    >
                      <Button
                        size="lg"
                        variant="outline"
                        className="h-12 w-full sm:w-auto sm:px-8"
                      >
                        Créer un nouveau compte
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href={`/register?ref=${encodeURIComponent(code)}`}
                      className="flex-1 sm:flex-none"
                    >
                      <Button
                        size="lg"
                        className="h-12 w-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 sm:w-auto sm:px-8"
                      >
                        Créer mon compte <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Link href="/" className="flex-1 sm:flex-none">
                      <Button
                        size="lg"
                        variant="outline"
                        className="h-12 w-full sm:w-auto sm:px-8"
                      >
                        J&apos;ai déjà un compte
                      </Button>
                    </Link>
                  </>
                )}
              </div>

              <p className="mt-6 text-xs text-muted-foreground">
                Code de parrainage : <span className="font-mono font-semibold">{code}</span>
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
                <Sparkles className="h-7 w-7" />
              </span>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Ce lien de parrainage n&apos;est plus valide
              </h1>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground text-pretty">
                Le code <span className="font-mono">{code}</span> est introuvable
                ou a été désactivé par son propriétaire. Vous pouvez quand même
                créer un compte Make It — vous serez simplement sans parrain.
              </p>
              <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
                <Link href="/register" className="flex-1 sm:flex-none">
                  <Button
                    size="lg"
                    className="h-12 w-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90 sm:w-auto sm:px-8"
                  >
                    Créer mon compte <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/" className="flex-1 sm:flex-none">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 w-full sm:w-auto sm:px-8"
                  >
                    J&apos;ai déjà un compte
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          En continuant, vous acceptez les conditions d&apos;utilisation de Make It.
        </p>
      </div>
    </div>
  );
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 text-foreground">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
        {icon}
      </span>
      <span className="text-pretty text-sm">{text}</span>
    </li>
  );
}
