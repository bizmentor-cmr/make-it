"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api-client";
import { onJobEvent } from "@/lib/realtime-client";

export function GenerationProgress({
  steps,
  estimated,
  used,
  total,
  onDone,
  open,
  // Optional — when provided, the component polls GET /api/jobs/[id] every 800ms
  // AND subscribes to the realtime job event bus for this jobId. The visual
  // design + step list / credit ledger are driven by the real job state. When
  // the job completes (status "completed"), `onDone()` is called with the
  // job's output.
  jobId,
  onOutput,
}: {
  steps: string[];
  estimated: number;
  used: number;
  total: number;
  onDone?: () => void;
  open: boolean;
  jobId?: string;
  onOutput?: (output: unknown) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [doneFired, setDoneFired] = useState(false);
  const [consumed, setConsumed] = useState(0);

  // Reset progress when `open` transitions (clean, no setState-in-effect, no ref writes during render).
  if (open !== prevOpen) {
    setPrevOpen(open);
    setCurrent(0);
    setDoneFired(false);
    setConsumed(0);
  }

  // ─── Real job tracking (polling + socket subscription) ──────────────────
  useEffect(() => {
    if (!open || !jobId) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const res = await apiGet<{
          job: {
            id: string;
            status: string;
            progress: number;
            currentStep: string | null;
            consumedCredits: number;
            output: unknown;
          };
        }>(`/api/jobs/${jobId}`);
        if (stop) return;
        applyJob(res.job);
      } catch {
        /* keep polling — transient errors */
      }
    }

    function applyJob(job: {
      status: string;
      progress: number;
      currentStep: string | null;
      consumedCredits: number;
      output?: unknown;
    }) {
      const pct = Math.max(0, Math.min(100, job.progress ?? 0));
      // Map 0..100 to step index — proportional to `steps.length`.
      const stepIdx = Math.min(
        steps.length,
        Math.floor((pct / 100) * steps.length + 0.5)
      );
      if (job.consumedCredits !== undefined) setConsumed(job.consumedCredits);
      if (job.status === "completed") {
        setCurrent(steps.length);
        if (!doneFired) {
          if (job.output !== undefined) onOutput?.(job.output);
          const t = setTimeout(() => {
            setDoneFired(true);
            onDone?.();
          }, 600);
          return () => clearTimeout(t);
        }
      } else if (job.status === "failed" || job.status === "canceled") {
        setCurrent(steps.length);
        if (!doneFired) {
          const t = setTimeout(() => {
            setDoneFired(true);
            onDone?.();
          }, 600);
          return () => clearTimeout(t);
        }
      } else {
        setCurrent(stepIdx);
      }
    }

    // 1) Subscribe to the socket job event bus for instant updates.
    const off = onJobEvent((e) => {
      if (e.id !== jobId) return;
      if (e.kind === "progress") {
        applyJob({
          status: e.status,
          progress: e.progress,
          currentStep: e.currentStep,
          consumedCredits: e.consumedCredits,
        });
      } else if (e.kind === "completed") {
        applyJob({
          status: e.status,
          progress: 100,
          currentStep: null,
          consumedCredits: e.consumedCredits ?? consumed,
          output: e.output,
        });
      }
    });

    // 2) Also poll every 800ms as a fallback (in case the socket isn't connected).
    void poll();
    timer = setInterval(poll, 800);

    return () => {
      stop = true;
      off();
      if (timer) clearInterval(timer);
    };
     
  }, [open, jobId]);

  // ─── Simulated fallback (no jobId) — keep the original animation ──────
  useEffect(() => {
    if (!open || jobId) return;
    if (current >= steps.length) {
      if (!doneFired) {
        const t = setTimeout(() => {
          setDoneFired(true);
          onDone?.();
        }, 600);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => setCurrent((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [open, jobId, current, steps.length, onDone, doneFired]);

  if (!open) return null;
  const done = current >= steps.length;
  const usedNow = jobId ? consumed || used : used;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4">
      <div className="surface-card p-5 w-full max-w-md mx-auto animate-float-up">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[color:var(--emerald-accent)]" />
          <p className="text-sm font-semibold">{done ? "Génération terminée" : "Génération en cours..."}</p>
        </div>
        <ul className="mt-4 space-y-2">
          {steps.map((s, i) => {
            const state = i < current ? "done" : i === current ? "active" : "pending";
            return (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full",
                    state === "done" && "bg-emerald-500 text-white",
                    state === "active" && "bg-amber-100 text-amber-700",
                    state === "pending" && "bg-muted text-muted-foreground"
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-3 w-3" />
                  ) : state === "active" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span className={state === "pending" ? "text-muted-foreground" : "text-foreground"}>{s}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center text-xs">
          <div>
            <p className="text-muted-foreground">Estimés</p>
            <p className="font-semibold tabular-nums">{estimated}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Utilisés</p>
            <p className="font-semibold tabular-nums">{usedNow}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Solde</p>
            <p className="font-semibold tabular-nums">{Math.max(0, total - usedNow)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
