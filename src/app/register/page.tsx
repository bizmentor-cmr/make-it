// Make It — /register — Public registration page.
//
// Form: name, email, password, confirm. The `?ref=` query param (set when
// the visitor came in via /ref/{code}) is forwarded to POST /api/auth/register
// as the hidden `ref` body field. After a successful registration the user is
// auto-signed-in via the NextAuth credentials flow (CSRF → callback → me) and
// redirected to "/".
//
// CRITICAL: this page is wrapped in <Suspense> because the inner client
// component uses `useSearchParams`. Without the Suspense boundary, `next build`
// fails with "useSearchParams() should be wrapped in a suspense boundary".

import { Suspense } from "react";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterSkeleton />}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterSkeleton() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--ink)] border-t-transparent" />
        <p className="text-sm">Chargement…</p>
      </div>
    </div>
  );
}
