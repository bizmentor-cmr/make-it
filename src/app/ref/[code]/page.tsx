// Make It — /ref/[code] — Public referral landing page.
//
// A visitor lands here when someone shares their /ref/{code} link. The page:
//   1. Validates the code via GET /api/referral/validate (returns referrer name).
//   2. Tracks the click via POST /api/referral/track (fire-and-forget).
//   3. Shows a branded hero ("Invité par [name]") with a CTA to /register?ref=CODE.
//   4. If the visitor is already logged in, shows "Aller à mon espace" +
//      "Créer un nouveau compte" buttons instead.
//
// Mobile-first, violet theme, surface-hero + Make It mark.

import { Suspense } from "react";
import { RefLanding } from "./RefLanding";

export const dynamic = "force-dynamic";

export default function RefLandingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <Suspense fallback={<RefLandingSkeleton />}>
      <RefLanding params={params} />
    </Suspense>
  );
}

function RefLandingSkeleton() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--ink)] border-t-transparent" />
        <p className="text-sm">Chargement…</p>
      </div>
    </div>
  );
}
