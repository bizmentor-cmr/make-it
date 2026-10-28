"use client";

import { useEffect, useState } from "react";
import { useAppStore, type StoreNotification } from "@/store/app-store";
import { apiGet, apiPatch, apiPost, apiTry } from "@/lib/api-client";
import { notifications as mockNotifications } from "@/lib/mock-data";
import { X, Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ApiNotification = {
  id: string;
  type?: string;
  level?: "info" | "success" | "warning" | "danger";
  title: string;
  body?: string | null;
  read?: boolean;
  createdAt?: string;
};

export function NotificationsCenter() {
  const { setNotificationsOpen, notifications, setNotifications, markNotificationRead } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      const list = await apiTry(async () => {
        const res = await apiGet<{ notifications: ApiNotification[] }>(
          "/api/notifications?limit=40"
        );
        return res.notifications ?? [];
      }, [] as ApiNotification[]);
      if (cancelled) return;
      const mapped: StoreNotification[] = list.map((n) => ({
        id: n.id,
        type: (n.level ?? n.type ?? "info") as StoreNotification["type"],
        title: n.title,
        body: n.body ?? "",
        icon: iconFor(n.level ?? n.type ?? "info"),
        time: n.createdAt ? relativeTime(n.createdAt) : "",
        read: !!n.read,
      }));
      // Merge with anything pushed from the socket (newer, may not be in the API list yet).
      const socketOnly = notifications.filter(
        (n) => !mapped.some((m) => m.id === n.id)
      );
      setNotifications([...socketOnly, ...mapped]);
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  async function handleMarkRead(id: string) {
    markNotificationRead(id);
    try {
      await apiPatch(`/api/notifications/${id}`, { read: true });
    } catch (e) {
      toast.error("Marquage impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function handleMarkAll() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await apiPost("/api/notifications/read-all", {});
      setNotifications(notifications.map((n) => ({ ...n, read: true })));
      toast.success("Tout marqué comme lu");
    } catch (e) {
      toast.error("Action impossible", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={() => setNotificationsOpen(false)} />
      <div className="relative h-full w-full max-w-md border-l border-border bg-card shadow-2xl animate-float-out">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <p className="text-sm font-semibold">Notifications</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAll}
              disabled={markingAll}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {markingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Tout lire
            </button>
            <button onClick={() => setNotificationsOpen(false)} className="rounded-md p-1.5 hover:bg-muted" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="max-h-[80vh] overflow-y-auto scroll-premium p-3 space-y-2">
          {busy && notifications.length === 0 && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
            </div>
          )}
          {!busy && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Bell className="h-5 w-5 opacity-60" />
              <p>Aucune notification pour l'instant.</p>
            </div>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleMarkRead(n.id)}
              className={cn(
                "flex w-full gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60",
                n.read ? "border-border/60" : "border-border"
              )}
            >
              <span className="text-lg">{n.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground text-pretty">{n.body}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground/70">{n.time}</p>
              </div>
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full",
                  n.type === "success" && "bg-emerald-100 text-emerald-700",
                  n.type === "warning" && "bg-amber-100 text-amber-700",
                  n.type === "danger" && "bg-rose-100 text-rose-700",
                  n.type === "info" && "bg-muted text-muted-foreground"
                )}
              >
                <Check className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
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

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "À l'instant";
  if (diff < 3600_000) return `Il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Il y a ${Math.floor(diff / 3_600_000)} h`;
  return `Il y a ${Math.floor(diff / 86_400_000)} j`;
}

// Re-exported so the Header import shape stays compatible.
export { mockNotifications };
