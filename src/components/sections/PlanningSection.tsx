"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  calendarItems as initialItems,
  PLATFORM_META,
  type CalendarItem,
  type ContentStatus,
} from "@/lib/mock-data";
import { apiGet, apiPatch, apiDelete, apiPost, apiTry } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformDot } from "@/components/shared/PlatformBadge";
import { ProgressTracker } from "@/components/shared/ProgressTracker";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ViewKey = "week" | "month" | "30" | "60" | "90";

// Validation stages surfaced by /api/validation/pending (P3).
// Colors: draft=muted, pending_cdp=amber, pending_client=violet,
// validated=emerald, refused=rose.
type ValidationStage =
  | "draft"
  | "pending_cdp"
  | "pending_client"
  | "validated"
  | "refused";

const VALIDATION_META: Record<
  ValidationStage,
  { label: string; chip: string }
> = {
  draft: { label: "Brouillon", chip: "bg-foreground/5 text-muted-foreground" },
  pending_cdp: { label: "CDP", chip: "bg-amber-100 text-amber-700" },
  pending_client: { label: "Client", chip: "bg-violet-100 text-violet-700" },
  validated: { label: "Validé", chip: "bg-emerald-100 text-emerald-700" },
  refused: { label: "Refusé", chip: "bg-rose-100 text-rose-700" },
};

function ValidationBadge({ stage }: { stage: ValidationStage }) {
  const m = VALIDATION_META[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        m.chip
      )}
      title={`Validation : ${m.label}`}
    >
      ✓ {m.label}
    </span>
  );
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_DATES = ["02", "03", "04", "05", "06", "07", "08"];

const STATUS_META: Record<
  ContentStatus,
  { dot: string; chip: string; text: string; label: string }
> = {
  Published: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-700",
    label: "Publié",
  },
  Scheduled: {
    dot: "bg-amber-500",
    chip: "bg-amber-100 text-amber-700",
    text: "text-amber-700",
    label: "Planifié",
  },
  Draft: {
    dot: "bg-violet-500",
    chip: "bg-violet-100 text-violet-700",
    text: "text-violet-700",
    label: "Brouillon",
  },
  Idea: {
    dot: "bg-zinc-400",
    chip: "bg-zinc-100 text-zinc-700",
    text: "text-zinc-700",
    label: "Idée",
  },
};

const VIEW_OPTIONS: { value: ViewKey; label: string }[] = [
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "30", label: "30 j" },
  { value: "60", label: "60 j" },
  { value: "90", label: "90 j" },
];

const WEEKS_BY_DAYS: Record<string, number> = {
  "30": 4,
  "60": 8,
  "90": 13,
};

// Deterministic date (1..31) for each calendar item, spread across the month.
const DATE_FOR_ID: Record<string, number> = {
  c1: 3,
  c2: 5,
  c3: 8,
  c4: 11,
  c5: 14,
  c6: 16,
  c7: 19,
  c8: 23,
  c9: 27,
};

function dateForItem(item: CalendarItem): number {
  if (DATE_FOR_ID[item.id]) return DATE_FOR_ID[item.id];
  const n = parseInt(item.id.replace(/\D/g, ""), 10) || 1;
  return Math.min(31, n * 3 + 1);
}

function normalizeStatus(s: string): ContentStatus {
  const v = (s ?? "").toLowerCase();
  if (v.includes("publish")) return "Published";
  if (v.includes("schedul") || v.includes("ready")) return "Scheduled";
  if (v.includes("idea")) return "Idea";
  return "Draft";
}

