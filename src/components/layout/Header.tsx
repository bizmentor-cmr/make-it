"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { CreditMeter } from "@/components/shared/CreditMeter";
import { ClientSwitcher } from "@/components/agency/ClientSwitcher";
import { getClientColor } from "@/lib/client-colors";
import { Bell, Menu, Search, Sparkles, Loader2 } from "lucide-react";
import { apiGet, apiTry } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ApiNotification = {
  id: string;
  level?: "info" | "success" | "warning" | "danger";
  title: string;
  body?: string | null;
  read?: boolean;
  createdAt?: string;
};

export function Header() {
  const { firstName, setSidebarOpen, setAdvisorOpen, setNotificationsOpen, mode, activeClientId } = useAppStore();
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState<ApiNotification[]>([]);

  // Active client's deterministic palette color — used for the 2px bottom
  // accent bar so the operator always sees which client workspace is active.
  const clientBarColor = activeClientId ? getClientColor(activeClientId).hex : null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async function load() {
      const list = await apiTry(async () => {
        const res = await apiGet<{ notifications: ApiNotification[] }>(
          "/api/notifications?limit=6"
        );
        return res.notifications ?? [];
      }, [] as ApiNotification[]);
      if (cancelled) return;
      setPreview(list);
      setUnread(list.filter((n) => !n.read).length);
    })();
    // Light polling (every 60s) to refresh the unread badge. The socket
    // pushes new notifications to the store and we also listen on the store.
    timer = setInterval(async () => {
      const list = await apiTry(async () => {
        const res = await apiGet<{ notifications: ApiNotification[] }>(
          "/api/notifications?limit=6"
        );
        return res.notifications ?? [];
      }, [] as ApiNotification[]);
      if (cancelled) return;
      setPreview(list);
      setUnread(list.filter((n) => !n.read).length);
    }, 60_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Also derive unread count directly from the store notifications pushed by
  // socket events (live) — no extra effect needed.
  const storeNotifs = useAppStore((s) => s.notifications);
  const socketUnread = storeNotifs.filter((n) => !n.read).length;
  const liveUnread = Math.max(unread, socketUnread);

  return (
    <>
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-[color:var(--background)]/80 glass px-4 py-3 md:px-6">
      <button
        onClick={() => setSidebarOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
        aria-label="Ouvrir le menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mode === "agency" && <ClientSwitcher />}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          Bonjour {firstName} <span className="inline-block">👋</span>
        </p>
        <p className="hidden sm:block text-xs text-muted-foreground truncate">
          Voici ce qui se passe avec votre présence digitale.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdvisorOpen(true)}
          className="hidden sm:inline-flex gap-1.5"
        >
          <Sparkles className="h-4 w-4" />
          Demander à Make It
        </Button>

        <button
          className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Recherche"
        >
          <Search className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {liveUnread > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {liveUnread}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <button
                onClick={() => setNotificationsOpen(true)}
                className="text-xs font-normal text-emerald-700 hover:underline"
              >
                Tout voir
              </button>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-80 overflow-y-auto scroll-premium">
              {preview.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
                </div>
              )}
              {preview.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className="flex items-start gap-2.5 py-2"
                  onSelect={() => setNotificationsOpen(true)}
                >
                  <span className="text-base">{iconFor(n.level ?? "info")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground text-pretty">{n.body}</p>
                    )}
                  </div>
                  {!n.read && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  )}
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <CreditMeter compact />

        <button
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[color:var(--emerald-accent)] to-[color:var(--amber-accent)] text-white text-xs font-semibold"
          )}
          aria-label="Profil"
        >
          {firstName.charAt(0)}
        </button>
      </div>
    </header>
    {/* 2px bottom color bar — visible in agency mode, colored by the active
        client's palette color so the operator always sees which workspace is active. */}
    {mode === "agency" && clientBarColor && (
      <div
        className="h-0.5 w-full"
        style={{ backgroundColor: clientBarColor }}
        aria-hidden
      />
    )}
    </>
  );
}

function iconFor(level: string): string {
  switch (level) {
    case "success":
      return "✅";
    case "warning":
      return "⚡";
    case "danger":
      return "⚠️";
    default:
      return "🔔";
  }
}
