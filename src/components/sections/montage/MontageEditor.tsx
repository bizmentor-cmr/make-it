"use client";

// Make It — Montage editor (Canva/CapCut-lite)
// A full composition editor: import media, add text/shapes/stickers, drag/resize
// layers, apply filters, arrange on a timeline, save & export to the backend.
//
// Backend:
//   GET    /api/video-projects         → list projects
//   POST   /api/video-projects        → create { name, aspectRatio, editData }
//   GET    /api/video-projects/[id]   → load editData
//   PATCH  /api/video-projects/[id]   → save editData (autosave + explicit)
//   DELETE /api/video-projects/[id]   → remove
//   POST   /api/video-projects/[id]/render → async render (render:progress via socket.io)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Type as TypeIcon,
  Shapes,
  Smile,
  Music,
  SlidersHorizontal,
  LayoutTemplate,
  Save,
  Download,
  Undo2,
  Redo2,
  Play,
  Pause,
  Trash2,
  Copy,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Wand2,
  FolderOpen,
  Plus,
  RefreshCw,
  Clock,
  ChevronRight,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { apiPost, apiGet, apiPatch, apiDelete } from "@/lib/api-client";
import { realtime } from "@/lib/realtime-client";
import {
  type AspectRatio,
  type EditData,
  type Filters,
  type Layer,
  type MediaItem,
  type VideoProject,
  EMOJI_PALETTE,
  FILTER_PRESETS,
  FONT_FAMILIES,
  filterCss,
  matchPreset,
} from "./types";

// ─── Templates ──────────────────────────────────────────────────────────────

type Template = {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  build: () => EditData;
};