function StatusChip({ status }: { status: ContentStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        m.chip
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

function LegendChip({ status }: { status: ContentStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

function ContentCardVisual({
  item,
  selected,
  dragging,
  validationStage,
}: {
  item: CalendarItem;
  selected?: boolean;
  dragging?: boolean;
  validationStage?: ValidationStage | null;
}) {
  const meta = PLATFORM_META[item.platform];
  const status = STATUS_META[item.status];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card p-3 transition-all",
        "hover:shadow-md hover:-translate-y-0.5",
        selected && "ring-2 ring-[color:var(--ring)] border-transparent",
        dragging && "shadow-lg"
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformDot platform={item.platform} />
          <span className="text-xs font-medium tabular-nums text-foreground/80">
            {item.time}
          </span>
        </div>
        <span
          className={cn("h-2 w-2 rounded-full", status.dot)}
          aria-label={status.label}
          title={status.label}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground text-pretty">
        {item.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {item.format}
        </span>
        <span className="inline-flex items-center rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          🎯 {item.goal}
        </span>
        {validationStage && <ValidationBadge stage={validationStage} />}
      </div>
    </div>
  );
}

function DraggableContentCard({
  item,
  selected,
  onSelect,
  validationStage,
}: {
  item: CalendarItem;
  selected?: boolean;
  onSelect?: () => void;
  validationStage?: ValidationStage | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.id,
      data: { day: item.day },
    });
  const style: React.CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.4 : 1,
    touchAction: "none",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className="cursor-grab touch-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <ContentCardVisual
        item={item}
        selected={selected}
        dragging={isDragging}
        validationStage={validationStage}
      />
    </div>
  );
}

function WeekColumn({
  day,
  items,
  selectedId,
  onSelect,
  validationStages,
}: {
  day: number;
  items: CalendarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  validationStages?: Map<string, ValidationStage>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-2">
      <div className="px-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {DAYS[day]}
          </span>
          <span className="text-xs font-medium tabular-nums text-foreground/60">
            {DAY_DATES[day]}
          </span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "surface-soft flex min-h-[240px] flex-1 flex-col gap-2 p-2 transition-colors",
          isOver && "ring-2 ring-[color:var(--accent)]"
        )}
      >
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 p-3 text-center text-xs text-muted-foreground/70">
            Déposez ici
          </div>
        ) : (
          items.map((it) => (
            <DraggableContentCard
              key={it.id}
              item={it}
              selected={selectedId === it.id}
              onSelect={() => onSelect(it.id)}
              validationStage={validationStages?.get(it.id) ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MonthView({
  items,
  selectedId,
  onSelect,
}: {
  items: CalendarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expandedDate, setExpandedDate] = useState<number | null>(null);

  const itemsByDate = useMemo(() => {
    const map: Record<number, CalendarItem[]> = {};
    items.forEach((it) => {
      const d = dateForItem(it);
      (map[d] ||= []).push(it);
    });
    return map;
  }, [items]);

  return (
    <div className="surface-card p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[11px]"
          >
            {d}
          </div>
        ))}
        {Array.from({ length: 35 }, (_, i) => i + 1).map((date) => {
          const dayItems = itemsByDate[date] || [];
          const isExpanded = expandedDate === date;
          const hasItems = dayItems.length > 0;
          return (
            <button
              key={date}
              type="button"
              onClick={() => {
                if (!hasItems) return;
                setExpandedDate(isExpanded ? null : date);
                onSelect(dayItems[0].id);
              }}
              className={cn(
                "min-h-[58px] rounded-md border p-1.5 text-left transition-colors sm:min-h-[68px]",
                hasItems
                  ? "border-border bg-card hover:bg-foreground/[0.03]"
                  : "border-transparent bg-transparent hover:bg-foreground/[0.02]",
                isExpanded && "ring-1 ring-[color:var(--accent)]"
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-[10px] font-medium tabular-nums text-foreground/60 sm:text-[11px]">
                  {date}
                </span>
                {hasItems && (
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                    {dayItems.length}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {dayItems.slice(0, 5).map((it) => (
                  <span
                    key={it.id}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: PLATFORM_META[it.platform].color }}
                  />
                ))}
              </div>
              {isExpanded && hasItems && (
                <div className="mt-1.5 space-y-0.5">
                  {dayItems.map((it) => (
                    <div
                      key={it.id}
                      className={cn(
                        "truncate text-[10px] font-medium text-foreground/80",
                        selectedId === it.id &&
                          "text-[color:var(--accent-foreground)]"
                      )}
                    >
                      {it.title}
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoadmapView({
  items,
  days,
  onSelect,
}: {
  items: CalendarItem[];
  days: number;
  onSelect: (id: string) => void;
}) {
  const numWeeks = WEEKS_BY_DAYS[String(days)] ?? Math.ceil(days / 7);

  const weeks = useMemo(() => {
    const arr: CalendarItem[][] = Array.from({ length: numWeeks }, () => []);
    items.forEach((it, i) => {
      arr[i % numWeeks].push(it);
    });
    return arr;
  }, [items, numWeeks]);

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-foreground">
          Feuille de route — {days} jours
        </p>
        <span className="text-xs text-muted-foreground">
          {items.length} contenus répartis sur {numWeeks} semaines
        </span>
      </div>
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-[color:var(--accent)]/30 p-2.5">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent-foreground)]" />
        <p className="text-xs text-[color:var(--accent-foreground)] text-pretty">
          Make It répartit vos contenus sur la période pour maintenir un rythme
          régulier et maximiser la portée.
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 scroll-premium">
        {weeks.map((weekItems, weekIdx) => (
          <div key={weekIdx} className="surface-soft min-w-[170px] flex-1 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Semaine {weekIdx + 1}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  weekItems.length > 0
                    ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                    : "bg-foreground/5 text-muted-foreground"
                )}
              >
                {weekItems.length}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {weekItems.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-muted-foreground/60">
                  Libre
                </p>
              ) : (
                weekItems.slice(0, 2).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it.id)}
                    className="block w-full rounded-md border border-border bg-card p-2 text-left transition-colors hover:bg-foreground/[0.02]"
                  >
                    <div className="flex items-center gap-1.5">
                      <PlatformDot
                        platform={it.platform}
                        className="h-5 w-5 text-[9px]"
                      />
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {it.time}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs font-medium text-foreground">
                      {it.title}
                    </p>
                  </button>
                ))
              )}
              {weekItems.length > 2 && (
                <p className="text-[10px] text-muted-foreground">
                  + {weekItems.length - 2} autres
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailsPanel({
  item,
  onEdit,
  onRegenerate,
  onDelete,
  embedded,
  timing,
}: {
  item: CalendarItem | null;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  embedded?: boolean;
  timing?: { platform: string; recommendedTime: string; confidence: number; reason: string } | null;
}) {
  if (!item) {
    return (
      <div className="surface-card p-6">
        <div className="flex flex-col items-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Détails du contenu
          </p>
          <p className="mt-1 max-w-[220px] text-xs text-muted-foreground text-pretty">
            Cliquez sur un contenu du calendrier pour voir ses détails.
          </p>
        </div>
      </div>
    );
  }
  const status = STATUS_META[item.status];
  return (
    <div
      className={cn(
        "surface-card space-y-3 p-4",
        !embedded && "lg:sticky lg:top-4"
      )}
    >
      <div className="flex items-center justify-between">
        <PlatformDot platform={item.platform} />
        <StatusChip status={item.status} />
      </div>
      <h3 className="text-base font-semibold text-foreground text-balance">
        {item.title}
      </h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="surface-soft rounded-md p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Format
          </p>
          <p className="font-medium text-foreground">{item.format}</p>
        </div>
        <div className="surface-soft rounded-md p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Objectif
          </p>
          <p className="font-medium text-foreground">{item.goal}</p>
        </div>
        <div className="surface-soft rounded-md p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Créneau
          </p>
          <p className="font-medium text-foreground">
            {DAYS[item.day]} · {item.time}
          </p>
        </div>
        <div className="surface-soft rounded-md p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Statut
          </p>
          <p className={cn("font-medium", status.text)}>{status.label}</p>
        </div>
      </div>
      <div className="rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/30 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--accent-foreground)]">
          <Sparkles className="h-3.5 w-3.5" /> Meilleur créneau suggéré :{" "}
          {timing ? timing.recommendedTime : "Jeudi 18h"}
        </p>
        <p className="mt-1 text-[11px] text-[color:var(--accent-foreground)]/80">
          {timing?.reason ?? "Engagement moyen +18% vs autres créneaux."}
          {timing ? ` Confiance ${Math.round(timing.confidence * 100)}%.` : ""}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="h-11 flex-col gap-0.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="text-[10px]">Modifier</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          className="h-11 flex-col gap-0.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-[10px]">Regénérer</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="h-11 flex-col gap-0.5 hover:border-rose-200 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-[10px]">Supprimer</span>
        </Button>
      </div>
    </div>
  );
}

type ApiCalendarPlan = {
  id: string;
  horizon: number;
  name: string;
  objective?: string | null;
  items: {
    id: string;
    day: number;
    platform: string;
    format: string;
    title: string;
    goal?: string | null;
    status: string;
    scheduledAt?: string | null;
    time?: string | null;
  }[];
};

type TimingRecommendation = {
  platform: string;
  recommendedTime: string;
  confidence: number;
  reason: string;
};

export function PlanningSection() {
  const [view, setView] = useState<ViewKey>("week");
  const [items, setItems] = useState<CalendarItem[]>(() => [...initialItems]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [timing, setTiming] = useState<TimingRecommendation[]>([]);
  // P3: validation stages — contentId → stage, fetched from /api/validation/pending.
  const [validationStages, setValidationStages] = useState<Map<string, ValidationStage>>(new Map());
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // ─── Load calendar items + smart timing + validation stages on mount ──────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [plans, timingRes, validationRes] = await Promise.all([
        apiTry(async () => {
          const r = await apiGet<{ plans: ApiCalendarPlan[] }>("/api/calendar");
          return r.plans ?? [];
        }, [] as ApiCalendarPlan[]),
        apiTry(async () => {
          const r = await apiGet<{ recommendations: TimingRecommendation[] }>(
            "/api/calendar/timing"
          );
          return r.recommendations ?? [];
        }, [] as TimingRecommendation[]),
        // P3: fetch validation stages for the active workspace (silent fallback).
        apiTry(async () => {
          const r = await apiGet<{
            items: { contentId: string; stage: ValidationStage }[];
          }>("/api/validation/pending");
          return r.items ?? [];
        }, [] as { contentId: string; stage: ValidationStage }[]),
      ]);
      if (cancelled) return;
      if (plans.length > 0) {
        // Flatten items across plans + map to CalendarItem shape.
        const flat: CalendarItem[] = [];
        plans.forEach((p) => {
          (p.items ?? []).forEach((it) => {
            const day = Math.max(0, Math.min(6, (it.day ?? 0) % 7));
            const platform = (it.platform ?? "instagram") as CalendarItem["platform"];
            flat.push({
              id: it.id,
              day,
              platform,
              format: (it.format as CalendarItem["format"]) ?? "Post",
              title: it.title,
              goal: it.goal ?? "Engagement",
              status: normalizeStatus(it.status),
              time: it.time ?? (it.scheduledAt ? new Date(it.scheduledAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "18:00"),
            });
          });
        });
        if (flat.length > 0) setItems(flat);
      }
      if (timingRes.length > 0) setTiming(timingRes);
      if (validationRes.length > 0) {
        const map = new Map<string, ValidationStage>();
        validationRes.forEach((v) => map.set(v.contentId, v.stage));
        setValidationStages(map);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };

  }, []);

  // ─── Poll the calendar_generate job + refresh items on completion ──────
  useEffect(() => {
    if (!genJobId) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await apiGet<{ job: { status: string; output?: unknown } }>(
          `/api/jobs/${genJobId}`
        );
        if (stop) return;
        if (r.job.status === "completed" || r.job.status === "failed" || r.job.status === "canceled") {
          clearInterval(t);
          setGenJobId(null);
          setGenerating(false);
          if (r.job.status === "completed") {
            toast.success("Calendrier généré", {
              description: "Make It a placé vos contenus sur les meilleurs créneaux.",
            });
            // Refetch items.
            try {
              const fresh = await apiGet<{ plans: ApiCalendarPlan[] }>(
                "/api/calendar"
              );
              const flat: CalendarItem[] = [];
              (fresh.plans ?? []).forEach((p) => {
                (p.items ?? []).forEach((it) => {
                  const day = Math.max(0, Math.min(6, (it.day ?? 0) % 7));
                  flat.push({
                    id: it.id,
                    day,
                    platform: (it.platform ?? "instagram") as CalendarItem["platform"],
                    format: (it.format as CalendarItem["format"]) ?? "Post",
                    title: it.title,
                    goal: it.goal ?? "Engagement",
                    status: normalizeStatus(it.status),
                    time: it.time ?? "18:00",
                  });
                });
              });
              if (flat.length > 0) setItems(flat);
            } catch {
              /* keep current items */
            }
          } else if (r.job.status === "failed") {
            toast.error("Génération échouée", { description: "Réessayez plus tard." });
          }
        }
      } catch {
        /* transient — keep polling */
      }
    }, 800);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [genJobId]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenJobId(null);
    try {
      const res = await apiPost<{ jobId: string; estimated?: number }>(
        "/api/calendar/generate",
        { horizon: 30, objective: "engagement", frequency: "3/semaine" }
      );
      if (res?.jobId) setGenJobId(res.jobId);
    } catch (e) {
      setGenerating(false);
      toast.error("Génération indisponible", {
        description: e instanceof Error ? e.message : "Réessayez plus tard.",
      });
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("day-")) return;
    const newDay = parseInt(overId.replace("day-", ""), 10);
    if (Number.isNaN(newDay)) return;
    const activeId = String(active.id);
    // Optimistic local update.
    setItems((prev) =>
      prev.map((it) => (it.id === activeId ? { ...it, day: newDay } : it))
    );
    // PATCH /api/calendar/items/[id]
    try {
      await apiPatch(`/api/calendar/items/${activeId}`, { day: newDay });
    } catch (err) {
      toast.error("Déplacement non enregistré", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  );

  // Look up the timing recommendation matching the selected item's platform.
  const selectedTiming = useMemo<TimingRecommendation | null>(() => {
    if (!selectedItem || timing.length === 0) return null;
    return (
      timing.find((t) => t.platform === selectedItem.platform) ?? timing[0] ?? null
    );
  }, [selectedItem, timing]);

  const handleDelete = async () => {
    if (!selectedItem) return;
    const id = selectedItem.id;
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedId(null);
    setSheetOpen(false);
    toast.success("Contenu supprimé");
    try {
      await apiDelete(`/api/calendar/items/${id}`);
    } catch (e) {
      toast.error("Suppression non synchronisée", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleRegenerate = () => {
    toast.success("Contenu régénéré", {
      description: "Une nouvelle variation a été proposée par Make It.",
    });
  };

  const handlePlanSunday = async () => {
    const newItem: CalendarItem = {
      id: `c${Date.now()}`,
      day: 6,
      platform: "instagram",
      format: "Reel",
      title: "Reel éducatif du dimanche soir",
      goal: "Engagement",
      status: "Draft",
      time: "19:00",
    };
    setItems((prev) => [...prev, newItem]);
    setSelectedId(newItem.id);
    setSheetOpen(true);
    setView("week");
    toast.success("Créneau planifié", {
      description: "Reel éducatif ajouté ce dimanche à 19h.",
    });
  };

  const itemsByDay = useMemo(() => {
    const map: Record<number, CalendarItem[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    items.forEach((it) => {
      const d = Math.max(0, Math.min(6, it.day));
      map[d].push(it);
    });
    return map;
  }, [items]);

  const activeItem = activeDragId
    ? items.find((it) => it.id === activeDragId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Calendrier éditorial"
        title="Votre planning"
        description="Glissez-déposez vos contenus. Make It recommande les meilleurs créneaux."
        actions={
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(v) => {
                  if (v) setView(v as ViewKey);
                }}
                variant="outline"
                size="sm"
                className="rounded-lg border bg-card"
              >
                {VIEW_OPTIONS.map((opt) => (
                  <ToggleGroupItem
                    key={opt.value}
                    value={opt.value}
                    className="h-9 min-w-[44px] px-3 text-xs font-medium"
                  >
                    {opt.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="h-11 gap-1.5"
              >
                <Sparkles className="h-4 w-4" />
                {generating ? "Génération…" : "Générer mon calendrier"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Statut
              </span>
              <LegendChip status="Scheduled" />
              <LegendChip status="Published" />
              <LegendChip status="Draft" />
              <LegendChip status="Idea" />
            </div>
          </div>
        }
      />

      {loading && items.length === 0 && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[280px] w-full rounded-2xl" />
        </div>
      )}

      {generating && (
        <div className="surface-soft flex items-center gap-3 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)]">
            <Sparkles className="h-4 w-4 text-[color:var(--accent-foreground)]" />
          </div>
          <ProgressTracker steps={["Analyse", "Suggestion", "Placement"]} />
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {view === "week" && (
              <div className="surface-card p-3">
                <div className="flex gap-2 overflow-x-auto pb-2 scroll-premium">
                  {DAYS.map((_, day) => (
                    <WeekColumn
                      key={day}
                      day={day}
                      items={itemsByDay[day]}
                      selectedId={selectedId}
                      onSelect={handleSelect}
                      validationStages={validationStages}
                    />
                  ))}
                </div>
              </div>
            )}
            {view === "month" && (
              <MonthView
                items={items}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
            {(view === "30" || view === "60" || view === "90") && (
              <RoadmapView
                items={items}
                days={parseInt(view, 10)}
                onSelect={handleSelect}
              />
            )}

            {/* Smart timing side panel (under the calendar on small screens) */}
            {timing.length > 0 && (
              <div className="surface-card mt-4 p-4 lg:hidden">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[color:var(--emerald-accent)]" />
                  <h3 className="text-sm font-semibold">Meilleurs créneaux</h3>
                </div>
                <ul className="space-y-2">
                  {timing.slice(0, 4).map((t) => (
                    <li key={`${t.platform}-${t.recommendedTime}`} className="flex items-start gap-2 text-xs">
                      <span className="font-medium text-foreground">{t.platform}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="flex-1 text-pretty">{t.recommendedTime} — {t.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <aside className="hidden lg:block space-y-4">
            <DetailsPanel
              item={selectedItem}
              onEdit={() => setActiveSection("create")}
              onRegenerate={handleRegenerate}
              onDelete={handleDelete}
              timing={selectedTiming}
            />
            {timing.length > 0 && (
              <div className="surface-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[color:var(--emerald-accent)]" />
                  <h3 className="text-sm font-semibold">Meilleurs créneaux</h3>
                </div>
                <ul className="space-y-2">
                  {timing.slice(0, 5).map((t) => (
                    <li key={`${t.platform}-${t.recommendedTime}`} className="flex items-start gap-2 text-xs">
                      <span className="font-medium text-foreground capitalize">{t.platform}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="flex-1 text-pretty">{t.recommendedTime} — {t.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeItem ? (
            <div className="w-[220px] rotate-1 opacity-95 shadow-lg">
              <ContentCardVisual
                item={activeItem}
                dragging
                validationStage={validationStages.get(activeItem.id) ?? null}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Sheet
        open={sheetOpen && !!selectedItem}
        onOpenChange={setSheetOpen}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-sm"
        >
          <SheetHeader>
            <SheetTitle>Détails du contenu</SheetTitle>
            <SheetDescription>
              Modifiez, régénérez ou supprimez ce contenu planifié.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {selectedItem && (
              <DetailsPanel
                item={selectedItem}
                onEdit={() => setActiveSection("create")}
                onRegenerate={handleRegenerate}
                onDelete={handleDelete}
                embedded
                timing={selectedTiming}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <RecommendationCard
        icon={<Sparkles className="h-4 w-4" />}
        title="Vos vidéos éducatives performent le dimanche soir. Planifiez-en une ce dimanche 19h."
        reason="Engagement +18% sur ce créneau. Make It suggère un Reel éducatif aligné sur votre ADN de marque."
        cta="Planifier"
        tone="emerald"
        onCta={handlePlanSunday}
      />
    </div>
  );
}
