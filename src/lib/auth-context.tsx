"use client";

// Make It — Auth context provider.
//
// On mount: GET /api/auth/me.
//   - 200 → status="authed", sets { user, workspace, wallet }, joins the realtime
//           room for the active workspace, wires socket events to the store + a
//           small job event bus.
//   - 401 → status="guest" (we render the login screen).
//
// Exposes:
//   - useAuth() → { status, user, workspace, wallet, signIn, signOut, refreshWallet }
//   - signIn(email, password) → POSTs the NextAuth credentials callback (form-
//     encoded with the csrf token first), then re-fetches /api/auth/me.
//   - signOut() → POST /api/auth/signout (NextAuth), clears state, disconnects
//     the realtime socket.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  apiGet,
  apiPost,
  setWorkspaceHeader,
  type MeResponse,
  type Wallet,
  ApiError,
} from "@/lib/api-client";
import { realtime, emitJobEvent } from "@/lib/realtime-client";
import { useAppStore } from "@/store/app-store";

type AuthStatus = "loading" | "authed" | "guest";

type AuthContextValue = {
  status: AuthStatus;
  user: MeResponse["user"] | null;
  workspace: MeResponse["workspace"] | null;
  wallet: Wallet | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  /** re-fetch /api/auth/me and resync store */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<MeResponse["user"] | null>(null);
  const [workspace, setWorkspace] = useState<MeResponse["workspace"] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  // Store sync helpers (avoids re-creating the store selector on each render).
  const store = useAppStore;
  const setWalletStore = useRef<((w: Wallet) => void) | null>(null);
  const setWorkspaceIdStore = useRef<((id: string | null) => void) | null>(null);
  const setFirstNameStore = useRef<((name: string) => void) | null>(null);
  const pushNotificationStore = useRef<
    ((n: { id: string; type: string; title: string; body: string; icon?: string; time?: string; read?: boolean }) => void) | null
  >(() => undefined);

  setWalletStore.current = (w) => store.getState().setWallet?.(w);
  setWorkspaceIdStore.current = (id) => store.getState().setWorkspaceId?.(id);
  setFirstNameStore.current = (name) => store.getState().setFirstName?.(name);
  pushNotificationStore.current = (n) =>
    (store.getState() as unknown as { pushNotification?: (n: unknown) => void }).pushNotification?.(n);

  const applyMe = useCallback((me: MeResponse) => {
    setUser(me.user);
    setWorkspace(me.workspace);
    setWallet(me.wallet);
    setWorkspaceHeader(me.workspace?.id ?? null);
    setWorkspaceIdStore.current?.(me.workspace?.id ?? null);
    setFirstNameStore.current?.(me.user?.name?.split(" ")[0] ?? "");
    if (me.wallet) setWalletStore.current?.(me.wallet);
    if (me.workspace?.id) realtime.joinWorkspace(me.workspace?.id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await apiGet<MeResponse>("/api/auth/me");
      setStatus("authed");
      applyMe(me);

      // Best-effort: detect if the user already has an agency. If so, flip the
      // store to agency mode immediately so the sidebar/theme reflect it
      // without requiring a visit to Settings.
      try {
        const agencyInfo = await apiGet<{
          agency: { id: string; name: string; status: string; mode: string };
          role: string;
        }>("/api/agency");
        if (agencyInfo?.agency?.id && agencyInfo.agency.status === "active") {
          const store = useAppStore.getState();
          store.setActiveAgencyId?.(agencyInfo.agency.id);
          store.setMode?.("agency");
          // Also join the agency realtime room.
          realtime.joinWorkspace(agencyInfo.agency.id);
        }
      } catch {
        // 404 = no agency yet (normal in solo mode). Ignore.
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setStatus("guest");
      } else {
        // Backend unreachable — keep "loading" briefly then go guest so the
        // login screen is shown (the user can still try to sign in).
        setStatus("guest");
      }
    }
  }, [applyMe]);

  const refreshWallet = useCallback(async () => {
    try {
      const w = await apiGet<Wallet>("/api/credits");
      setWallet(w);
      setWalletStore.current?.(w);
    } catch {
      /* ignore — keep previous wallet */
    }
  }, []);

  // Initial session probe.
  useEffect(() => {
    void refresh();
     
  }, []);

  // Wire realtime socket events to the store + job bus whenever authed.
  useEffect(() => {
    if (status !== "authed") return;

    const onCredits = (p: unknown) => {
      const w = (p ?? {}) as Partial<Wallet>;
      // Merge so we keep `plan` / `renewalDate` from the last /api/credits call.
      setWallet((prev) => ({ ...(prev ?? ({} as Wallet)), ...w } as Wallet));
      // Also push to the store via setWallet.
      const merged: Wallet = {
        subscriptionCredits: w.subscriptionCredits ?? 0,
        purchasedCredits: w.purchasedCredits ?? 0,
        reservedCredits: w.reservedCredits ?? 0,
        totalConsumed: w.totalConsumed ?? 0,
        available:
          (w.subscriptionCredits ?? 0) +
          (w.purchasedCredits ?? 0) -
          (w.reservedCredits ?? 0),
      } as Wallet;
      store.getState().setWallet?.(merged);
    };

    const onNotif = (p: unknown) => {
      const n = (p ?? {}) as {
        id: string;
        type?: string;
        title?: string;
        body?: string;
        level?: string;
      };
      // Push to the store's notification list (the NotificationsCenter will
      // refetch /api/notifications too, but the live push gives instant UX).
      pushNotificationStore.current?.({
        id: n.id,
        type: n.level ?? n.type ?? "info",
        title: n.title ?? "Notification",
        body: n.body ?? "",
        icon: iconForLevel(n.level ?? n.type ?? "info"),
        time: "À l'instant",
        read: false,
      });
      // Toast via sonner (lazy import to keep this file SSR-safe).
      import("sonner").then(({ toast }) =>
        toast(n.title ?? "Make It", { description: n.body })
      );
    };

    const onJobProgress = (p: unknown) => {
      const e = (p ?? {}) as {
        id: string;
        status?: string;
        progress?: number;
        currentStep?: string | null;
        consumedCredits?: number;
        estimatedRemainingCredits?: number;
      };
      emitJobEvent({
        kind: "progress",
        id: e.id,
        status: e.status ?? "running",
        progress: e.progress ?? 0,
        currentStep: e.currentStep ?? null,
        consumedCredits: e.consumedCredits ?? 0,
        estimatedRemainingCredits: e.estimatedRemainingCredits,
      });
    };

    const onJobCompleted = (p: unknown) => {
      const e = (p ?? {}) as {
        id: string;
        type?: string;
        status?: string;
        output?: unknown;
        consumedCredits?: number;
      };
      emitJobEvent({
        kind: "completed",
        id: e.id,
        type: e.type,
        status: e.status ?? "completed",
        output: e.output,
        consumedCredits: e.consumedCredits,
      });
    };

    const onPublication = (p: unknown) => {
      const e = (p ?? {}) as { id?: string; status?: string; platform?: string; contentId?: string };
      import("sonner").then(({ toast }) =>
        toast(
          e.status === "published" ? "Publication réussie" : "Mise à jour de publication",
          {
            description: e.platform
              ? `Plateforme : ${e.platform}`
              : "Statut de publication mis à jour.",
          }
        )
      );
    };

    realtime.on("credits:update", onCredits);
    realtime.on("notification:new", onNotif);
    realtime.on("job:progress", onJobProgress);
    realtime.on("job:completed", onJobCompleted);
    realtime.on("publication:status", onPublication);

    return () => {
      realtime.off("credits:update", onCredits);
      realtime.off("notification:new", onNotif);
      realtime.off("job:progress", onJobProgress);
      realtime.off("job:completed", onJobCompleted);
      realtime.off("publication:status", onPublication);
    };

  }, [status]);

  // ─── Agency room join (P5) ───────────────────────────────────────────────
  // When the user is in agency mode, also join the agency room so they receive
  // `chat:message` events for agency-scoped channels (#général-agence +
  // per-client #client-{name} channels + agency DMs). The realtime client
  // tracks multiple rooms, so this is additive (the workspace room joined in
  // applyMe stays live in parallel).
  useEffect(() => {
    const unsub = useAppStore.subscribe((s, prev) => {
      const agencyChanged = s.activeAgencyId !== prev.activeAgencyId;
      const modeChanged = s.mode !== prev.mode;
      if (!agencyChanged && !modeChanged) return;
      if (s.mode === "agency" && s.activeAgencyId) {
        realtime.joinWorkspace(s.activeAgencyId);
      }
    });
    // Initial fire — if the store is already in agency mode (e.g. the user
    // reloaded while in agency mode), join immediately.
    const s = store.getState();
    if (s.mode === "agency" && s.activeAgencyId) {
      realtime.joinWorkspace(s.activeAgencyId);
    }
    return () => unsub();
  }, []);

  // ─── signIn: NextAuth credentials flow ───────────────────────────────────
  const signIn = useCallback(
    async (email: string, password: string) => {
      // 1) Get CSRF token.
      const csrfRes = await fetch("/api/auth/csrf", {
        credentials: "include",
      });
      if (!csrfRes.ok) throw new ApiError("CSRF indisponible", { status: csrfRes.status });
      const csrf = (await csrfRes.json()) as { csrfToken: string };

      // 2) POST the credentials callback (form-encoded — NextAuth requirement).
      const body = new URLSearchParams({
        email,
        password,
        csrfToken: csrf.csrfToken,
        json: "true",
      });
      const res = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new ApiError(
          txt.includes("error") || res.status === 401
            ? "Email ou mot de passe incorrect."
            : `Échec de connexion (HTTP ${res.status})`,
          { status: res.status }
        );
      }
      // 3) Resync the session.
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    try {
      // NextAuth signout also needs the CSRF token.
      const csrfRes = await fetch("/api/auth/csrf", { credentials: "include" });
      if (csrfRes.ok) {
        const csrf = (await csrfRes.json()) as { csrfToken: string };
        const body = new URLSearchParams({
          csrfToken: csrf.csrfToken,
          json: "true",
        });
        await fetch("/api/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          credentials: "include",
        }).catch(() => undefined);
      }
    } catch {
      /* ignore — proceed to local cleanup */
    }
    realtime.disconnect();
    setUser(null);
    setWorkspace(null);
    setWallet(null);
    setWorkspaceHeader(null);
    setWorkspaceIdStore.current?.(null);
    setStatus("guest");
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    workspace,
    wallet,
    signIn,
    signOut,
    refreshWallet,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function iconForLevel(level: string): string {
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
