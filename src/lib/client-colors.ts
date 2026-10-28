// Make It — Premium 9-color client palette.
// Each client (an AgencyClient) gets a deterministic color based on its id
// (or its name when only the name is known — e.g. before the switcher has
// fetched the client list). The color is used as a left border, dot, top
// accent bar, score ring stroke, and avatar background — giving the agency
// a quick visual cue of which client they're operating on, consistently
// across the portfolio grid, the switcher, the sidebar and the header.
//
// The hash is FNV-1a (32-bit) — deterministic, fast, and well-distributed
// for small id spaces (cuid strings).

export type ClientColorKey =
  | "violet"
  | "fuchsia"
  | "rose"
  | "orange"
  | "ambre"
  | "citron"
  | "emeraude"
  | "sarcelle"
  | "cyan";

export type ClientColor = {
  key: ClientColorKey;
  label: string; // FR label
  hex: string; // main color hex (for inline styles / svg stroke)
  soft: string; // soft tint hex (for backgrounds)
  // Tailwind class strings — kept as plain strings so they survive purge when
  // referenced dynamically. Each is a complete class list (e.g. "bg-violet-500").
  dot: string; // status dot bg
  softBg: string; // soft background
  border: string; // 1-2px border
  borderLeft: string; // 4px left border accent (cards)
  ring: string; // ring color (focus state)
  text: string; // text color
  bar: string; // 2px top/bottom accent bar
  gradient: string; // avatar gradient (from/to)
  avatarBg: string; // solid avatar background
  avatarText: string; // avatar text color
  stroke: string; // score ring stroke color (svg stroke)
};

