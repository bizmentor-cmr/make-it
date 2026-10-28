"use client";

import { cn } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/mock-data";

export function PlatformBadge({
  platform,
  size = "md",
  showLabel = true,
  className,
}: {
  platform: Platform;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const meta = PLATFORM_META[platform];
  const dims = size === "sm" ? "h-5 w-5 text-[10px]" : size === "lg" ? "h-9 w-9 text-sm" : "h-7 w-7 text-[11px]";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn("inline-flex items-center justify-center rounded-md font-semibold", dims)}
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.initials}
      </span>
      {showLabel && (
        <span className="text-sm font-medium text-foreground/80">{meta.label}</span>
      )}
    </span>
  );
}

export function PlatformDot({ platform, className }: { platform: Platform; className?: string }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold", className)}
      style={{ background: meta.bg, color: meta.color }}
      title={meta.label}
    >
      {meta.initials}
    </span>
  );
}
