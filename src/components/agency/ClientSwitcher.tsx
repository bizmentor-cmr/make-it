"use client";

// Make It — ClientSwitcher (header, agency mode only).
//
// A dropdown that shows the active client name + chevron. On click, opens a
// popover with a search input + the list of accessible clients (fetched from
// /api/agency/clients), each with name + Make It Score + status dot. Clicking
// a client calls POST /api/agency/switch/[clientId] → on success, sets
// `activeClientId` + `workspaceId` in the store, calls `setWorkspaceHeader`
// (so existing apiGet calls hit the new workspace), and toasts.
//
// Keyboard shortcut: Cmd/Ctrl+K opens the switcher.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { apiGet, apiPost, setWorkspaceHeader, ApiError } from "@/lib/api-client";
import { getClientColor } from "@/lib/client-colors";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, Building2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

type AgencyClient = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  makeItScore: number;
  managerName: string | null;
  myRole: "manager" | "creative" | "admin" | null;
};

type SwitchResponse = {
  client: {
    id: string;
    agencyId: string;
    workspaceId: string;
    name: string;
    slug: string;
    status: "active" | "paused" | "archived";
    role: "manager" | "creative" | "admin";
  };
};

export function ClientSwitcher() {
  const { activeClientId, setActiveClientId, mode } = useAppStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch the client list when the popover opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiGet<{ clients: AgencyClient[] }>("/api/agency/clients");
        if (!cancelled) setClients(res.clients ?? []);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          // Not an agency member — hide the switcher.
          setClients([]);
        } else {
          // ignore — leave the list empty.
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus the input when opening.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Cmd/Ctrl+K opens the switcher (agency mode only).
  useEffect(() => {
    if (mode !== "agency") return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.managerName?.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q)
    );
  }, [clients, query]);

  const activeClient = useMemo(
    () => clients.find((c) => c.id === activeClientId) ?? null,
    [clients, activeClientId]
  );

  async function selectClient(c: AgencyClient) {
    if (switching) return;
    if (c.id === activeClientId) {
      setOpen(false);
      return;
    }
    setSwitching(c.id);
    try {
      const res = await apiPost<SwitchResponse>(`/api/agency/switch/${c.id}`);
      // Pin the workspace on the api-client so existing apiGet calls hit it.
      setWorkspaceHeader(res.client.workspaceId);
      // Update the store: activeClientId + workspaceId together.
      setActiveClientId(c.id, res.client.workspaceId);
      toast.success("Basculé vers " + c.name, {
        description: c.managerName ? `Responsable : ${c.managerName}` : undefined,
      });
      setOpen(false);
    } catch (e) {
      toast.error("Impossible de changer de client", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSwitching(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Changer de client"
          className={cn(
              "group relative inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card pl-2.5 pr-2.5 text-sm shadow-sm transition-all hover:shadow-md hover:border-[color:var(--emerald-accent)] overflow-hidden",
              "min-w-[140px] sm:min-w-[180px]"
          )}
        >
          {/* 2px top accent bar — colored by the active client's palette color */}
          {activeClient && (
            <span
              className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
              style={{ backgroundColor: getClientColor(activeClient.id).hex }}
              aria-hidden
            />
          )}
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">
            {activeClient?.name ?? "Tous les clients"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
        sideOffset={8}
      >
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un client…"
              className="h-9 pl-8 pr-3"
            />
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            {clients.length} client{clients.length > 1 ? "s" : ""} accessible{clients.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto scroll-premium p-1.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Aucun client{query ? " ne correspond à votre recherche" : ""}.
            </div>
          )}
          {!loading &&
            filtered.map((c) => {
              const active = c.id === activeClientId;
              // Per-client color dot — same id always picks the same palette slot.
              const cColor = getClientColor(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectClient(c)}
                  disabled={!!switching || c.status === "archived"}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                      : "hover:bg-muted/60",
                    c.status === "archived" && "opacity-50"
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cColor.hex }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {c.managerName ? `Resp. ${c.managerName}` : "Aucun responsable"}
                      {c.myRole ? ` · vous : ${c.myRole}` : ""}
                    </p>
                  </div>
                  {c.makeItScore > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--accent-foreground)]">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--emerald-accent)]" />
                      {c.makeItScore}
                    </span>
                  )}
                  {active && (
                    <Check className="h-4 w-4 shrink-0 text-[color:var(--emerald-accent)]" />
                  )}
                  {switching === c.id && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })}
        </div>
        <div className="border-t border-border p-2 text-center">
          <p className="text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted/60 px-1 py-0.5 font-mono text-[9px]">⌘K</kbd>{" "}
            pour ouvrir · {clients.length} client{clients.length > 1 ? "s" : ""}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
