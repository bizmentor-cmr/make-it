"use client";

// Make It — CreditPopover
//
// Thin wrapper around the unified `RechargeDialog`. Renders only when
// `creditsOpen` is true in the global store (driven by the header pill,
// the CreditMeter "Acheter des crédits" button, the Home quick action, etc.).
//
// The actual UI (wallet summary, packs, referral program) lives in
// `@/components/shared/RechargeDialog`. The scope is auto-detected from
// `useAppStore().mode` (solo or agency).

import { useAppStore } from "@/store/app-store";
import { RechargeDialog } from "@/components/shared/RechargeDialog";

export function CreditPopover() {
  const { creditsOpen, setCreditsOpen, mode } = useAppStore();
  return (
    <RechargeDialog
      open={creditsOpen}
      onClose={() => setCreditsOpen(false)}
      scope={mode === "agency" ? "agency" : "solo"}
    />
  );
}
