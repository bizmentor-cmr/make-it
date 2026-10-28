"use client";

import { useState } from "react";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const studioBaseUrl = (
  process.env.NEXT_PUBLIC_STUDIO_URL || "http://localhost:3001"
).replace(/\/+$/, "");
const studioUrl = `${studioBaseUrl}/studio/image`;

export function StudioSection() {
  const [frameVersion, setFrameVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#08090d] text-white">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0d0e13] px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Make it Studio</h1>
            <p className="truncate text-xs text-white/50">
              Espace créatif intégré à Make It
              {isLoading ? " · Connexion au Studio…" : " · Prêt"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              setFrameVersion((version) => version + 1);
            }}
            className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            aria-label="Recharger Make it Studio"
            title="Recharger le Studio"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <a href={studioUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Ouvrir séparément</span>
            </a>
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#08090d] text-sm text-white/60">
            Chargement de Make it Studio…
          </div>
        )}
        <iframe
          key={frameVersion}
          src={studioUrl}
          title="Make it Studio"
          className="block h-full min-h-0 w-full border-0 bg-[#08090d]"
          allow="clipboard-read; clipboard-write; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setIsLoading(false)}
        />
      </div>
    </section>
  );
}
