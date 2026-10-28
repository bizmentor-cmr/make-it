// Make It — Montage editor types.
// Mirrors the backend EditData / Layer shape defined in
// `src/server/modules/video/service.ts` so the editor can save/load projects
// directly against `/api/video-projects`.

export type LayerKind =
  | "image"
  | "video"
  | "text"
  | "shape"
  | "audio"
  | "sticker";

export type Filters = {
  brightness?: number; // 1 = normal
  contrast?: number;
  saturate?: number;
  blur?: number; // px
  grayscale?: number; // 0..1
  sepia?: number; // 0..1
  hueRotate?: number; // deg
};

export type ShapeKind = "rect" | "circle" | "line" | "triangle";

export type Layer = {
  id: string;
  kind: LayerKind;
  name: string;
  x: number; // % of canvas (top-left)
  y: number;
  w: number; // % of canvas
  h: number;
  rotation: number; // deg
  opacity: number; // 0..1
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  start: number; // seconds (timeline)
  end: number; // seconds (timeline)
  filters?: Filters;
  // media
  src?: string;
  thumb?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  duration?: number; // for video/audio
  // text
  text?: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  backgroundColor?: string;
  padding?: number;
  // shape
  shape?: ShapeKind;
  fill?: string;
  radius?: number; // border radius (px) for rect
  // sticker
  emoji?: string;
  // audio
  volume?: number; // 0..1
  muted?: boolean;
};

export type EditData = {
  layers: Layer[];
  duration: number;
  fps?: number;
  background?: string;
};

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  url: string;
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
  uploading?: boolean;
};

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

export type VideoProject = {
  id: string;
  name: string;
  aspectRatio: string;
  duration: number;
  status: string;
  renderUrl: string | null;
  contentId: string | null;
  editData?: EditData | null;
  createdAt: string;
  updatedAt: string;
};

export type FilterPreset = {
  id: string;
  label: string;
  filters: Filters;
};

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "none", label: "Aucun", filters: {} },
  { id: "vif", label: "Vif", filters: { brightness: 1.1, contrast: 1.2, saturate: 1.3 } },
  { id: "doux", label: "Doux", filters: { brightness: 1.05, contrast: 0.95, saturate: 0.9, blur: 0.5 } },
  { id: "vintage", label: "Vintage", filters: { brightness: 1.05, contrast: 1.05, saturate: 0.85, sepia: 0.4 } },
  { id: "nb", label: "N&B", filters: { grayscale: 1, contrast: 1.1 } },
  { id: "froid", label: "Froid", filters: { hueRotate: 180, saturate: 1.1, brightness: 1.05 } },
  { id: "chaud", label: "Chaud", filters: { sepia: 0.3, saturate: 1.2, brightness: 1.05, hueRotate: -10 } },
];

export const EMOJI_PALETTE = [
  "😀","😎","🥳","😍","🤩","🤔","👀","💪",
  "❤️","🔥","✨","🎉","🌟","💯","🌈","🍕",
  "☕","🎧","📸","🎬","🚀","💎","👑","🎯",
  "✅","⚡","🌸","🍀","🎈","🎀","💡","🎨",
];

export const FONT_FAMILIES = [
  "Geist Sans, sans-serif",
  "'Playfair Display', Georgia, serif",
  "Georgia, serif",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
] as const;

// Build a CSS filter string from a Filters object.
export function filterCss(f?: Filters): string {
  if (!f) return "none";
  const parts: string[] = [];
  if (f.brightness != null) parts.push(`brightness(${f.brightness})`);
  if (f.contrast != null) parts.push(`contrast(${f.contrast})`);
  if (f.saturate != null) parts.push(`saturate(${f.saturate})`);
  if (f.blur != null) parts.push(`blur(${f.blur}px)`);
  if (f.grayscale != null) parts.push(`grayscale(${f.grayscale})`);
  if (f.sepia != null) parts.push(`sepia(${f.sepia})`);
  if (f.hueRotate != null) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  return parts.length ? parts.join(" ") : "none";
}

// Detect the closest filter preset id given a Filters object (used to highlight
// the active preset chip).
export function matchPreset(f?: Filters): string | null {
  if (!f || Object.keys(f).length === 0) return "none";
  for (const p of FILTER_PRESETS) {
    if (p.id === "none") continue;
    const keys = Object.keys(p.filters);
    if (keys.length !== Object.keys(f).length) continue;
    const same = keys.every((k) => (f as Record<string, number>)[k] === (p.filters as Record<string, number>)[k]);
    if (same) return p.id;
  }
  return null;
}
