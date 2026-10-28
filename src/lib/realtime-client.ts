// Make It — Real-time socket.io singleton.
// Connects via the Caddy gateway: io("/?XTransformPort=3003") (path "/", query
// XTransformPort=3003). NEVER use io("http://localhost:3003").
// Only connects on the client side (guarded by typeof window).
//
// Exposes:
//   rt.joinWorkspace(roomId)   — joins a room (any id — workspace OR agency)
//   rt.on(event, cb) / rt.off(event, cb)
//   rt.connected
//   rt.disconnect()
//
// Multiple rooms are supported: the AuthProvider joins the workspace room on
// login + the agency room when the user is in agency mode (so the user
// receives `chat:message` events from both workspace AND agency channels).

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function ensure(): Socket | null {
  if (typeof window === "undefined") return null;
  if (socket) return socket;
  socket = io("/?XTransformPort=3003", {
    path: "/",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionAttempts: 20,
    autoConnect: true,
  });
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    socket.on("connect", () =>
      console.debug("[realtime] connected", socket?.id)
    );
    socket.on("disconnect", (r: unknown) =>
      console.debug("[realtime] disconnected", r)
    );
  }
  return socket;
}

export type RealtimeClient = {
  socket: Socket | null;
  connected: boolean;
  /** Join a room (any id — workspace OR agency). Re-emits on reconnect. */
  joinWorkspace: (roomId: string) => void;
  /** Alias for joinWorkspace — same semantics (conceptually a "joinRoom"). */
  joinRoom: (roomId: string) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  off: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
};

// Track all joined room ids so we can re-emit on reconnect.
const joinedRooms = new Set<string>();
function onConnectJoin() {
  for (const room of joinedRooms) {
    socket?.emit("join", { workspaceId: room });
  }
}

export const realtime: RealtimeClient = {
  get socket() {
    return ensure();
  },
  get connected() {
    return socket?.connected ?? false;
  },
  joinWorkspace(roomId: string) {
    const s = ensure();
    if (!s) return;
    // Track the room so we re-join on every reconnect (the server-side room
    // is empty after a disconnect — re-emitting all joins on connect keeps
    // every subscribed room live).
    joinedRooms.add(roomId);
    s.emit("join", { workspaceId: roomId });
    // Register the connect handler once.
    s.off("connect", onConnectJoin);
    s.on("connect", onConnectJoin);
  },
  joinRoom(roomId: string) {
    this.joinWorkspace(roomId);
  },
  on(event, cb) {
    const s = ensure();
    if (!s) return;
    s.on(event, cb as (...args: unknown[]) => void);
  },
  off(event, cb) {
    const s = ensure();
    if (!s) return;
    s.off(event, cb as (...args: unknown[]) => void);
  },
  emit(event, ...args) {
    const s = ensure();
    if (!s) return;
    s.emit(event, ...args);
  },
  disconnect() {
    if (socket) {
      socket.off("connect", onConnectJoin);
      socket.disconnect();
      socket = null;
      joinedRooms.clear();
    }
  },
};

// ─── Small job event bus (consumer-agnostic) ─────────────────────────────────
// Components that need to react to `job:progress` / `job:completed` (e.g. the
// <GenerationProgress> overlay) subscribe here. The AuthProvider wires the
// socket events to this bus, so a component can listen without touching the
// socket directly.

type JobEvent =
  | { kind: "progress"; id: string; status: string; progress: number; currentStep: string | null; consumedCredits: number; estimatedRemainingCredits?: number }
  | { kind: "completed"; id: string; type?: string; status: string; output: unknown; consumedCredits?: number };

type JobListener = (e: JobEvent) => void;
const jobListeners = new Set<JobListener>();

export function onJobEvent(cb: JobListener) {
  jobListeners.add(cb);
  return () => jobListeners.delete(cb);
}

export function emitJobEvent(e: JobEvent) {
  jobListeners.forEach((l) => {
    try {
      l(e);
    } catch {
      /* ignore */
    }
  });
}

export type { JobEvent, JobListener };
