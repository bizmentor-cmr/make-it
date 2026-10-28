"use client";

import { useEffect, useState } from "react";
import { Check, Circle, Dot, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProgressTracker({ steps }: { steps: string[] }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCurrent((c) => (c + 1) % (steps.length + 1)), 900);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "pending";
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                state === "done" && "bg-emerald-500 text-white",
                state === "active" && "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
                state === "pending" && "bg-muted text-muted-foreground"
              )}
            >
              {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn("text-xs", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}
