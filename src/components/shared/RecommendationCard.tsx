"use client";

import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export function RecommendationCard({
  icon,
  title,
  reason,
  cta,
  tone = "emerald",
  onCta,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  reason?: string;
  cta?: string;
  tone?: "emerald" | "amber" | "rose" | "violet" | "ink";
  onCta?: () => void;
  className?: string;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
    amber: "bg-amber-100 text-amber-900",
    rose: "bg-rose-100 text-rose-900",
    violet: "bg-violet-100 text-violet-900",
    ink: "bg-foreground/5 text-foreground",
  };
  return (
    <div className={cn("surface-card p-4", className)}>
      <div className="flex gap-3">
        {icon && (
          <div className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground text-balance">{title}</p>
          {reason && <p className="mt-1 text-sm text-muted-foreground text-pretty">{reason}</p>}
          {cta && (
            <button
              onClick={onCta}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-sm font-medium text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              {cta} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InsightStat({
  label,
  value,
  delta,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
      ? "text-rose-600"
      : tone === "warn"
      ? "text-amber-600"
      : "text-muted-foreground";
  const deltaColor = (delta ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600";
  return (
    <div className="surface-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {delta !== undefined && (
          <span className={cn("text-xs font-medium", deltaColor)}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      {hint && <p className={cn("mt-1 text-xs", toneCls)}>{hint}</p>}
    </div>
  );
}
