"use client";

// Make It — Client color badges / dots / avatars (agency mode).
// Reusable presentational primitives backed by `src/lib/client-colors`.
// Each one accepts either a `clientId` (preferred — used by the switcher +
// sidebar + header) or a `colorKey` when the caller already knows which color
// to apply (e.g. the portfolio card passes the same color down to its avatar
// + ring + border so they stay consistent).

import { cn } from "@/lib/utils";
import {
  getClientColor,
  getClientColorByKey,
  type ClientColor,
} from "@/lib/client-colors";

/* ───────────────── ClientColorDot ───────────────── */

export function ClientColorDot({
  clientId,
  colorKey,
  className,
  size = "md",
}: {
  clientId?: string | null;
  colorKey?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const color: ClientColor = clientId
    ? getClientColor(clientId)
    : getClientColorByKey(colorKey);
  const sizeCls =
    size === "xs"
      ? "h-1.5 w-1.5"
      : size === "sm"
      ? "h-2 w-2"
      : size === "lg"
      ? "h-3 w-3"
      : "h-2.5 w-2.5";
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", color.dot, sizeCls, className)}
      style={{ backgroundColor: color.hex }}
      aria-hidden
    />
  );
}

/* ───────────────── ClientColorBadge ───────────────── */

export function ClientColorBadge({
  clientId,
  colorKey,
  name,
  className,
}: {
  clientId?: string | null;
  colorKey?: string | null;
  name?: string | null;
  className?: string;
}) {
  const color: ClientColor = clientId
    ? getClientColor(clientId)
    : getClientColorByKey(colorKey);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        color.softBg,
        color.text,
        className
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color.hex }}
        aria-hidden
      />
      {name ?? color.label}
    </span>
  );
}

/* ───────────────── ClientColorAvatar ───────────────── */

export function ClientColorAvatar({
  clientId,
  colorKey,
  initials,
  name,
  size = "md",
  className,
}: {
  clientId?: string | null;
  colorKey?: string | null;
  initials?: string | null;
  name?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const color: ClientColor = clientId
    ? getClientColor(clientId)
    : getClientColorByKey(colorKey);
  const sizeCls =
    size === "sm"
      ? "h-8 w-8 text-[11px]"
      : size === "lg"
      ? "h-14 w-14 text-base"
      : "h-11 w-11 text-sm";
  const text =
    initials?.trim() ||
    (name ? name.slice(0, 2).toUpperCase() : "?");
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-semibold shadow-sm",
        color.avatarBg,
        color.avatarText,
        sizeCls,
        className
      )}
      style={{ backgroundColor: color.hex }}
      aria-label={name ?? color.label}
    >
      {text}
    </span>
  );
}
