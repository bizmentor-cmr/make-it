import { create } from "zustand";
import type { Wallet } from "@/lib/api-client";

export type SectionKey =
  | "home"
  | "strategy"
  | "create"
  | "planning"
  | "campaigns"
  | "messages"
  | "internal-messages"
  | "performance"
  | "brand"
  | "library"
  | "settings"
  | "agency-portfolio"
  | "agency-library"
  | "agency-credits"
  | "agency-team"
  | "studio";

export type StoreNotification = {
  id: string;
  type: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
  icon?: string;
  time?: string;
  read?: boolean;
};

interface AppState {
  activeSection: SectionKey;
  setActiveSection: (s: SectionKey) => void;

  // AI advisor overlay
  advisorOpen: boolean;
  setAdvisorOpen: (v: boolean) => void;

  // Credits panel (popover from header)
  creditsOpen: boolean;
  setCreditsOpen: (v: boolean) => void;

  // Notifications
  notificationsOpen: boolean;
  setNotificationsOpen: (v: boolean) => void;

  // Mobile sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  // Onboarding
  onboardingDone: boolean;
  setOnboardingDone: (v: boolean) => void;

  // Credits — legacy fields kept for backward compat with existing UI.
  // `creditsTotal` / `creditsUsed` now DERIVE from the real wallet object
  // (see `setWallet` below). They are kept here so existing components keep
  // working without changes.
  creditsTotal: number;
  creditsUsed: number;
  spendCredits: (n: number) => void;
  addCredits: (n: number) => void;

  // Real wallet (driven by /api/credits + socket credits:update).
  wallet: Wallet | null;
  setWallet: (w: Wallet) => void;

  // Active workspace id (driven by /api/auth/me).
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;

  // User
  firstName: string;
  setFirstName: (name: string) => void;

  // Live notifications (driven by /api/notifications + socket notification:new).
  notifications: StoreNotification[];
  setNotifications: (n: StoreNotification[]) => void;
  pushNotification: (n: StoreNotification) => void;
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;

  // Agency mode (P2 wires activation/theme; P3 consumes for portfolio+credits).
  // `mode: "solo" | "agency"`. In agency mode, the sidebar shows agency-only sections.
  mode: "solo" | "agency";
  setMode: (m: "solo" | "agency") => void;
  activeAgencyId: string | null;
  setActiveAgencyId: (id: string | null) => void;
  activeClientId: string | null; // AgencyClient id currently selected in the switcher
  setActiveClientId: (id: string | null, workspaceId?: string | null) => void;

  // Create-section prefill — set by features that drop the user into Create
  // with content already partially drafted (e.g. "S'en inspirer" from a
  // TrendPost → navigates to Create with the idea + contentId pre-filled).
  // CreateSection consumes + clears it on mount.
  createPrefill: {
    idea?: string;
    contentId?: string;
    source?: string; // e.g. "trend_post"
  } | null;
  setCreatePrefill: (v: {
    idea?: string;
    contentId?: string;
    source?: string;
  } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "home",
  setActiveSection: (s) => set({ activeSection: s, sidebarOpen: false }),

  advisorOpen: false,
  setAdvisorOpen: (v) => set({ advisorOpen: v }),

  creditsOpen: false,
  setCreditsOpen: (v) => set({ creditsOpen: v }),

  notificationsOpen: false,
  setNotificationsOpen: (v) => set({ notificationsOpen: v }),

  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),

  onboardingDone: true,
  setOnboardingDone: (v) => set({ onboardingDone: v }),

  // Defaults match the demo user (Camille, 5000 / 1760 used).
  creditsTotal: 5000,
  creditsUsed: 1760,
  spendCredits: (n) =>
    set((st) => ({
      creditsUsed: Math.min(st.creditsTotal, st.creditsUsed + n),
    })),
  addCredits: (n) =>
    set((st) => ({
      creditsTotal: st.creditsTotal + n,
    })),

  wallet: null,
  setWallet: (w) =>
    set((st) => {
      // Derive legacy fields from the real wallet — only when the wallet
      // reports meaningful numbers, so we don't flicker on partial socket
      // updates (e.g. `credits:update` may omit `totalConsumed`).
      const total = (w.subscriptionCredits ?? 0) + (w.purchasedCredits ?? 0);
      const consumed = w.totalConsumed ?? 0;
      const reserved = w.reservedCredits ?? 0;
      const patch: Partial<AppState> = { wallet: w };
      if (Number.isFinite(total) && total > 0) patch.creditsTotal = total;
      // Always update creditsUsed with the latest consumed+reserved when available.
      if (Number.isFinite(consumed)) {
        patch.creditsUsed = Math.min(total || st.creditsTotal, consumed + reserved);
      }
      return patch;
    }),

  workspaceId: null,
  setWorkspaceId: (id) => set({ workspaceId: id }),

  firstName: "Camille",
  setFirstName: (name) => set({ firstName: name || "Camille" }),

  notifications: [],
  setNotifications: (n) => set({ notifications: n }),
  pushNotification: (n) =>
    set((st) => {
      // Avoid duplicates from socket re-delivery.
      if (st.notifications.some((x) => x.id === n.id)) return st;
      return { notifications: [n, ...st.notifications].slice(0, 60) };
    }),
  markNotificationRead: (id) =>
    set((st) => ({
      notifications: st.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),
  clearAllNotifications: () => set({ notifications: [] }),

  mode: "solo",
  setMode: (m) => set({ mode: m }),
  activeAgencyId: null,
  setActiveAgencyId: (id) => set({ activeAgencyId: id }),
  activeClientId: null,
  setActiveClientId: (id, workspaceId) =>
    set((st) => ({
      activeClientId: id,
      // When switching clients, also update `workspaceId` so existing sections
      // (Home, Strategy, Create, etc.) re-fetch data for the new workspace.
      // Pass `workspaceId: null` explicitly to clear; `undefined` = leave as-is.
      ...(workspaceId !== undefined ? { workspaceId } : st.workspaceId ? {} : { workspaceId: null }),
    })),

  createPrefill: null,
  setCreatePrefill: (v) => set({ createPrefill: v }),
}));
