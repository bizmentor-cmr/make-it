"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export function AIBadge({ className, label = "IA" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
        className
      )}
    >
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}

export function MakeItMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--ink)] text-[color:var(--primary-foreground)]">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="text-base font-semibold tracking-tight text-foreground">Make&nbsp;It</span>
    </span>
  );
}
