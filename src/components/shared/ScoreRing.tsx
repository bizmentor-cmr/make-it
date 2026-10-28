"use client";

import { cn } from "@/lib/utils";

export function ScoreRing({
  value,
  size = 160,
  stroke = 12,
  label,
  sublabel,
  className,
}: {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.93 0.004 120)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#scoreGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.55 0.13 165)" />
            <stop offset="100%" stopColor="oklch(0.72 0.16 70)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tracking-tight text-foreground">{Math.round(value)}</span>
        {label && <span className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</span>}
        {sublabel && <span className="text-[11px] text-muted-foreground/80">{sublabel}</span>}
      </div>
    </div>
  );
}

export function MiniScore({ value, label, delta }: { value: number; label: string; delta?: number }) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12">
          <svg width={48} height={48} className="-rotate-90">
            <circle cx={24} cy={24} r={20} fill="none" stroke="oklch(0.93 0.004 120)" strokeWidth={4} />
            <circle
              cx={24}
              cy={24}
              r={20}
              fill="none"
              stroke="oklch(0.55 0.13 165)"
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 20}
              strokeDashoffset={2 * Math.PI * 20 * (1 - value / 100)}
            />
          </svg>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tracking-tight">{value}</p>
        </div>
      </div>
      {delta !== undefined && (
        <span className={up ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-rose-600"}>
          {up ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}