// ── Palette ──────────────────────────────────────────────────────────────
// Order matters — `getClientColor(id)` picks palette[hash(id) % 9].
const PALETTE: ClientColor[] = [
  {
    key: "violet",
    label: "Violet",
    hex: "#7c3aed",
    soft: "#ede9fe",
    dot: "bg-violet-500",
    softBg: "bg-violet-50",
    border: "border-violet-500",
    borderLeft: "border-l-4 border-l-violet-500",
    ring: "ring-violet-500/40",
    text: "text-violet-700",
    bar: "bg-violet-500",
    gradient: "from-violet-500 to-fuchsia-500",
    avatarBg: "bg-violet-500",
    avatarText: "text-white",
    stroke: "#7c3aed",
  },
  {
    key: "fuchsia",
    label: "Fuchsia",
    hex: "#c026d3",
    soft: "#fae8ff",
    dot: "bg-fuchsia-500",
    softBg: "bg-fuchsia-50",
    border: "border-fuchsia-500",
    borderLeft: "border-l-4 border-l-fuchsia-500",
    ring: "ring-fuchsia-500/40",
    text: "text-fuchsia-700",
    bar: "bg-fuchsia-500",
    gradient: "from-fuchsia-500 to-pink-500",
    avatarBg: "bg-fuchsia-500",
    avatarText: "text-white",
    stroke: "#c026d3",
  },
  {
    key: "rose",
    label: "Rose",
    hex: "#e11d48",
    soft: "#ffe4e6",
    dot: "bg-rose-500",
    softBg: "bg-rose-50",
    border: "border-rose-500",
    borderLeft: "border-l-4 border-l-rose-500",
    ring: "ring-rose-500/40",
    text: "text-rose-700",
    bar: "bg-rose-500",
    gradient: "from-rose-500 to-pink-500",
    avatarBg: "bg-rose-500",
    avatarText: "text-white",
    stroke: "#e11d48",
  },
  {
    key: "orange",
    label: "Orange",
    hex: "#ea580c",
    soft: "#ffedd5",
    dot: "bg-orange-500",
    softBg: "bg-orange-50",
    border: "border-orange-500",
    borderLeft: "border-l-4 border-l-orange-500",
    ring: "ring-orange-500/40",
    text: "text-orange-700",
    bar: "bg-orange-500",
    gradient: "from-orange-500 to-amber-500",
    avatarBg: "bg-orange-500",
    avatarText: "text-white",
    stroke: "#ea580c",
  },
  {
    key: "ambre",
    label: "Ambre",
    hex: "#d97706",
    soft: "#fef3c7",
    dot: "bg-amber-500",
    softBg: "bg-amber-50",
    border: "border-amber-500",
    borderLeft: "border-l-4 border-l-amber-500",
    ring: "ring-amber-500/40",
    text: "text-amber-700",
    bar: "bg-amber-500",
    gradient: "from-amber-500 to-yellow-500",
    avatarBg: "bg-amber-500",
    avatarText: "text-white",
    stroke: "#d97706",
  },
  {
    key: "citron",
    label: "Citron",
    hex: "#65a30d",
    soft: "#ecfccb",
    dot: "bg-lime-500",
    softBg: "bg-lime-50",
    border: "border-lime-500",
    borderLeft: "border-l-4 border-l-lime-500",
    ring: "ring-lime-500/40",
    text: "text-lime-700",
    bar: "bg-lime-500",
    gradient: "from-lime-500 to-green-500",
    avatarBg: "bg-lime-500",
    avatarText: "text-white",
    stroke: "#65a30d",
  },
  {
    key: "emeraude",
    label: "Émeraude",
    hex: "#059669",
    soft: "#d1fae5",
    dot: "bg-emerald-500",
    softBg: "bg-emerald-50",
    border: "border-emerald-500",
    borderLeft: "border-l-4 border-l-emerald-500",
    ring: "ring-emerald-500/40",
    text: "text-emerald-700",
    bar: "bg-emerald-500",
    gradient: "from-emerald-500 to-teal-500",
    avatarBg: "bg-emerald-500",
    avatarText: "text-white",
    stroke: "#059669",
  },
  {
    key: "sarcelle",
    label: "Sarcelle",
    hex: "#0d9488",
    soft: "#ccfbf1",
    dot: "bg-teal-500",
    softBg: "bg-teal-50",
    border: "border-teal-500",
    borderLeft: "border-l-4 border-l-teal-500",
    ring: "ring-teal-500/40",
    text: "text-teal-700",
    bar: "bg-teal-500",
    gradient: "from-teal-500 to-cyan-500",
    avatarBg: "bg-teal-500",
    avatarText: "text-white",
    stroke: "#0d9488",
  },
  {
    key: "cyan",
    label: "Cyan",
    hex: "#0891b2",
    soft: "#cffafe",
    dot: "bg-cyan-500",
    softBg: "bg-cyan-50",
    border: "border-cyan-500",
    borderLeft: "border-l-4 border-l-cyan-500",
    ring: "ring-cyan-500/40",
    text: "text-cyan-700",
    bar: "bg-cyan-500",
    gradient: "from-cyan-500 to-sky-500",
    avatarBg: "bg-cyan-500",
    avatarText: "text-white",
    stroke: "#0891b2",
  },
];

export const CLIENT_COLORS: ClientColor[] = PALETTE;

export const CLIENT_COLOR_KEYS: ClientColorKey[] = PALETTE.map((c) => c.key);

// ── FNV-1a hash (32-bit) ──────────────────────────────────────────────────
// Deterministic across runs / machines — cuid strings hash to a stable index.
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h = h * 0x01000193 (FNV prime) — emulated with bit-shifts to stay in 32-bit
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Resolve a deterministic ClientColor for the given client id.
 * Returns the matching ClientColor object (always defined — palette is non-empty).
 */
export function getClientColor(clientId: string | null | undefined): ClientColor {
  if (!clientId) return PALETTE[0];
  return PALETTE[fnv1a(clientId) % PALETTE.length];
}

/**
 * Resolve a deterministic ClientColor for the given client NAME — used when
 * only the name is known (e.g. portfolio card before switch fetch).
 */
export function getClientColorByName(name: string | null | undefined): ClientColor {
  if (!name) return PALETTE[0];
  return PALETTE[fnv1a(name.toLowerCase()) % PALETTE.length];
}

/**
 * Resolve a ClientColor by key — used to keep parity between the switcher
 * and the header bar (both rely on the same `getClientColor(id)`).
 */
export function getClientColorByKey(key: ClientColorKey | string | null | undefined): ClientColor {
  if (!key) return PALETTE[0];
  const found = PALETTE.find((c) => c.key === key);
  return found ?? PALETTE[0];
}
