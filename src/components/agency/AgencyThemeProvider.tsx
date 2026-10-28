"use client";

// Make It — AgencyThemeProvider.
//
// Toggles the `theme-agency` class on <html> based on the store's `mode`.
// In agency mode the accent shifts to emerald (violet + emerald combo =
// Make It for Agencies logo colors). Also updates the document title.
//
// This is a client component because layout.tsx is a server component and
// cannot read the Zustand store directly.

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";

const SOLO_TITLE = "Make It — Votre équipe marketing digitale propulsée par l'IA";
const AGENCY_TITLE = "Make It for Agencies — Gérez tous vos clients depuis un seul compte";

export function AgencyThemeProvider() {
  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "agency") {
      root.classList.add("theme-agency");
      if (typeof document !== "undefined") {
        document.title = AGENCY_TITLE;
      }
    } else {
      root.classList.remove("theme-agency");
      if (typeof document !== "undefined") {
        document.title = SOLO_TITLE;
      }
    }
  }, [mode]);

  // No visual output — this component only mutates the document.
  return null;
}
