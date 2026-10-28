// Make It — Real-time client (server-side).
// The Next.js server emits events to the socket.io mini-service (port 3003) via an internal HTTP endpoint.
// The mini-service then broadcasts to connected clients (rooms = workspaceId).

const REALTIME_URL = process.env.REALTIME_URL || "http://localhost:3004/internal/emit";

type EmitPayload = {
  room?: string; // workspaceId
  event: string;
  data: unknown;
};

// Fire-and-forget emit. Never throws.
export async function emitRealtime(payload: EmitPayload): Promise<void> {
  try {
    await fetch(REALTIME_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // The mini-service might not be running in some envs; never block.
    console.warn("[realtime] emit failed", e instanceof Error ? e.message : e);
  }
}

// Convenience emitters.
export function emitJobProgress(workspaceId: string, job: {
  id: string;
  status: string;
  progress: number;
  currentStep?: string | null;
  consumedCredits?: number;
  estimatedRemainingCredits?: number;
}) {
  return emitRealtime({
    room: workspaceId,
    event: "job:progress",
    data: job,
  });
}

export function emitJobCompleted(workspaceId: string, job: { id: string; type: string; output?: unknown; status: string; consumedCredits?: number }) {
  return emitRealtime({ room: workspaceId, event: "job:completed", data: job });
}

export function emitCreditUpdate(workspaceId: string, wallet: { subscriptionCredits: number; purchasedCredits: number; reservedCredits: number; totalConsumed: number }) {
  return emitRealtime({ room: workspaceId, event: "credits:update", data: wallet });
}

export function emitNotification(workspaceId: string, notification: { id: string; type: string; title: string; body?: string; level: string }) {
  return emitRealtime({ room: workspaceId, event: "notification:new", data: notification });
}

export function emitPublicationStatus(workspaceId: string, pub: { id: string; status: string; contentId?: string; platform?: string }) {
  return emitRealtime({ room: workspaceId, event: "publication:status", data: pub });
}

// ─── Internal messaging (Slack-lite) ─────────────────────────────────
// Emits `chat:message` to the channel's scope room (workspaceId OR agencyId).
// The frontend AuthProvider joins the workspace room; agency room joining
// will be wired by the agency-mode subagent.

export type ChatMessagePayload = {
  id: string;
  channelId: string;
  userId: string;
  userName: string | null;
  userAvatarUrl?: string | null;
  body: string;
  attachments: unknown[];
  mentions: string[];
  replyToId: string | null;
  replyTo?: { id: string; body: string; userName: string | null } | null;
  createdAt: string;
};

export function emitChatMessage(
  scope: { workspaceId?: string | null; agencyId?: string | null },
  message: ChatMessagePayload
) {
  const room = scope.workspaceId ?? scope.agencyId;
  if (!room) return Promise.resolve();
  return emitRealtime({ room, event: "chat:message", data: message });
}