const TEMPLATES: Template[] = [
  {
    id: "reel-promo",
    name: "Reel promo",
    aspectRatio: "9:16",
    build: () => ({
      duration: 15,
      background: "#0b0f0e",
      layers: [
        {
          id: cryptoId(),
          kind: "shape",
          name: "Fond",
          shape: "rect",
          fill: "#10b981",
          x: 0, y: 0, w: 100, h: 100,
          rotation: 0, opacity: 0.15, zIndex: 0,
          start: 0, end: 15, visible: true,
        },
        {
          id: cryptoId(),
          kind: "text",
          name: "Titre PROMO",
          text: "PROMO -20%",
          fontSize: 56,
          color: "#ffffff",
          fontFamily: FONT_FAMILIES[0],
          fontWeight: 800,
          align: "center",
          backgroundColor: "transparent",
          x: 10, y: 35, w: 80, h: 18,
          rotation: 0, opacity: 1, zIndex: 2,
          start: 0, end: 15, visible: true,
        },
        {
          id: cryptoId(),
          kind: "sticker",
          name: "Sticker 🔥",
          emoji: "🔥",
          x: 38, y: 56, w: 24, h: 18,
          rotation: 0, opacity: 1, zIndex: 1,
          start: 0, end: 15, visible: true,
        },
      ],
    }),
  },
  {
    id: "story-coulisses",
    name: "Story coulisses",
    aspectRatio: "9:16",
    build: () => ({
      duration: 12,
      background: "#f7f5f0",
      layers: [
        {
          id: cryptoId(),
          kind: "shape",
          name: "Bande accent",
          shape: "rect",
          fill: "#f59e0b",
          x: 0, y: 78, w: 100, h: 8,
          rotation: 0, opacity: 1, zIndex: 0,
          start: 0, end: 12, visible: true,
        },
        {
          id: cryptoId(),
          kind: "text",
          name: "Coulisses",
          text: "Dans les coulisses",
          fontSize: 36,
          color: "#0b0f0e",
          fontFamily: FONT_FAMILIES[1],
          fontWeight: 700,
          align: "center",
          backgroundColor: "transparent",
          x: 8, y: 12, w: 84, h: 16,
          rotation: 0, opacity: 1, zIndex: 2,
          start: 0, end: 12, visible: true,
        },
        {
          id: cryptoId(),
          kind: "text",
          name: "Sous-titre",
          text: "On partage tout, en direct.",
          fontSize: 18,
          color: "#444",
          fontFamily: FONT_FAMILIES[0],
          fontWeight: 400,
          align: "center",
          backgroundColor: "transparent",
          x: 10, y: 32, w: 80, h: 8,
          rotation: 0, opacity: 1, zIndex: 1,
          start: 0, end: 12, visible: true,
        },
      ],
    }),
  },
  {
    id: "carrousel-produit",
    name: "Carrousel produit",
    aspectRatio: "1:1",
    build: () => ({
      duration: 10,
      background: "#ffffff",
      layers: [
        {
          id: cryptoId(),
          kind: "shape",
          name: "Encadré",
          shape: "rect",
          fill: "#10b981",
          x: 6, y: 6, w: 88, h: 88,
          radius: 24,
          rotation: 0, opacity: 0.12, zIndex: 0,
          start: 0, end: 10, visible: true,
        },
        {
          id: cryptoId(),
          kind: "text",
          name: "Titre produit",
          text: "Nouveau produit",
          fontSize: 44,
          color: "#0b0f0e",
          fontFamily: FONT_FAMILIES[0],
          fontWeight: 700,
          align: "center",
          backgroundColor: "transparent",
          x: 8, y: 14, w: 84, h: 14,
          rotation: 0, opacity: 1, zIndex: 2,
          start: 0, end: 10, visible: true,
        },
        {
          id: cryptoId(),
          kind: "sticker",
          name: "Sticker ✨",
          emoji: "✨",
          x: 38, y: 60, w: 24, h: 24,
          rotation: 0, opacity: 1, zIndex: 1,
          start: 0, end: 10, visible: true,
        },
      ],
    }),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cryptoId(): string {
  // crypto.randomUUID is available in modern browsers + Node 19+
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function clone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

const KIND_COLOR: Record<Layer["kind"], string> = {
  image: "bg-emerald-500",
  video: "bg-teal-500",
  text: "bg-violet-500",
  shape: "bg-amber-500",
  sticker: "bg-rose-500",
  audio: "bg-[color:var(--ink)]",
};

const KIND_LABEL: Record<Layer["kind"], string> = {
  image: "Image",
  video: "Vidéo",
  text: "Texte",
  shape: "Forme",
  sticker: "Sticker",
  audio: "Audio",
};

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${cs}`;
}

function aspectClass(r: AspectRatio): string {
  return r === "1:1"
    ? "aspect-square"
    : r === "4:5"
    ? "aspect-[4/5]"
    : r === "9:16"
    ? "aspect-[9/16]"
    : "aspect-video";
}

// ─── Drag state (canvas) ─────────────────────────────────────────────────────

type DragMode = "move" | "resize" | "rotate";
type DragState = {
  layerId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  orig: {
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
    aspect: number; // w/h ratio (for resize)
  };
};

type TimelineDragState = {
  layerId: string;
  mode: "move" | "trim-left" | "trim-right";
  startX: number;
  origStart: number;
  origEnd: number;
};

// ─── Main component ───────────────────────────────────────────────────────────

export function MontageEditor() {
  // Project / edit data
  const [editData, setEditData] = useState<EditData>({
    layers: [],
    duration: 15,
    background: "#ffffff",
  });
  const [projectName, setProjectName] = useState("Montage sans titre");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Selection / interaction
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<
    "import" | "text" | "shape" | "sticker" | "audio" | "filters" | "templates"
  >("import");

  // Timeline / playback
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Media library
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // History (undo/redo)
  const [history, setHistory] = useState<EditData[]>([
    { layers: [], duration: 15, background: "#ffffff" },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Projects list / loading
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Render
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);

  // Mobile sheet
  const [mobilePanel, setMobilePanel] = useState<"properties" | "layers" | null>(null);

  // Refs
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const tlDragRef = useRef<TimelineDragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // historyIndex as a ref so async closures (queueMicrotask) read the latest
  // value rather than the stale one captured at the useCallback creation.
  const historyIndexRef = useRef(0);
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  // ─── History helpers ───────────────────────────────────────────────────────

  const undo = useCallback(() => {
    setHistoryIndex((i) => {
      if (i <= 0) return i;
      const ni = i - 1;
      setHistory((h) => {
        const snap = h[ni];
        if (snap) setEditData(clone(snap));
        return h;
      });
      return ni;
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex((i) => {
      setHistory((h) => {
        if (i >= h.length - 1) return h;
        const ni = i + 1;
        const snap = h[ni];
        if (snap) setEditData(clone(snap));
        return h;
      });
      // We can't read h.length-1 reliably here; rely on the snap check.
      return Math.min(i + 1, 49);
    });
    setDirty(true);
  }, []);

  // ─── Layer mutations ───────────────────────────────────────────────────────

  // Add a fully-formed layer (history-committed).
  const addLayer = useCallback((layer: Layer) => {
    setEditData((prev) => {
      const next: EditData = {
        ...prev,
        layers: [...prev.layers, { ...layer, zIndex: prev.layers.length }],
      };
      // commit history asynchronously
      queueMicrotask(() => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(next));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
      });
      return next;
    });
    setSelectedLayerId(layer.id);
    setDirty(true);
  }, []);

  // Property update from the right panel — committed to history.
  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setEditData((prev) => {
      const next: EditData = {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      };
      queueMicrotask(() => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(next));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
      });
      return next;
    });
    setDirty(true);
  }, []);

  const deleteLayer = useCallback((id: string) => {
    setEditData((prev) => {
      const next: EditData = {
        ...prev,
        layers: prev.layers.filter((l) => l.id !== id),
      };
      queueMicrotask(() => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(next));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
      });
      return next;
    });
    setSelectedLayerId((cur) => (cur === id ? null : cur));
    setDirty(true);
  }, []);

  const duplicateLayer = useCallback((id: string) => {
    setEditData((prev) => {
      const src = prev.layers.find((l) => l.id === id);
      if (!src) return prev;
      const copy: Layer = {
        ...clone(src),
        id: cryptoId(),
        name: `${src.name} copie`,
        x: Math.min(src.x + 4, 100 - src.w),
        y: Math.min(src.y + 4, 100 - src.h),
        zIndex: prev.layers.length,
      };
      const next: EditData = { ...prev, layers: [...prev.layers, copy] };
      queueMicrotask(() => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(next));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
        setSelectedLayerId(copy.id);
      });
      return next;
    });
    setDirty(true);
  }, []);

  const toggleVisibility = useCallback((id: string) => {
    setEditData((prev) => {
      const next = {
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === id ? { ...l, visible: !(l.visible ?? true) } : l
        ),
      };
      return next;
    });
    setDirty(true);
  }, []);

  const toggleLock = useCallback((id: string) => {
    setEditData((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === id ? { ...l, locked: !l.locked } : l
      ),
    }));
    setDirty(true);
  }, []);

  const reorderLayer = useCallback((id: string, dir: -1 | 1) => {
    setEditData((prev) => {
      const sorted = [...prev.layers].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((l) => l.id === id);
      if (idx === -1) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= sorted.length) return prev;
      const a = sorted[idx];
      const b = sorted[swap];
      const za = a.zIndex;
      a.zIndex = b.zIndex;
      b.zIndex = za;
      return { ...prev, layers: sorted };
    });
    setDirty(true);
  }, []);

  const selectedLayer = useMemo(
    () => editData.layers.find((l) => l.id === selectedLayerId) ?? null,
    [editData.layers, selectedLayerId]
  );

  // ─── Media import ───────────────────────────────────────────────────────────

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    for (const file of list) {
      const kind: MediaItem["kind"] = file.type.startsWith("video")
        ? "video"
        : file.type.startsWith("audio")
        ? "audio"
        : "image";
      if (!file.type.startsWith("image") && !file.type.startsWith("video") && !file.type.startsWith("audio")) {
        toast.error(`Type non supporté: ${file.name}`);
        continue;
      }
      const url = URL.createObjectURL(file);
      const id = cryptoId();
      const item: MediaItem = {
        id,
        kind,
        name: file.name,
        url,
        uploading: false,
      };
      // Read dims / duration async
      if (kind === "image") {
        const img = new Image();
        img.onload = () => {
          setMediaLibrary((lib) =>
            lib.map((m) =>
              m.id === id ? { ...m, width: img.naturalWidth, height: img.naturalHeight, thumb: url } : m
            )
          );
        };
        img.src = url;
      } else if (kind === "video") {
        const vid = document.createElement("video");
        vid.preload = "metadata";
        vid.onloadedmetadata = () => {
          setMediaLibrary((lib) =>
            lib.map((m) =>
              m.id === id
                ? {
                    ...m,
                    width: vid.videoWidth,
                    height: vid.videoHeight,
                    duration: vid.duration,
                    thumb: url,
                  }
                : m
            )
          );
        };
        vid.src = url;
      }
      setMediaLibrary((lib) => [...lib, item]);
    }
    toast.success(`${list.length} média(s) importé(s)`);
  }, []);

  // Convert a library media item into a canvas layer (auto-fit + centered).
  const addMediaLayer = useCallback(
    (item: MediaItem) => {
      const maxW = 80; // % of canvas
      const maxH = 80;
      let w = 50;
      let h = 50;
      if (item.width && item.height) {
        const ar = item.width / item.height;
        // fit within maxW x maxH while preserving aspect
        if (ar > maxW / maxH) {
          w = maxW;
          h = (maxW / ar);
        } else {
          h = maxH;
          w = maxH * ar;
        }
      }
      const x = (100 - w) / 2;
      const y = (100 - h) / 2;
      const end = Math.min(editData.duration, item.duration || editData.duration);
      const layer: Layer = {
        id: cryptoId(),
        kind: item.kind === "audio" ? "audio" : item.kind,
        name: item.name,
        src: item.url,
        thumb: item.thumb,
        naturalWidth: item.width,
        naturalHeight: item.height,
        duration: item.duration,
        x, y, w, h,
        rotation: 0,
        opacity: 1,
        zIndex: editData.layers.length,
        start: 0,
        end: end || editData.duration,
        visible: true,
        volume: 1,
        muted: false,
      };
      addLayer(layer);
    },
    [addLayer, editData.duration, editData.layers.length]
  );

  // ─── Tool: add text/shape/sticker/audio ─────────────────────────────────────

  const addTextLayer = useCallback(() => {
    const layer: Layer = {
      id: cryptoId(),
      kind: "text",
      name: "Texte",
      text: "Double-clique pour éditer",
      fontSize: 28,
      color: "#0b0f0e",
      fontFamily: FONT_FAMILIES[0],
      fontWeight: 600,
      align: "center",
      backgroundColor: "transparent",
      padding: 6,
      x: 15, y: 40, w: 70, h: 16,
      rotation: 0, opacity: 1, zIndex: editData.layers.length,
      start: 0, end: editData.duration, visible: true,
    };
    addLayer(layer);
    toast.success("Texte ajouté");
  }, [addLayer, editData.duration, editData.layers.length]);

  const addShapeLayer = useCallback((shape: Layer["shape"]) => {
    const layer: Layer = {
      id: cryptoId(),
      kind: "shape",
      name: `Forme ${shape}`,
      shape,
      fill: shape === "line" ? "#0b0f0e" : "#10b981",
      radius: shape === "rect" ? 12 : 0,
      x: 30, y: 30, w: 40, h: shape === "line" ? 4 : 40,
      rotation: 0, opacity: 1, zIndex: editData.layers.length,
      start: 0, end: editData.duration, visible: true,
    };
    addLayer(layer);
    toast.success("Forme ajoutée");
  }, [addLayer, editData.duration, editData.layers.length]);

  const addStickerLayer = useCallback((emoji: string) => {
    const layer: Layer = {
      id: cryptoId(),
      kind: "sticker",
      name: `Sticker ${emoji}`,
      emoji,
      x: 38, y: 38, w: 24, h: 24,
      rotation: 0, opacity: 1, zIndex: editData.layers.length,
      start: 0, end: editData.duration, visible: true,
    };
    addLayer(layer);
    toast.success("Sticker ajouté");
  }, [addLayer, editData.duration, editData.layers.length]);

  const addAudioLayer = useCallback(() => {
    const layer: Layer = {
      id: cryptoId(),
      kind: "audio",
      name: "Piste audio",
      x: 0, y: 0, w: 100, h: 0,
      rotation: 0, opacity: 1, zIndex: editData.layers.length,
      start: 0, end: editData.duration, visible: true,
      volume: 0.8, muted: false,
    };
    addLayer(layer);
    toast.success("Piste audio ajoutée (mock)");
  }, [addLayer, editData.duration, editData.layers.length]);

  const applyTemplate = useCallback((tpl: Template) => {
    const data = tpl.build();
    setEditData(data);
    setAspectRatio(tpl.aspectRatio);
    setSelectedLayerId(null);
    setHistory(() => [clone(data)]);
    setHistoryIndex(0);
    setDirty(true);
    toast.success(`Modèle « ${tpl.name} » appliqué`);
  }, []);

  // ─── Canvas drag handlers (move / resize / rotate) ──────────────────────────

  const onLayerPointerDown = useCallback(
    (e: React.PointerEvent, layer: Layer, mode: DragMode) => {
      if (layer.locked) return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedLayerId(layer.id);
      const rect = canvasRef.current?.getBoundingClientRect();
      const aspect = (rect && rect.height) ? layer.w / layer.h : 1;
      dragRef.current = {
        layerId: layer.id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        orig: {
          x: layer.x,
          y: layer.y,
          w: layer.w,
          h: layer.h,
          rotation: layer.rotation || 0,
          aspect: mode === "resize" ? (layer.w / layer.h) || 1 : 1,
        },
      };
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
    },
    []
  );

  const onWindowPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - d.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - d.startY) / rect.height) * 100;
    setEditData((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => {
        if (l.id !== d.layerId) return l;
        if (d.mode === "move") {
          let nx = d.orig.x + dxPct;
          let ny = d.orig.y + dyPct;
          nx = Math.max(-l.w + 10, Math.min(100 - 10, nx));
          ny = Math.max(-l.h + 10, Math.min(100 - 10, ny));
          return { ...l, x: nx, y: ny };
        }
        if (d.mode === "resize") {
          let nw = Math.max(5, d.orig.w + dxPct);
          let nh = Math.max(5, d.orig.h + dyPct);
          // Preserve aspect ratio for image/video
          if (l.kind === "image" || l.kind === "video") {
            // Use the dominant axis
            if (Math.abs(dxPct) > Math.abs(dyPct)) {
              nh = nw / d.orig.aspect;
            } else {
              nw = nh * d.orig.aspect;
            }
          }
          nw = Math.min(nw, 100 - l.x);
          nh = Math.min(nh, 100 - l.y);
          return { ...l, w: nw, h: nh };
        }
        if (d.mode === "rotate") {
          // Compute rotation from center
          const cx = l.x + l.w / 2;
          const cy = l.y + l.h / 2;
          const cxPx = (cx / 100) * rect.width;
          const cyPx = (cy / 100) * rect.height;
          const angle =
            (Math.atan2(e.clientY - cyPx, e.clientX - cxPx) * 180) / Math.PI +
            90;
          return { ...l, rotation: Math.round(angle) };
        }
        return l;
      }),
    }));
  }, []);

  const onWindowPointerUp = useCallback(() => {
    if (dragRef.current) {
      // commit history
      setEditData((cur) => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(cur));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
        return cur;
      });
      setDirty(true);
    }
    dragRef.current = null;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
  }, [onWindowPointerMove]);

  // ─── Timeline drag ──────────────────────────────────────────────────────────

  const onClipPointerDown = useCallback(
    (e: React.PointerEvent, layer: Layer, mode: TimelineDragState["mode"]) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedLayerId(layer.id);
      tlDragRef.current = {
        layerId: layer.id,
        mode,
        startX: e.clientX,
        origStart: layer.start,
        origEnd: layer.end,
      };
      window.addEventListener("pointermove", onTlPointerMove);
      window.addEventListener("pointerup", onTlPointerUp);
    },
    []
  );

  const onTlPointerMove = useCallback((e: PointerEvent) => {
    const d = tlDragRef.current;
    if (!d) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dt = ((e.clientX - d.startX) / rect.width) * (editData.duration || 15);
    setEditData((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => {
        if (l.id !== d.layerId) return l;
        const dur = d.origEnd - d.origStart;
        if (d.mode === "move") {
          let ns = d.origStart + dt;
          ns = Math.max(0, Math.min(prev.duration - dur, ns));
          return { ...l, start: ns, end: ns + dur };
        }
        if (d.mode === "trim-left") {
          let ns = Math.max(0, Math.min(d.origEnd - 0.5, d.origStart + dt));
          return { ...l, start: ns };
        }
        // trim-right
        let ne = Math.min(prev.duration, Math.max(d.origStart + 0.5, d.origEnd + dt));
        return { ...l, end: ne };
      }),
    }));
  }, [editData.duration]);

  const onTlPointerUp = useCallback(() => {
    if (tlDragRef.current) {
      setEditData((cur) => {
        setHistory((h) => {
          const truncated = h.slice(0, historyIndexRef.current + 1);
          truncated.push(clone(cur));
          while (truncated.length > 50) truncated.shift();
          return truncated;
        });
        setHistoryIndex((i) => Math.min(i + 1, 49));
        return cur;
      });
      setDirty(true);
    }
    tlDragRef.current = null;
    window.removeEventListener("pointermove", onTlPointerMove);
    window.removeEventListener("pointerup", onTlPointerUp);
  }, [onTlPointerMove]);

  // ─── Playhead / playback ─────────────────────────────────────────────────────

  const play = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime((t) => {
        const nt = t + dt;
        if (nt >= editData.duration) {
          // loop
          return nt - editData.duration;
        }
        return nt;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isPlaying, editData.duration]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seek = useCallback((t: number) => {
    pause();
    setCurrentTime(Math.max(0, Math.min(editData.duration, t)));
  }, [editData.duration, pause]);

  // ─── Save / load ─────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name: projectName,
        aspectRatio,
        editData: { ...editData, fps: 30 },
      };
      if (!projectId) {
        const created = await apiPost<{ id: string }>(
          "/api/video-projects",
          payload
        );
        if (created && created.id) {
          setProjectId(created.id);
          toast.success("Projet créé", {
            description: "Votre montage est enregistré.",
          });
        }
      } else {
        await apiPatch(`/api/video-projects/${projectId}`, {
          name: projectName,
          aspectRatio,
          duration: editData.duration,
          editData,
        });
        toast.success("Projet enregistré");
      }
      setDirty(false);
    } catch (e) {
      toast.error("Enregistrement impossible", {
        description: e instanceof Error ? e.message : "Backend indisponible.",
      });
    } finally {
      setSaving(false);
    }
  }, [saving, projectId, projectName, aspectRatio, editData]);

  const exportRender = useCallback(async () => {
    // 1) Ensure a project exists. If not, POST to create one and capture the id.
    let pid = projectId;
    if (!pid) {
      try {
        const created = await apiPost<{ id: string }>("/api/video-projects", {
          name: projectName,
          aspectRatio,
          editData,
        });
        pid = created?.id ?? null;
        if (pid) {
          setProjectId(pid);
          setDirty(false);
        }
      } catch (e) {
        toast.error("Export impossible", {
          description:
            e instanceof Error ? e.message : "Créez d'abord le projet.",
        });
        return;
      }
    }
    if (!pid) {
      toast.error("Export impossible", {
        description: "Aucun projet à exporter.",
      });
      return;
    }
    // 2) Save the latest editData before launching the render (so the backend
    //    renders the up-to-date version).
    try {
      await apiPatch(`/api/video-projects/${pid}`, {
        name: projectName,
        aspectRatio,
        duration: editData.duration,
        editData,
      });
      setDirty(false);
    } catch {
      /* ignore — proceed with render regardless */
    }
    // 3) Kick off the async render + listen for render:progress via socket.
    try {
      setRenderProgress(0);
      setRenderUrl(null);
      await apiPost(`/api/video-projects/${pid}/render`);
      toast.success("Rendu lancé", {
        description: "La progression arrive en temps réel.",
      });
    } catch (e) {
      setRenderProgress(null);
      toast.error("Lancement du rendu impossible", {
        description: e instanceof Error ? e.message : "Réessayez plus tard.",
      });
    }
  }, [projectId, projectName, aspectRatio, editData]);

  const refreshProjects = useCallback(async () => {
    try {
      const res = await apiGet<{ items: VideoProject[] }>("/api/video-projects");
      setProjects(res?.items ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  const openProject = useCallback(async (id: string) => {
    setLoadingProject(id);
    try {
      const p = await apiGet<VideoProject>(`/api/video-projects/${id}`);
      if (!p) return;
      setProjectId(p.id);
      setProjectName(p.name);
      setAspectRatio((p.aspectRatio as AspectRatio) || "9:16");
      const ed: EditData = p.editData ?? { layers: [], duration: 15, background: "#ffffff" };
      setEditData(ed);
      setCurrentTime(0);
      setHistory([clone(ed)]);
      setHistoryIndex(0);
      setSelectedLayerId(null);
      setRenderUrl(p.renderUrl);
      toast.success(`Montage « ${p.name} » chargé`);
    } catch (e) {
      toast.error("Chargement impossible", {
        description: e instanceof Error ? e.message : "Projet introuvable.",
      });
    } finally {
      setLoadingProject(null);
    }
  }, []);

  const newMontage = useCallback(() => {
    setProjectId(null);
    setProjectName("Montage sans titre");
    setAspectRatio("9:16");
    const fresh: EditData = { layers: [], duration: 15, background: "#ffffff" };
    setEditData(fresh);
    setHistory([clone(fresh)]);
    setHistoryIndex(0);
    setSelectedLayerId(null);
    setCurrentTime(0);
    setRenderUrl(null);
    setRenderProgress(null);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await apiDelete(`/api/video-projects/${id}`);
      setProjects((p) => p.filter((x) => x.id !== id));
      if (id === projectId) newMontage();
      toast.success("Projet supprimé");
    } catch (e) {
      toast.error("Suppression impossible", {
        description: e instanceof Error ? e.message : "Réessayez.",
      });
    }
  }, [projectId, newMontage]);

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Autosave (10s debounce) when dirty + projectId
  useEffect(() => {
    if (!projectId || !dirty) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        await apiPatch(`/api/video-projects/${projectId}`, {
          name: projectName,
          aspectRatio,
          duration: editData.duration,
          editData,
        });
        setDirty(false);
      } catch {
        /* silent — show nothing for autosave failures */
      }
    }, 10000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [editData, projectId, dirty, projectName, aspectRatio]);

  // Socket: render:progress
  useEffect(() => {
    const cb = (...args: unknown[]) => {
      const data = args[0] as
        | { projectId?: string; status?: string; progress?: number; renderUrl?: string }
        | undefined;
      if (!data) return;
      if (data.projectId && projectId && data.projectId !== projectId) return;
      if (typeof data.progress === "number") setRenderProgress(data.progress);
      if (data.renderUrl) setRenderUrl(data.renderUrl);
      if (data.status === "completed") {
        setRenderProgress(100);
        toast.success("Rendu terminé", {
          description: "Votre montage est prêt à être téléchargé.",
        });
      }
      if (data.status === "failed") {
        setRenderProgress(null);
        toast.error("Le rendu a échoué");
      }
    };
    realtime.on("render:progress", cb);
    return () => {
      realtime.off("render:progress", cb);
    };
  }, [projectId]);

  // Cleanup raf on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const isField =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (isField) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((meta && e.key.toLowerCase() === "z" && e.shiftKey) || (meta && e.key.toLowerCase() === "y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedLayerId) {
          e.preventDefault();
          deleteLayer(selectedLayerId);
        }
        return;
      }
      if (e.key === "Escape") {
        setSelectedLayerId(null);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedLayerId, deleteLayer]);

  // Drag-and-drop file import on canvas
  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        importFiles(e.dataTransfer.files);
      }
    },
    [importFiles]
  );

  // ─── Visible layers at currentTime ──────────────────────────────────────────

  const visibleLayers = useMemo(() => {
    return editData.layers
      .filter((l) => l.kind !== "audio")
      .filter((l) => l.visible !== false)
      .filter((l) => currentTime >= l.start && currentTime <= l.end)
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [editData.layers, currentTime]);

  // ─── Render: top bar ─────────────────────────────────────────────────────────

  function renderTopBar() {
    return (
      <div className="surface-card flex flex-wrap items-center gap-2 p-3 sm:gap-3">
        {/* Project name */}
        <Input
          value={projectName}
          onChange={(e) => {
            setProjectName(e.target.value);
            setDirty(true);
          }}
          aria-label="Nom du projet"
          className="h-10 min-w-[160px] max-w-[260px] flex-1 text-sm font-medium"
          placeholder="Nom du montage"
        />

        {/* Aspect ratio choice */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border bg-card p-1">
          {(["1:1", "4:5", "9:16", "16:9"] as AspectRatio[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setAspectRatio(r);
                setDirty(true);
              }}
              className={cn(
                "min-h-[32px] min-w-[44px] rounded-md px-2 text-xs font-medium transition-colors",
                aspectRatio === r
                  ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                  : "text-muted-foreground hover:bg-muted"
              )}
              aria-pressed={aspectRatio === r}
              aria-label={`Format ${r}`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={undo}
            disabled={historyIndex <= 0}
            aria-label="Annuler"
            title="Annuler (Cmd/Ctrl+Z)"
            className="h-10 w-10"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            aria-label="Rétablir"
            title="Rétablir (Cmd/Ctrl+Shift+Z)"
            className="h-10 w-10"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1" />

        {/* Projects dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              onClick={refreshProjects}
              className="h-10 gap-2"
              aria-label="Mes montages"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Mes montages</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
              Projets récents
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={newMontage} className="gap-2">
              <Plus className="h-4 w-4" /> Nouveau montage
            </DropdownMenuItem>
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Aucun projet. Cliquez « Enregistrer » pour en créer un.
              </p>
            )}
            {projects.map((p) => (
              <div key={p.id} className="group flex items-center gap-1">
                <button
                  onClick={() => openProject(p.id)}
                  className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted rounded-sm"
                  disabled={loadingProject === p.id}
                >
                  <span className="truncate">{p.name}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {p.aspectRatio}
                  </Badge>
                </button>
                <button
                  onClick={() => deleteProject(p.id)}
                  className="mr-1 hidden h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-rose-50 hover:text-rose-600 group-hover:flex"
                  aria-label={`Supprimer ${p.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Save */}
        <Button
          onClick={save}
          disabled={saving}
          className="h-10 gap-2 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          aria-label="Enregistrer"
        >
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline">{saving ? "Enregistrement…" : "Enregistrer"}</span>
          {dirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
        </Button>

        {/* Export */}
        <Button
          onClick={exportRender}
          className="h-10 gap-2 bg-emerald-600 text-white hover:bg-emerald-600/90"
          aria-label="Exporter"
          disabled={renderProgress != null && renderProgress < 100}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">
            {renderProgress != null && renderProgress < 100
              ? `Rendu ${Math.round(renderProgress)}%`
              : "Exporter"}
          </span>
        </Button>
      </div>
    );
  }

  // ─── Render: left panel (tools + library) ────────────────────────────────────

  function renderLeftPanel() {
    const tools: {
      id: typeof activeTool;
      icon: React.ReactNode;
      label: string;
    }[] = [
      { id: "import", icon: <Upload className="h-4 w-4" />, label: "Importer" },
      { id: "text", icon: <TypeIcon className="h-4 w-4" />, label: "Texte" },
      { id: "shape", icon: <Shapes className="h-4 w-4" />, label: "Forme" },
      { id: "sticker", icon: <Smile className="h-4 w-4" />, label: "Sticker" },
      { id: "audio", icon: <Music className="h-4 w-4" />, label: "Audio" },
      { id: "filters", icon: <SlidersHorizontal className="h-4 w-4" />, label: "Filtres" },
      { id: "templates", icon: <LayoutTemplate className="h-4 w-4" />, label: "Modèles" },
    ];
    return (
      <div className="surface-card flex h-full flex-col gap-3 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outils
        </p>
        <div className="grid grid-cols-2 gap-2">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                activeTool === t.id
                  ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                  : "border-border bg-card text-foreground hover:bg-muted"
              )}
              aria-pressed={activeTool === t.id}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <Separator />

        {/* Tool-specific panel */}
        {activeTool === "import" && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/60"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onCanvasDrop}
              aria-label="Importer des médias"
            >
              <Upload className="h-6 w-6 text-muted-foreground/70" />
              <span className="text-pretty">
                {isDragging ? "Déposez vos fichiers ici" : "Glissez vos images/vidéos ou cliquez"}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) importFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Bibliothèque
            </p>
            <div className="max-h-72 overflow-y-auto scroll-premium -mx-1 grid grid-cols-2 gap-2 px-1">
              {mediaLibrary.length === 0 && (
                <p className="col-span-2 rounded-lg bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">
                  Aucun média importé.
                </p>
              )}
              {mediaLibrary.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addMediaLayer(m)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card text-left transition-transform hover:-translate-y-0.5"
                  aria-label={`Ajouter ${m.name} au montage`}
                  title={`Ajouter « ${m.name} »`}
                >
                  {m.kind === "image" && (
                    <img
                      src={m.thumb || m.url}
                      alt={m.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {m.kind === "video" && (
                    <>
                      <video
                        src={m.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">
                        VIDEO
                      </span>
                    </>
                  )}
                  {m.kind === "audio" && (
                    <div className="flex h-full w-full items-center justify-center bg-violet-100 text-violet-700">
                      <Music className="h-6 w-6" />
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {m.name}
                  </span>
                  <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Plus className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTool === "text" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-pretty">
              Ajoutez un bloc de texte. Éditez ensuite le contenu, la police, la
              couleur et la taille dans le panneau de propriétés.
            </p>
            <Button
              onClick={addTextLayer}
              className="h-10 w-full gap-2 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Ajouter un texte
            </Button>
          </div>
        )}

        {activeTool === "shape" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Choisissez une forme.</p>
            <div className="grid grid-cols-2 gap-2">
              {(["rect", "circle", "line", "triangle"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addShapeLayer(s)}
                  className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 py-2 text-xs font-medium hover:bg-muted"
                  aria-label={`Ajouter ${s}`}
                >
                  <span
                    className={cn(
                      "h-6 w-6",
                      s === "circle" && "rounded-full bg-emerald-500",
                      s === "rect" && "rounded-md bg-emerald-500",
                      s === "line" && "h-1.5 w-6 bg-ink",
                      s === "triangle" &&
                        "bg-transparent [clip-path:polygon(50%_0,100%_100%,0_100%)] bg-emerald-500"
                    )}
                    style={s === "triangle" ? {
                      background: "#10b981",
                      clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
                    } : undefined}
                  />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTool === "sticker" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Touchez un emoji pour l'ajouter.</p>
            <div className="max-h-72 overflow-y-auto scroll-premium grid grid-cols-4 gap-1.5">
              {EMOJI_PALETTE.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => addStickerLayer(e)}
                  className="flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-card text-xl transition-transform hover:-translate-y-0.5 hover:bg-muted"
                  aria-label={`Ajouter ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTool === "audio" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-pretty">
              Ajoutez une piste audio (mock). Réglez le volume dans les propriétés.
            </p>
            <Button
              onClick={addAudioLayer}
              variant="outline"
              className="h-10 w-full gap-2"
            >
              <Plus className="h-4 w-4" /> Ajouter une piste audio
            </Button>
          </div>
        )}

        {activeTool === "filters" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-pretty">
              Sélectionnez un calque image/vidéo, puis choisissez un préréglage.
              Affinez ensuite chaque réglage dans les propriétés.
            </p>
            {!selectedLayer || (selectedLayer.kind !== "image" && selectedLayer.kind !== "video") ? (
              <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
                Sélectionnez une image ou une vidéo sur le canevas.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      updateLayer(selectedLayer.id, { filters: { ...p.filters } })
                    }
                    className={cn(
                      "min-h-[40px] rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                      matchPreset(selectedLayer.filters) === p.id
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTool === "templates" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Démarrez vite avec un modèle.</p>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-transform hover:-translate-y-0.5 hover:bg-muted"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <LayoutTemplate className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.aspectRatio}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Render: canvas ──────────────────────────────────────────────────────────

  function renderLayerView(layer: Layer) {
    const selected = layer.id === selectedLayerId;
    const filterStr = filterCss(layer.filters);
    const commonStyle: React.CSSProperties = {
      position: "absolute",
      left: `${layer.x}%`,
      top: `${layer.y}%`,
      width: `${layer.w}%`,
      height: layer.kind === "audio" ? "0%" : `${layer.h}%`,
      transform: `rotate(${layer.rotation || 0}deg)`,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      filter: filterStr,
      cursor: layer.locked ? "not-allowed" : "move",
      touchAction: "none",
      outline: selected ? "2px solid var(--emerald-accent)" : undefined,
      outlineOffset: selected ? "2px" : undefined,
    };
    return (
      <div
        key={layer.id}
        style={commonStyle}
        onPointerDown={(e) => onLayerPointerDown(e, layer, "move")}
        onDoubleClick={() => {
          if (layer.kind === "text") {
            const v = prompt("Texte:", layer.text ?? "");
            if (v != null) updateLayer(layer.id, { text: v });
          }
        }}
      >
        {/* Layer content */}
        {layer.kind === "image" && layer.src && (
          <img
            src={layer.src}
            alt={layer.name}
            draggable={false}
            className="pointer-events-none h-full w-full object-cover select-none"
          />
        )}
        {layer.kind === "video" && layer.src && (
          <video
            src={layer.src}
            muted
            loop
            playsInline
            autoPlay={isPlaying}
            className="pointer-events-none h-full w-full object-cover select-none"
          />
        )}
        {layer.kind === "text" && (
          <div
            className="flex h-full w-full items-center"
            style={{
              color: layer.color || "#0b0f0e",
              fontSize: `${layer.fontSize || 24}px`,
              fontFamily: layer.fontFamily,
              fontWeight: layer.fontWeight || 400,
              textAlign: layer.align || "center",
              backgroundColor: layer.backgroundColor || "transparent",
              padding: `${layer.padding ?? 6}px`,
              lineHeight: 1.15,
              wordBreak: "break-word",
            }}
          >
            <span className="w-full" style={{ textAlign: layer.align || "center" }}>
              {layer.text || "Texte"}
            </span>
          </div>
        )}
        {layer.kind === "shape" && (
          <div
            className="w-full"
            style={{
              height: layer.shape === "line" ? "6px" : "100%",
              marginTop: layer.shape === "line" ? "calc(50% - 3px)" : 0,
              background: layer.fill || "#10b981",
              borderRadius:
                layer.shape === "circle" ? "9999px" : layer.radius || 8,
              clipPath:
                layer.shape === "triangle"
                  ? "polygon(50% 0, 100% 100%, 0 100%)"
                  : undefined,
            }}
          />
        )}
        {layer.kind === "sticker" && (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              fontSize: "min(72px, 100%)",
              lineHeight: 1,
            }}
          >
            <span>{layer.emoji || "✨"}</span>
          </div>
        )}

        {/* Selection handles */}
        {selected && !layer.locked && layer.kind !== "audio" && (
          <>
            <div
              onPointerDown={(e) => onLayerPointerDown(e, layer, "resize")}
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-full bg-emerald-500 ring-2 ring-white"
              aria-label="Redimensionner"
              title="Redimensionner"
            />
            <div
              onPointerDown={(e) => onLayerPointerDown(e, layer, "rotate")}
              className="absolute -top-6 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full bg-violet-500 ring-2 ring-white"
              aria-label="Faire pivoter"
              title="Faire pivoter"
            />
            <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] font-medium text-violet-600">
              {Math.round(layer.rotation || 0)}°
            </div>
          </>
        )}
      </div>
    );
  }

  function renderCanvas() {
    const ratioCls = aspectClass(aspectRatio);
    return (
      <div className="flex h-full flex-col items-center justify-start gap-3">
        <div
          className="relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-xl bg-muted/30 p-3"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onCanvasDrop}
        >
          <div
            ref={canvasRef}
            className={cn(
              "relative w-full overflow-hidden rounded-2xl border-2 border-border shadow-sm",
              ratioCls,
              isDragging && "border-emerald-400 ring-2 ring-emerald-200"
            )}
            style={{
              background: editData.background || "#ffffff",
              maxWidth: "420px",
              maxHeight: "480px",
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedLayerId(null);
            }}
          >
            {editData.layers.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                <div className="space-y-1">
                  <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="text-pretty">
                    Glissez vos médias ici, ou utilisez les outils à gauche pour
                    ajouter texte, formes et stickers.
                  </p>
                </div>
              </div>
            )}
            {visibleLayers.map(renderLayerView)}
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: properties panel ────────────────────────────────────────────────

  function renderProperties() {
    if (!selectedLayer) {
      return (
        <div className="surface-card flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <SlidersHorizontal className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-pretty">
            Sélectionnez un calque pour voir ses propriétés. Vous pourrez ajuster
            position, taille, opacité, filtres et plus.
          </p>
        </div>
      );
    }
    const l = selectedLayer;
    return (
      <div className="surface-card flex h-full flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-2.5 w-2.5 rounded-full",
              KIND_COLOR[l.kind]
            )}
            aria-hidden
          />
          <Input
            value={l.name}
            onChange={(e) => updateLayer(l.id, { name: e.target.value })}
            className="h-9 flex-1 text-sm font-semibold"
            aria-label="Nom du calque"
          />
          <button
            type="button"
            onClick={() => toggleVisibility(l.id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted"
            aria-label={l.visible !== false ? "Masquer" : "Afficher"}
            title={l.visible !== false ? "Masquer" : "Afficher"}
          >
            {l.visible !== false ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleLock(l.id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted"
            aria-label={l.locked ? "Déverrouiller" : "Verrouiller"}
            title={l.locked ? "Déverrouiller" : "Verrouiller"}
          >
            {l.locked ? (
              <Lock className="h-4 w-4 text-amber-600" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </button>
        </div>

        <Separator />

        {/* Common: position / size / rotation / opacity */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transformation
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="X (%)"
              value={Math.round(l.x * 10) / 10}
              min={-100}
              max={100}
              step={0.5}
              onChange={(v) => updateLayer(l.id, { x: v })}
            />
            <NumField
              label="Y (%)"
              value={Math.round(l.y * 10) / 10}
              min={-100}
              max={100}
              step={0.5}
              onChange={(v) => updateLayer(l.id, { y: v })}
            />
            <NumField
              label="Largeur (%)"
              value={Math.round(l.w * 10) / 10}
              min={1}
              max={200}
              step={0.5}
              onChange={(v) => updateLayer(l.id, { w: v })}
            />
            <NumField
              label="Hauteur (%)"
              value={Math.round(l.h * 10) / 10}
              min={1}
              max={200}
              step={0.5}
              onChange={(v) => updateLayer(l.id, { h: v })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Rotation</Label>
              <span className="text-xs tabular-nums">{Math.round(l.rotation || 0)}°</span>
            </div>
            <Slider
              value={[l.rotation || 0]}
              min={-180}
              max={180}
              step={1}
              onValueChange={(v) => updateLayer(l.id, { rotation: v[0] })}
              aria-label="Rotation"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Opacité</Label>
              <span className="text-xs tabular-nums">
                {Math.round((l.opacity ?? 1) * 100)}%
              </span>
            </div>
            <Slider
              value={[Math.round((l.opacity ?? 1) * 100)]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => updateLayer(l.id, { opacity: v[0] / 100 })}
              aria-label="Opacité"
            />
          </div>
        </div>

        {/* Kind-specific */}
        {(l.kind === "image" || l.kind === "video") && (
          <FiltersEditor layer={l} onChange={(patch) => updateLayer(l.id, patch)} />
        )}

        {l.kind === "text" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Texte
            </p>
            <Textarea
              value={l.text ?? ""}
              onChange={(e) => updateLayer(l.id, { text: e.target.value })}
              placeholder="Votre texte…"
              className="min-h-[64px] resize-y text-sm"
            />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Police</Label>
              <select
                value={l.fontFamily ?? FONT_FAMILIES[0]}
                onChange={(e) => updateLayer(l.id, { fontFamily: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
                aria-label="Famille de police"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f.split(",")[0].replace(/'/g, "")}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Taille (px)</Label>
                <Input
                  type="number"
                  value={l.fontSize ?? 24}
                  min={6}
                  max={200}
                  onChange={(e) =>
                    updateLayer(l.id, { fontSize: Number(e.target.value) })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Graisse</Label>
                <select
                  value={String(l.fontWeight ?? 600)}
                  onChange={(e) =>
                    updateLayer(l.id, { fontWeight: Number(e.target.value) })
                  }
                  className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
                >
                  {[300, 400, 500, 600, 700, 800].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Couleur</Label>
                <ColorField
                  value={l.color ?? "#0b0f0e"}
                  onChange={(v) => updateLayer(l.id, { color: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Fond</Label>
                <ColorField
                  value={l.backgroundColor ?? "transparent"}
                  onChange={(v) => updateLayer(l.id, { backgroundColor: v })}
                  allowTransparent
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Alignement</Label>
              <div className="flex gap-1.5">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => updateLayer(l.id, { align: a })}
                    className={cn(
                      "flex h-9 flex-1 items-center justify-center rounded-md border text-xs capitalize",
                      l.align === a
                        ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    )}
                    aria-pressed={l.align === a}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {l.kind === "shape" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Forme
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Couleur de remplissage</Label>
              <ColorField
                value={l.fill ?? "#10b981"}
                onChange={(v) => updateLayer(l.id, { fill: v })}
              />
            </div>
            {l.shape === "rect" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Arrondi (px)</Label>
                  <span className="text-xs tabular-nums">{l.radius ?? 0}</span>
                </div>
                <Slider
                  value={[l.radius ?? 0]}
                  min={0}
                  max={120}
                  step={1}
                  onValueChange={(v) => updateLayer(l.id, { radius: v[0] })}
                  aria-label="Arrondi"
                />
              </div>
            )}
          </div>
        )}

        {l.kind === "sticker" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sticker
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {EMOJI_PALETTE.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => updateLayer(l.id, { emoji: e })}
                  className={cn(
                    "flex min-h-[40px] items-center justify-center rounded-lg border text-xl",
                    l.emoji === e
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-border bg-card hover:bg-muted"
                  )}
                  aria-label={`Choisir ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {l.kind === "audio" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Audio
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Volume</Label>
                <span className="text-xs tabular-nums">
                  {Math.round((l.volume ?? 1) * 100)}%
                </span>
              </div>
              <Slider
                value={[Math.round((l.volume ?? 1) * 100)]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => updateLayer(l.id, { volume: v[0] / 100 })}
                aria-label="Volume"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
              <Label htmlFor="audio-mute" className="text-xs text-muted-foreground">
                Muet
              </Label>
              <Switch
                id="audio-mute"
                checked={l.muted ?? false}
                onCheckedChange={(v) => updateLayer(l.id, { muted: v })}
              />
            </div>
          </div>
        )}

        {/* Timing */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chronologie
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Début (s)"
              value={Math.round(l.start * 10) / 10}
              min={0}
              max={editData.duration}
              step={0.1}
              onChange={(v) =>
                updateLayer(l.id, { start: Math.min(v, l.end - 0.1) })
              }
            />
            <NumField
              label="Fin (s)"
              value={Math.round(l.end * 10) / 10}
              min={0}
              max={editData.duration}
              step={0.1}
              onChange={(v) =>
                updateLayer(l.id, { end: Math.max(v, l.start + 0.1) })
              }
            />
          </div>
        </div>

        <Separator />

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => duplicateLayer(l.id)}
            className="h-10 gap-2"
            aria-label="Dupliquer le calque"
          >
            <Copy className="h-4 w-4" /> Dupliquer
          </Button>
          <Button
            variant="outline"
            onClick={() => deleteLayer(l.id)}
            className="h-10 gap-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            aria-label="Supprimer le calque"
          >
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
          <Button
            variant="outline"
            onClick={() => reorderLayer(l.id, 1)}
            className="h-10 gap-2"
            aria-label="Monter le calque"
            title="Monter d'un niveau"
          >
            <ChevronUp className="h-4 w-4" /> Monter
          </Button>
          <Button
            variant="outline"
            onClick={() => reorderLayer(l.id, -1)}
            className="h-10 gap-2"
            aria-label="Descendre le calque"
            title="Descendre d'un niveau"
          >
            <ChevronDown className="h-4 w-4" /> Descendre
          </Button>
        </div>
      </div>
    );
  }

  // ─── Render: layers list (right / mobile) ────────────────────────────────────

  function renderLayersList() {
    return (
      <div className="surface-card flex h-full flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Calques ({editData.layers.length})
          </p>
          <span className="text-[10px] text-muted-foreground">
            Z-index ↑ au-dessus
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto scroll-premium space-y-1">
          {editData.layers.length === 0 && (
            <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
              Aucun calque. Ajoutez-en via les outils.
            </p>
          )}
          {[...editData.layers]
            .sort((a, b) => b.zIndex - a.zIndex)
            .map((l) => (
              <div
                key={l.id}
                onClick={() => setSelectedLayerId(l.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors",
                  selectedLayerId === l.id
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-border bg-card hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-2 w-2 shrink-0 rounded-full",
                    KIND_COLOR[l.kind]
                  )}
                  aria-hidden
                />
                <span className="flex-1 truncate">{l.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {KIND_LABEL[l.kind]}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisibility(l.id);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={l.visible !== false ? "Masquer" : "Afficher"}
                >
                  {l.visible !== false ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLock(l.id);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={l.locked ? "Déverrouiller" : "Verrouiller"}
                >
                  {l.locked ? (
                    <Lock className="h-3.5 w-3.5 text-amber-600" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  }

  // ─── Render: timeline ─────────────────────────────────────────────────────────

  function renderTimeline() {
    const dur = editData.duration || 1;
    const rulerMarks: number[] = [];
    for (let i = 0; i <= dur; i++) {
      rulerMarks.push(i);
    }
    const playheadPct = (currentTime / dur) * 100;

    return (
      <div className="surface-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Button
            variant="outline"
            size="icon"
            onClick={togglePlay}
            className="h-10 w-10 rounded-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            aria-label={isPlaying ? "Pause" : "Lecture"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{fmtTime(currentTime)}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">{fmtTime(dur)}</span>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Durée</Label>
            <Input
              type="number"
              value={dur}
              min={1}
              max={120}
              step={1}
              onChange={(e) => {
                const v = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                setEditData((prev) => ({ ...prev, duration: v }));
                setDirty(true);
              }}
              className="h-9 w-20"
              aria-label="Durée du montage (s)"
            />
          </div>

          <div className="flex-1" />

          <Button
            variant="outline"
            onClick={() =>
              toast("Analyse en cours", {
                description: "On détecte les moments faibles… (mock)",
              })
            }
            className="h-10 gap-2"
            aria-label="Supprimer les moments faibles"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Moments faibles</span>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast("Montage auto appliqué", {
                description: "Rythme et transitions optimisés (mock).",
              })
            }
            className="h-10 gap-2"
            aria-label="Montage automatique"
          >
            <Wand2 className="h-4 w-4" />
            <span className="hidden sm:inline">Montage auto</span>
          </Button>
        </div>

        {/* Ruler */}
        <div className="relative mb-1 h-5 select-none">
          <div
            ref={timelineRef}
            className="absolute inset-0 flex items-end justify-between px-0.5"
          >
            {rulerMarks.map((s) => (
              <div
                key={s}
                className="flex h-full flex-col items-center justify-end gap-0.5"
                style={{ position: "absolute", left: `${(s / dur) * 100}%` }}
              >
                <div className="h-2 w-px bg-border" />
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {s}s
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tracks */}
        <div
          className="relative overflow-x-auto scroll-premium rounded-lg border border-border bg-muted/30 p-2"
          style={{ minHeight: `${Math.max(40, editData.layers.length * 28 + 8)}px` }}
        >
          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-rose-500"
            style={{ left: `calc(${playheadPct}% + 8px)` }}
            aria-hidden
          >
            <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-rose-500" />
          </div>

          {/* Click-to-seek overlay */}
          <div
            className="absolute inset-0 z-0 cursor-pointer"
            onClick={(e) => {
              const rect = timelineRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left + 8; // padding
              const pct = Math.max(0, Math.min(1, x / rect.width));
              seek(pct * dur);
            }}
            aria-hidden
          />

          {editData.layers.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Aucun calque sur la chronologie.
            </p>
          )}

          <div className="relative space-y-1">
            {editData.layers.map((l, idx) => {
              const left = (l.start / dur) * 100;
              const width = ((l.end - l.start) / dur) * 100;
              return (
                <div
                  key={l.id}
                  className="relative h-6"
                  style={{ zIndex: idx }}
                >
                  <div
                    onPointerDown={(e) => onClipPointerDown(e, l, "move")}
                    className={cn(
                      "group absolute h-6 cursor-grab rounded-md border border-border/80 text-[10px] font-medium text-white shadow-sm",
                      KIND_COLOR[l.kind],
                      l.visible === false && "opacity-40",
                      selectedLayerId === l.id && "ring-2 ring-emerald-400 ring-offset-1"
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(1.5, width)}%`,
                      zIndex: 1,
                    }}
                    title={`${l.name} · ${fmtTime(l.start)} → ${fmtTime(l.end)}`}
                  >
                    {/* Left trim handle */}
                    <div
                      onPointerDown={(e) => onClipPointerDown(e, l, "trim-left")}
                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md bg-black/30 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Réduire le début"
                    />
                    <div className="flex h-full items-center justify-center overflow-hidden px-2">
                      <span className="truncate">
                        {l.kind === "audio" ? "🎵" : ""} {l.name}
                      </span>
                    </div>
                    {/* Right trim handle */}
                    <div
                      onPointerDown={(e) => onClipPointerDown(e, l, "trim-right")}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-black/30 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Réduire la fin"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Render result */}
        {renderUrl && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <img
              src={renderUrl}
              alt="Aperçu du rendu"
              className="h-14 w-14 rounded-md border border-border object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-700">
                Rendu terminé
              </p>
              <p className="text-xs text-emerald-700/80">{renderUrl}</p>
            </div>
            <a
              href={renderUrl}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-600/90"
            >
              <Download className="h-4 w-4" /> Télécharger
            </a>
          </div>
        )}

        {renderProgress != null && renderProgress < 100 && !renderUrl && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-700">
                Rendu en cours… {Math.round(renderProgress)}%
              </p>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-amber-200">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: mobile toolbar ──────────────────────────────────────────────────

  function renderMobileToolbar() {
    return (
      <div className="lg:hidden">
        <div className="surface-card flex items-center gap-1 p-2">
          <button
            type="button"
            onClick={() => setActiveTool("import")}
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
            aria-label="Importer"
          >
            <Upload className="h-4 w-4" /> Importer
          </button>
          <button
            type="button"
            onClick={addTextLayer}
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
            aria-label="Ajouter un texte"
          >
            <TypeIcon className="h-4 w-4" /> Texte
          </button>
          <button
            type="button"
            onClick={() => addShapeLayer("rect")}
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
            aria-label="Ajouter une forme"
          >
            <Shapes className="h-4 w-4" /> Forme
          </button>
          <button
            type="button"
            onClick={() => addStickerLayer("🔥")}
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
            aria-label="Ajouter un sticker"
          >
            <Smile className="h-4 w-4" /> Sticker
          </button>
          <div className="flex-1" />
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
                aria-label="Calques"
              >
                <Layers className="h-4 w-4" /> Calques
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[60vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Calques</SheetTitle>
              </SheetHeader>
              <div className="mt-3">{renderLayersList()}</div>
            </SheetContent>
          </Sheet>
          <Sheet open={mobilePanel === "properties"} onOpenChange={(o) => setMobilePanel(o ? "properties" : null)}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-foreground hover:bg-muted"
                aria-label="Propriétés"
              >
                <SlidersHorizontal className="h-4 w-4" /> Réglages
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] max-w-md overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Propriétés</SheetTitle>
              </SheetHeader>
              <div className="mt-3">{renderProperties()}</div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    );
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {renderTopBar()}

      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Left: tools + library (desktop) */}
        <div className="hidden lg:block">
          <div className="sticky top-4 max-h-[calc(100vh-220px)]">
            {renderLeftPanel()}
          </div>
        </div>

        {/* Center: canvas + mobile toolbar */}
        <div className="space-y-4">
          <div className="min-h-[420px] lg:min-h-[500px]">{renderCanvas()}</div>
          {renderMobileToolbar()}
        </div>

        {/* Right: properties + layers (desktop) */}
        <div className="hidden lg:flex lg:flex-col lg:gap-4">
          <div className="max-h-[60vh] overflow-y-auto scroll-premium">
            {renderProperties()}
          </div>
          <div className="max-h-[36vh] overflow-y-auto scroll-premium">
            {renderLayersList()}
          </div>
        </div>
      </div>

      {/* Timeline (full width) */}
      {renderTimeline()}

      {/* Mobile tools panel: keep the import/shape/sticker/template tools available too */}
      <MobileToolsDrawer
        addTextLayer={addTextLayer}
        addShapeLayer={addShapeLayer}
        addStickerLayer={addStickerLayer}
        addAudioLayer={addAudioLayer}
        fileInputRef={fileInputRef}
        importFiles={importFiles}
        applyTemplate={applyTemplate}
        selectedLayer={selectedLayer}
        updateLayer={updateLayer}
      />
    </div>
  );
}

// ─── Small inline components ──────────────────────────────────────────────────

function NumField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-9"
        aria-label={label}
      />
    </div>
  );
}

function ColorField({
  value,
  onChange,
  allowTransparent,
}: {
  value: string;
  onChange: (v: string) => void;
  allowTransparent?: boolean;
}) {
  const isTransparent = value === "transparent";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={isTransparent ? "#ffffff" : value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-9 cursor-pointer rounded-md border border-border bg-card p-0.5"
        aria-label="Couleur"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 flex-1 text-xs"
        aria-label="Couleur (hex)"
      />
      {allowTransparent && (
        <button
          type="button"
          onClick={() => onChange("transparent")}
          className={cn(
            "h-9 rounded-md border px-2 text-[10px] font-medium",
            isTransparent
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-border bg-card text-muted-foreground hover:bg-muted"
          )}
          aria-label="Transparent"
          title="Transparent"
        >
          ∅
        </button>
      )}
    </div>
  );
}

function FiltersEditor({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (patch: Partial<Layer>) => void;
}) {
  const f: Filters = layer.filters ?? {};
  const set = (k: keyof Filters, v: number | undefined) =>
    onChange({ filters: { ...f, [k]: v } });
  const reset = () => onChange({ filters: {} });

  const sliders: {
    key: keyof Filters;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number;
    display?: (v: number) => string;
  }[] = [
    { key: "brightness", label: "Luminosité", min: 0, max: 2, step: 0.05, def: 1, display: (v) => `${Math.round(v * 100)}%` },
    { key: "contrast", label: "Contraste", min: 0, max: 2, step: 0.05, def: 1, display: (v) => `${Math.round(v * 100)}%` },
    { key: "saturate", label: "Saturation", min: 0, max: 2, step: 0.05, def: 1, display: (v) => `${Math.round(v * 100)}%` },
    { key: "blur", label: "Flou (px)", min: 0, max: 20, step: 0.5, def: 0 },
    { key: "grayscale", label: "N&B", min: 0, max: 1, step: 0.05, def: 0, display: (v) => `${Math.round(v * 100)}%` },
    { key: "sepia", label: "Sepia", min: 0, max: 1, step: 0.05, def: 0, display: (v) => `${Math.round(v * 100)}%` },
    { key: "hueRotate", label: "Teinte (°)", min: -180, max: 180, step: 5, def: 0 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Filtres
        </p>
        <button
          type="button"
          onClick={reset}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
          aria-label="Réinitialiser les filtres"
        >
          Réinitialiser
        </button>
      </div>
      {/* Presets */}
      <div className="grid grid-cols-2 gap-1.5">
        {FILTER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange({ filters: { ...p.filters } })}
            className={cn(
              "min-h-[34px] rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              matchPreset(layer.filters) === p.id
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-border bg-card text-foreground hover:bg-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Sliders */}
      <div className="space-y-2.5">
        {sliders.map((s) => {
          const v = f[s.key] ?? s.def;
          return (
            <div key={s.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{s.label}</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.display ? s.display(v) : v}
                </span>
              </div>
              <Slider
                value={[v]}
                min={s.min}
                max={s.max}
                step={s.step}
                onValueChange={(arr) => set(s.key, arr[0])}
                aria-label={s.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MobileToolsDrawer({
  addTextLayer,
  addShapeLayer,
  addStickerLayer,
  addAudioLayer,
  fileInputRef,
  importFiles,
  applyTemplate,
  selectedLayer,
  updateLayer,
}: {
  addTextLayer: () => void;
  addShapeLayer: (s: Layer["shape"]) => void;
  addStickerLayer: (e: string) => void;
  addAudioLayer: () => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  importFiles: (files: FileList | File[]) => void;
  applyTemplate: (t: Template) => void;
  selectedLayer: Layer | null;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed bottom-4 right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-lg lg:hidden"
          aria-label="Outils"
        >
          <Plus className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Outils</SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          {/* Templates quick-access */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Modèles
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    applyTemplate(t);
                    setOpen(false);
                  }}
                  className="rounded-lg border border-border bg-card px-2 py-2 text-xs font-medium hover:bg-muted"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          {/* Quick add */}
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted"
            >
              <Upload className="h-4 w-4" /> Importer
            </button>
            <button
              type="button"
              onClick={() => {
                addTextLayer();
                setOpen(false);
              }}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted"
            >
              <TypeIcon className="h-4 w-4" /> Texte
            </button>
            <button
              type="button"
              onClick={() => {
                addShapeLayer("rect");
                setOpen(false);
              }}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted"
            >
              <Shapes className="h-4 w-4" /> Forme
            </button>
            <button
              type="button"
              onClick={() => {
                addStickerLayer("🔥");
                setOpen(false);
              }}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted"
            >
              <Smile className="h-4 w-4" /> Sticker
            </button>
            <button
              type="button"
              onClick={() => {
                addAudioLayer();
                setOpen(false);
              }}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted"
            >
              <Music className="h-4 w-4" /> Audio
            </button>
          </div>
          {/* Emoji quick-pick */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Stickers
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {EMOJI_PALETTE.slice(0, 18).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    addStickerLayer(e);
                    setOpen(false);
                  }}
                  className="flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-card text-xl hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          {/* Filter presets if applicable */}
          {selectedLayer && (selectedLayer.kind === "image" || selectedLayer.kind === "video") && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filtres rapides
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => updateLayer(selectedLayer.id, { filters: { ...p.filters } })}
                    className={cn(
                      "min-h-[36px] rounded-md border px-2 py-1 text-xs font-medium",
                      matchPreset(selectedLayer.filters) === p.id
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-border bg-card hover:bg-muted"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
