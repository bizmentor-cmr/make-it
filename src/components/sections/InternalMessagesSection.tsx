"use client";

// Make It — Internal Messaging (Slack-lite).
//
// 3-pane premium layout:
//   LEFT  (~240px) : channels list (#canaux + DMs) + search + "new channel" FAB
//   MIDDLE (flex)  : channel header, scrollable message list, composer
//   RIGHT (~240px) : channel details (members + leave) — lg+ only
//
// Real-time: subscribes to `chat:message` via the realtime singleton. Messages
// for the active channel are appended live; messages for other channels bump
// the unread badge + toast. Unsubscribed on unmount.
//
// Attachments: uploaded via POST /api/media (FormData). @mentions: when the
// user types `@`, a dropdown of context members appears; selecting inserts
// `@Name` and records the userId in `mentions`.
//
// Scope:
//   - solo mode  → workspace-scoped channels (X-Workspace-Id header).
//   - agency mode → agency-scoped channels (#général-agence + per-client
//                  #client-{name} channels + DMs with agency members). The
//                  members list fetches from /api/internal/agency-members.
//                  The header shows an "Agence" badge to indicate the scope.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import {
  Hash,
  Send,
  Paperclip,
  AtSign,
  Plus,
  Search,
  ArrowLeft,
  Users,
  X,
  Reply,
  Loader2,
  Trash2,
  Image as ImageIcon,
  File as FileIcon,
  MoreVertical,
  Settings2,
  Building2,
} from "lucide-react";

import { SectionHeader } from "@/components/shared/SectionHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiGet, apiPost, apiPatch, apiDelete, apiTry, ApiError } from "@/lib/api-client";
import { realtime } from "@/lib/realtime-client";
import { useAppStore } from "@/store/app-store";

// ── Types (mirrors backend rows) ─────────────────────────────────────

type Attachment = {
  kind: "image" | "video" | "audio" | "doc" | "file";
  name: string;
  url: string;
  size?: number;
  mime?: string;
};

type ChannelRow = {
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  name: string;
  type: string; // channel | dm
  topic: string | null;
  memberCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  dmWith?: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type MessageRow = {
  id: string;
  channelId: string;
  userId: string;
  userName: string | null;
  userAvatarUrl: string | null;
  body: string;
  attachments: Attachment[];
  mentions: string[];
  replyToId: string | null;
  replyTo?: {
    id: string;
    body: string;
    userName: string | null;
  } | null;
  createdAt: string;
};

type MemberRow = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
};

type ChannelDetail = {
  channel: {
    id: string;
    workspaceId: string | null;
    agencyId: string | null;
    name: string;
    type: string;
    topic: string | null;
    createdAt: string;
    updatedAt: string;
  };
  members: {
    userId: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    lastReadAt: string | null;
    joinedAt: string;
  }[];
  unreadCount: number;
};

// ── Helpers ──────────────────────────────────────────────────────────

function initials(name: string | null, email: string): string {
  const n = (name || email || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtDay(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
    if (d.toDateString() === yesterday.toDateString()) return "Hier";
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

function fmtSize(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// Detect attachment kind from a MediaAsset returned by /api/media.
function assetToAttachment(asset: {
  url?: string;
  storagePath?: string;
  filename?: string;
  name?: string;
  mimeType?: string;
  mime?: string;
  size?: number;
  kind?: string;
}): Attachment | null {
  const url = asset.url ?? asset.storagePath ?? "";
  if (!url) return null;
  const mime = asset.mimeType ?? asset.mime ?? "";
  const name = asset.filename ?? asset.name ?? "fichier";
  const kindRaw = (asset.kind ?? "").toLowerCase();
  let kind: Attachment["kind"] = "file";
  if (kindRaw === "image" || mime.startsWith("image/")) kind = "image";
  else if (kindRaw === "video" || mime.startsWith("video/")) kind = "video";
  else if (kindRaw === "audio" || mime.startsWith("audio/")) kind = "audio";
  else if (kindRaw === "doc" || mime === "application/pdf") kind = "doc";
  return { kind, name, url, size: asset.size, mime };
}

// ── Component ────────────────────────────────────────────────────────

export function InternalMessagesSection() {
  const workspaceId = useAppStore((s) => s.workspaceId);
  const mode = useAppStore((s) => s.mode);
  const activeAgencyId = useAppStore((s) => s.activeAgencyId);
  const isAgency = mode === "agency" && !!activeAgencyId;
  const scopeSuffix = isAgency ? "?scope=agency" : "";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [dms, setDms] = useState<ChannelRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Composer state
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch channels + DMs + members ─────────────────────────────────
  const refreshChannels = useCallback(async () => {
    try {
      const data = await apiGet<{ channels: ChannelRow[]; dms: ChannelRow[] }>(
        `/api/internal/channels${scopeSuffix}`
      );
      setChannels(data.channels ?? []);
      setDms(data.dms ?? []);
      setInitError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Backend injoignable";
      setInitError(msg);
      setChannels([]);
      setDms([]);
    } finally {
      setLoadingInit(false);
    }
  }, [scopeSuffix]);

  const refreshMembers = useCallback(async () => {
    // Agency mode → fetch from /api/internal/agency-members.
    // Solo mode → fetch from /api/internal/members.
    const endpoint = isAgency
      ? "/api/internal/agency-members"
      : "/api/internal/members";
    const data = await apiTry(
      () => apiGet<{ members: MemberRow[] }>(endpoint),
      { members: [] as MemberRow[] }
    );
    setMembers(data.members ?? []);
  }, [isAgency]);

  useEffect(() => {
    void refreshChannels();
    void refreshMembers();
  }, [refreshChannels, refreshMembers, workspaceId, activeAgencyId]);

  // ── Realtime: chat:message ─────────────────────────────────────────
  useEffect(() => {
    const onChat = (payload: unknown) => {
      const msg = payload as MessageRow & { createdAt: string };
      if (!msg || typeof msg.id !== "string" || typeof msg.channelId !== "string") return;
      // Normalize createdAt to ISO if it came as a Date string.
      const normalized: MessageRow = { ...msg, createdAt: msg.createdAt };

      // If the message belongs to the active channel, append + auto-scroll.
      if (selectedIdRef.current === msg.channelId) {
        setMessages((prev) =>
          prev.some((m) => m.id === normalized.id) ? prev : [...prev, normalized]
        );
        // Auto-mark read since we're looking at it.
        void apiPost(`/api/internal/channels/${msg.channelId}/read`).catch(() => undefined);
        // Bump the channel's lastMessageAt + zero its unread.
        setChannels((prev) =>
          prev.map((c) =>
            c.id === msg.channelId
              ? {
                  ...c,
                  lastMessageAt: normalized.createdAt,
                  lastMessagePreview: normalized.body.slice(0, 140),
                  unreadCount: 0,
                }
              : c
          )
        );
        setDms((prev) =>
          prev.map((c) =>
            c.id === msg.channelId
              ? {
                  ...c,
                  lastMessageAt: normalized.createdAt,
                  lastMessagePreview: normalized.body.slice(0, 140),
                  unreadCount: 0,
                }
              : c
          )
        );
      } else {
        // Increment unread + toast.
        const fromName = normalized.userName ?? "Quelqu'un";
        const channelName = channelNameForIdRef.current(msg.channelId);
        toast(`💬 ${fromName} dans ${channelName}`, {
          description: normalized.body.slice(0, 160),
        });
        setChannels((prev) =>
          prev.map((c) =>
            c.id === msg.channelId
              ? {
                  ...c,
                  unreadCount: c.unreadCount + 1,
                  lastMessageAt: normalized.createdAt,
                  lastMessagePreview: normalized.body.slice(0, 140),
                }
              : c
          )
        );
        setDms((prev) =>
          prev.map((c) =>
            c.id === msg.channelId
              ? {
                  ...c,
                  unreadCount: c.unreadCount + 1,
                  lastMessageAt: normalized.createdAt,
                  lastMessagePreview: normalized.body.slice(0, 140),
                }
              : c
          )
        );
      }
    };
    realtime.on("chat:message", onChat);
    return () => {
      realtime.off("chat:message", onChat);
    };
  }, []);

  // Refs to keep the realtime cb stable but read latest state.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const channelNameForIdRef = useRef<(id: string) => string>(() => "un canal");
  useEffect(() => {
    channelNameForIdRef.current = (id: string) => {
      const c = channels.find((x) => x.id === id);
      if (c) return c.type === "dm" ? c.dmWith?.name ?? "DM" : `#${c.name}`;
      const d = dms.find((x) => x.id === id);
      if (d) return d.dmWith?.name ?? "DM";
      return "un canal";
    };
  }, [channels, dms]);

  // ── Select a channel ───────────────────────────────────────────────
  const selectChannel = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setMobilePane("thread");
      setMessages([]);
      setReplyTo(null);
      setDetail(null);
      setMessagesLoading(true);
      try {
        const [detailData, msgData] = await Promise.all([
          apiGet<ChannelDetail>(`/api/internal/channels/${id}`),
          apiGet<{ messages: MessageRow[] }>(
            `/api/internal/channels/${id}/messages?limit=50`
          ),
        ]);
        setDetail(detailData);
        setMessages(msgData.messages ?? []);
        // Mark read.
        void apiPost(`/api/internal/channels/${id}/read`).catch(() => undefined);
        // Zero out unread badge.
        setChannels((prev) =>
          prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
        );
        setDms((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      } catch {
        // Mock fallback — don't crash the UI.
        toast.error("Canal injoignable", {
          description: "Réessayez dans un instant.",
        });
      } finally {
        setMessagesLoading(false);
      }
    },
    []
  );

  // Auto-scroll to bottom when messages arrive.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, selectedId]);

  // ── Composer: @mention detection ──────────────────────────────────
  const filteredMembers = useMemo(() => {
    if (!mentionQuery) return members;
    const q = mentionQuery.toLowerCase();
    return members.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [members, mentionQuery]);

  const handleDraftChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    // Detect @mention: look at the token being typed just before the caret.
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx >= 0) {
      const after = before.slice(atIdx + 1);
      // Must be a fresh token (no spaces).
      if (/^[\w.\-]*$/.test(after) && after.length <= 40) {
        setMentionOpen(true);
        setMentionQuery(after);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery("");
  };

  const insertMention = (m: MemberRow) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const v = ta.value;
    const caret = ta.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) return;
    const after = v.slice(caret);
    const display = m.name ?? m.email.split("@")[0];
    const newText = `${v.slice(0, atIdx)}@${display} ${after}`;
    setDraft(newText);
    setDraftMentions((prev) => (prev.includes(m.userId) ? prev : [...prev, m.userId]));
    setMentionOpen(false);
    setMentionQuery("");
    // Focus + move caret just after the inserted mention.
    queueMicrotask(() => {
      const pos = atIdx + display.length + 2; // @display + space
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMembers.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMembers[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    // Enter sends (Shift+Enter for newline).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Attachments: upload via /api/media ─────────────────────────────
  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be picked again
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 20 Mo)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const asset = await apiPost<{
        url?: string;
        storagePath?: string;
        filename?: string;
        mimeType?: string;
        size?: number;
        kind?: string;
      }>("/api/media", fd);
      const att = assetToAttachment(asset);
      if (!att) throw new Error("Upload invalide");
      setPendingAttachments((prev) => [...prev, att]);
      toast.success("Pièce jointe prête");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Échec de l'upload";
      toast.error("Upload impossible", { description: msg });
    } finally {
      setUploading(false);
    }
  };

  // ── Send ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!selectedId) return;
    const text = draft.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (sending) return;
    setSending(true);
    const body = text;
    const attachments = pendingAttachments;
    const mentions = draftMentions;
    const replyToId = replyTo?.id ?? null;
    // Optimistic clear.
    setDraft("");
    setPendingAttachments([]);
    setDraftMentions([]);
    setReplyTo(null);
    try {
      const res = await apiPost<{ message: MessageRow }>(
        `/api/internal/channels/${selectedId}/messages`,
        { body, attachments, mentions, replyToId }
      );
      // Append (the realtime event will also arrive — dedupe by id).
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Échec de l'envoi";
      // Rollback composer so the user can retry.
      setDraft(body);
      setPendingAttachments(attachments);
      setDraftMentions(mentions);
      if (replyToId) setReplyTo(replyTo);
      toast.error("Message non envoyé", { description: msg });
    } finally {
      setSending(false);
    }
  };

  // ── Create channel ─────────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const handleCreateChannel = async () => {
    if (!newName.trim()) {
      toast.error("Nom du canal requis");
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: newName.trim(),
        type: "channel",
        topic: newTopic.trim() || undefined,
        memberIds: [...newMemberIds, ""].filter(Boolean), // backend will append current user
      };
      if (isAgency && activeAgencyId) body.agencyId = activeAgencyId;
      const res = await apiPost<{ channel: ChannelRow }>(
        "/api/internal/channels",
        body
      );
      setChannels((prev) => [res.channel, ...prev]);
      setCreateOpen(false);
      setNewName("");
      setNewTopic("");
      setNewMemberIds([]);
      toast.success(`Canal #${res.channel.name} créé`);
      void selectChannel(res.channel.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Échec de création";
      toast.error("Création impossible", { description: msg });
    } finally {
      setCreating(false);
    }
  };

  // ── Open a DM with a member ────────────────────────────────────────
  const openDM = async (userId: string) => {
    try {
      const body: Record<string, unknown> = { userId };
      if (isAgency && activeAgencyId) body.agencyId = activeAgencyId;
      const res = await apiPost<{ channel: ChannelRow }>("/api/internal/dm", body);
      setDms((prev) => {
        if (prev.some((d) => d.id === res.channel.id)) {
          return prev.map((d) => (d.id === res.channel.id ? res.channel : d));
        }
        return [res.channel, ...prev];
      });
      void selectChannel(res.channel.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "DM impossible";
      toast.error("Conversation directe impossible", { description: msg });
    }
  };

  // ── Rename / delete channel ────────────────────────────────────────
  const handleRename = async () => {
    if (!detail || !selectedId) return;
    const name = window.prompt("Nouveau nom du canal", detail.channel.name);
    if (!name || name.trim() === detail.channel.name) return;
    try {
      const res = await apiPatch<{ channel: ChannelRow }>(
        `/api/internal/channels/${selectedId}`,
        { name: name.trim() }
      );
      setChannels((prev) =>
        prev.map((c) => (c.id === selectedId ? res.channel : c))
      );
      setDetail((d) => (d ? { ...d, channel: { ...d.channel, name: res.channel.name } } : d));
      toast.success("Canal renommé");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Échec";
      toast.error("Renommage impossible", { description: msg });
    }
  };

  const handleDelete = async () => {
    if (!detail || !selectedId) return;
    if (detail.channel.type === "dm") {
      toast.error("Impossible de supprimer une conversation directe");
      return;
    }
    if (!window.confirm(`Supprimer le canal #${detail.channel.name} ?`)) return;
    try {
      await apiDelete(`/api/internal/channels/${selectedId}`);
      setChannels((prev) => prev.filter((c) => c.id !== selectedId));
      setSelectedId(null);
      setDetail(null);
      setMessages([]);
      toast.success("Canal supprimé");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Échec";
      toast.error("Suppression impossible", { description: msg });
    }
  };

  // ── Filtered channels for search ───────────────────────────────────
  const filteredChannels = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.topic ?? "").toLowerCase().includes(q)
    );
  }, [channels, search]);

  const filteredDMs = useMemo(() => {
    if (!search.trim()) return dms;
    const q = search.toLowerCase();
    return dms.filter(
      (d) =>
        (d.dmWith?.name ?? "").toLowerCase().includes(q) ||
        (d.dmWith?.email ?? "").toLowerCase().includes(q)
    );
  }, [dms, search]);

  const activeChannel = useMemo(() => {
    if (!selectedId) return null;
    return channels.find((c) => c.id === selectedId) ?? dms.find((d) => d.id === selectedId) ?? null;
  }, [selectedId, channels, dms]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={isAgency ? "Agence" : "Équipe"}
        title="Communication interne"
        description={
          isAgency
            ? "Canaux et messages directs de votre agence — visibles quel que soit le client actif."
            : "Canaux et messages directs de votre équipe — temps réel, mentions, pièces jointes."
        }
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-9 gap-1.5 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nouveau canal
          </Button>
        }
      />

      <div className="surface-card flex h-[calc(100vh-15rem)] min-h-[28rem] overflow-hidden p-0">
        {/* LEFT: channels list ─ visible on md+ AND on mobile when no channel selected */}
        <aside
          className={cn(
            "flex w-full flex-col border-r border-border bg-card/40 md:w-64 md:flex",
            mobilePane === "thread" && selectedId ? "hidden md:flex" : "flex"
          )}
        >
          {/* Scope header — "Agence" badge or empty */}
          {isAgency && (
            <div className="flex items-center gap-2 border-b border-border bg-[color:var(--accent)]/40 px-3 py-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--emerald-accent)] text-white">
                <Building2 className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">
                  Messagerie d'agence
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  Canaux transverses · tous les clients
                </p>
              </div>
            </div>
          )}
          {/* Search */}
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un canal…"
                className="h-9 pl-8"
                aria-label="Rechercher un canal"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-4 p-3">
              {/* Channels */}
              <div>
                <div className="mb-1 flex items-center justify-between px-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Canaux
                  </p>
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Nouveau canal"
                    title="Nouveau canal"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <ul className="space-y-0.5">
                  {loadingInit && (
                    <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Chargement…
                    </li>
                  )}
                  {!loadingInit && filteredChannels.length === 0 && (
                    <li className="px-2 py-2 text-xs text-muted-foreground">
                      {initError ? "Injoignable pour le moment." : "Aucun canal."}
                    </li>
                  )}
                  {filteredChannels.map((c) => (
                    <ChannelListItem
                      key={c.id}
                      channel={c}
                      active={selectedId === c.id}
                      onClick={() => void selectChannel(c.id)}
                    />
                  ))}
                </ul>
              </div>

              {/* DMs */}
              <div>
                <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Messages directs
                </p>
                <ul className="space-y-0.5">
                  {filteredDMs.length === 0 && !loadingInit && (
                    <li className="px-2 py-2 text-xs text-muted-foreground">
                      Démarrez un DM depuis la liste des membres.
                    </li>
                  )}
                  {filteredDMs.map((d) => (
                    <DMListItem
                      key={d.id}
                      channel={d}
                      active={selectedId === d.id}
                      onClick={() => void selectChannel(d.id)}
                    />
                  ))}
                </ul>
              </div>

              {/* Members quick list (start a DM) */}
              {members.length > 0 && (
                <div>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Membres
                  </p>
                  <ul className="space-y-0.5">
                    {members.slice(0, 8).map((m) => (
                      <li key={m.userId}>
                        <button
                          onClick={() => void openDM(m.userId)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5"
                        >
                          <Avatar className="h-6 w-6">
                            {m.avatarUrl ? (
                              <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} />
                            ) : null}
                            <AvatarFallback className="text-[10px]">
                              {initials(m.name, m.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-foreground">{m.name ?? m.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* MIDDLE: messages ─ visible when a channel is selected (full-screen on mobile) */}
        <section
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            mobilePane === "list" && selectedId ? "hidden md:flex" : "flex"
          )}
        >
          {!activeChannel || !selectedId ? (
            <EmptyThread />
          ) : (
            <>
              {/* Channel header */}
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                <button
                  onClick={() => setMobilePane("list")}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 md:hidden"
                  aria-label="Retour à la liste"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                {activeChannel.type === "dm" ? (
                  <Avatar className="h-7 w-7">
                    {activeChannel.dmWith?.avatarUrl ? (
                      <AvatarImage
                        src={activeChannel.dmWith.avatarUrl}
                        alt={activeChannel.dmWith.name ?? "DM"}
                      />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {initials(activeChannel.dmWith?.name ?? null, activeChannel.dmWith?.email ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Hash className="h-5 w-5 text-[color:var(--ink)]" />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                    {activeChannel.type === "dm"
                      ? activeChannel.dmWith?.name ?? "Conversation directe"
                      : `#${activeChannel.name}`}
                    {isAgency && (
                      <Badge className="bg-[color:var(--emerald-accent)] px-1.5 py-0 text-[9px] text-white hover:bg-[color:var(--emerald-accent)]">
                        Agence
                      </Badge>
                    )}
                  </h2>
                  {activeChannel.type === "channel" && activeChannel.topic && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {activeChannel.topic}
                    </p>
                  )}
                </div>
                <div className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                  <Users className="h-3.5 w-3.5" />
                  {detail?.members.length ?? activeChannel.memberCount}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Actions du canal"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {activeChannel.type === "channel" && (
                      <DropdownMenuItem onClick={() => void handleRename()}>
                        <Settings2 className="h-4 w-4" />
                        Renommer
                      </DropdownMenuItem>
                    )}
                    {activeChannel.type === "channel" && (
                      <DropdownMenuItem
                        onClick={() => void handleDelete()}
                        className="text-rose-600 focus:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </DropdownMenuItem>
                    )}
                    {activeChannel.type === "dm" && (
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedId(null);
                          setDetail(null);
                          setMessages([]);
                          setMobilePane("list");
                        }}
                      >
                        <X className="h-4 w-4" />
                        Fermer la conversation
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>

              {/* Messages list */}
              <div
                ref={scrollRef}
                className="scroll-premium flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4"
              >
                {messagesLoading && (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement des messages…
                  </div>
                )}
                {!messagesLoading && messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <div className="rounded-full bg-[color:var(--accent)] p-3">
                      <Hash className="h-5 w-5 text-[color:var(--accent-foreground)]" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Aucun message pour le moment</p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      Démarrez la conversation — votre équipe sera notifiée en temps réel.
                    </p>
                  </div>
                )}
                {!messagesLoading &&
                  messages.map((m, idx) => {
                    const prev = messages[idx - 1];
                    const showDaySeparator =
                      !prev ||
                      new Date(prev.createdAt).toDateString() !==
                        new Date(m.createdAt).toDateString();
                    return (
                      <div key={m.id}>
                        {showDaySeparator && (
                          <div className="my-3 flex items-center gap-2">
                            <Separator className="flex-1" />
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                              {fmtDay(m.createdAt)}
                            </span>
                            <Separator className="flex-1" />
                          </div>
                        )}
                        <MessageItem
                          message={m}
                          onReply={() => setReplyTo(m)}
                        />
                      </div>
                    );
                  })}
              </div>

              {/* Reply preview */}
              {replyTo && (
                <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-2">
                  <Reply className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-muted-foreground">
                      Réponse à{" "}
                      <span className="font-medium text-foreground">
                        {replyTo.userName ?? "Quelqu'un"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {replyTo.body.slice(0, 120)}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="rounded p-1 text-muted-foreground hover:bg-foreground/5"
                    aria-label="Annuler la réponse"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Pending attachments preview */}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-border bg-muted/30 px-4 py-2">
                  {pendingAttachments.map((a, i) => (
                    <div
                      key={`${a.url}-${i}`}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1"
                    >
                      {a.kind === "image" ? (
                        <img
                          src={a.url}
                          alt={a.name}
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                          <FileIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <span className="max-w-[140px] truncate text-xs text-foreground">
                        {a.name}
                      </span>
                      <button
                        onClick={() =>
                          setPendingAttachments((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="rounded p-0.5 text-muted-foreground hover:bg-foreground/5"
                        aria-label="Retirer la pièce jointe"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Composer */}
              <div className="relative border-t border-border bg-card p-3">
                {/* @mention dropdown */}
                {mentionOpen && filteredMembers.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                    <p className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Membres — @{mentionQuery || "…"}
                    </p>
                    {filteredMembers.slice(0, 8).map((m, i) => (
                      <button
                        key={m.userId}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(m);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                          i === mentionIndex
                            ? "bg-[color:var(--accent)]"
                            : "hover:bg-foreground/5"
                        )}
                      >
                        <Avatar className="h-6 w-6">
                          {m.avatarUrl ? (
                            <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {initials(m.name, m.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {m.name ?? m.email}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {m.role}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => void handleFileSelected(e)}
                    accept="image/*,video/*,audio/*,application/pdf"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handlePickFile}
                    disabled={uploading || sending}
                    className="h-9 w-9 shrink-0"
                    aria-label="Joindre un fichier"
                    title="Joindre un fichier"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </Button>
                  <Textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleDraftKeyDown}
                    placeholder={`Message ${activeChannel.type === "dm" ? "" : `#${activeChannel.name}`} — Entrée pour envoyer, Maj+Entrée pour un saut de ligne`}
                    rows={1}
                    className="max-h-32 min-h-[2.5rem] flex-1 resize-none"
                    disabled={sending}
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={
                      sending || (draft.trim() === "" && pendingAttachments.length === 0)
                    }
                    className="h-9 w-9 shrink-0 bg-[color:var(--ink)] px-0 text-[color:var(--primary-foreground)] hover:opacity-90"
                    aria-label="Envoyer"
                    title="Envoyer (Entrée)"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
                  <AtSign className="mr-1 inline h-3 w-3" />
                  Tapez <code className="font-mono">@</code> pour mentionner un membre.
                </p>
              </div>
            </>
          )}
        </section>

        {/* RIGHT: channel details — lg+ only */}
        {activeChannel && (
          <aside className="hidden w-60 flex-col border-l border-border bg-card/40 lg:flex">
            <ChannelDetails
              detail={detail}
              channel={activeChannel}
              members={members}
              onOpenDM={openDM}
            />
          </aside>
        )}
      </div>

      {/* Create channel dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau canal{isAgency ? " d'agence" : ""}</DialogTitle>
            <DialogDescription>
              Créez un canal pour discuter avec une partie ou toute
              l'équipe{isAgency ? " de l'agence" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Nom du canal
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ex: marketing-q1"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Sujet (optionnel)
              </label>
              <Input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="ex: Planning campagne Q1"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Membres ({newMemberIds.length})
              </label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {members.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Aucun autre membre {isAgency ? "dans cette agence" : "dans ce workspace"}.
                  </p>
                )}
                {members.map((m) => {
                  const checked = newMemberIds.includes(m.userId);
                  return (
                    <label
                      key={m.userId}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-foreground/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setNewMemberIds((prev) =>
                            e.target.checked
                              ? [...prev, m.userId]
                              : prev.filter((x) => x !== m.userId)
                          );
                        }}
                        className="h-3.5 w-3.5 accent-[color:var(--ink)]"
                      />
                      <Avatar className="h-5 w-5">
                        {m.avatarUrl ? (
                          <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} />
                        ) : null}
                        <AvatarFallback className="text-[9px]">
                          {initials(m.name, m.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-foreground">{m.name ?? m.email}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Annuler
            </Button>
            <Button
              onClick={() => void handleCreateChannel()}
              disabled={creating || !newName.trim()}
              className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Création…
                </>
              ) : (
                "Créer le canal"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function ChannelListItem({
  channel,
  active,
  onClick,
}: {
  channel: ChannelRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          active
            ? "bg-[color:var(--accent)] text-foreground"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        )}
      >
        <Hash
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-[color:var(--ink)]" : "text-muted-foreground group-hover:text-foreground"
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{channel.name}</span>
        {channel.unreadCount > 0 && (
          <Badge className="bg-emerald-500 px-1.5 py-0 text-[10px] text-white hover:bg-emerald-500">
            {channel.unreadCount > 9 ? "9+" : channel.unreadCount}
          </Badge>
        )}
      </button>
    </li>
  );
}

function DMListItem({
  channel,
  active,
  onClick,
}: {
  channel: ChannelRow;
  active: boolean;
  onClick: () => void;
}) {
  const name = channel.dmWith?.name ?? "Inconnu";
  const email = channel.dmWith?.email ?? "";
  const avatarUrl = channel.dmWith?.avatarUrl ?? null;
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          active
            ? "bg-[color:var(--accent)] text-foreground"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        )}
      >
        <Avatar className="h-6 w-6 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
          <AvatarFallback className="text-[10px]">
            {initials(name, email)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {channel.unreadCount > 0 && (
          <Badge className="bg-emerald-500 px-1.5 py-0 text-[10px] text-white hover:bg-emerald-500">
            {channel.unreadCount > 9 ? "9+" : channel.unreadCount}
          </Badge>
        )}
      </button>
    </li>
  );
}

function MessageItem({
  message,
  onReply,
}: {
  message: MessageRow;
  onReply: () => void;
}) {
  return (
    <div className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03]">
      <Avatar className="mt-0.5 h-8 w-8 shrink-0">
        {message.userAvatarUrl ? (
          <AvatarImage src={message.userAvatarUrl} alt={message.userName ?? "User"} />
        ) : null}
        <AvatarFallback className="text-[11px]">
          {initials(message.userName, "U")}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {message.userName ?? "Inconnu"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {fmtTime(message.createdAt)}
          </span>
        </div>
        {/* Reply preview */}
        {message.replyTo && (
          <div className="mt-0.5 flex items-center gap-1.5 rounded border-l-2 border-[color:var(--ink)]/40 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            <Reply className="h-3 w-3" />
            <span className="font-medium text-foreground">
              {message.replyTo.userName ?? "Inconnu"}
            </span>
            <span className="truncate">: {message.replyTo.body.slice(0, 100)}</span>
          </div>
        )}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
          {message.body}
        </p>
        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {message.attachments.map((a, i) => (
              <AttachmentChip key={`${a.url}-${i}`} attachment={a} />
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onReply}
        className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/5 hover:text-foreground group-hover:opacity-100"
        aria-label="Répondre"
        title="Répondre"
      >
        <Reply className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === "image") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-border"
      >
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-48 max-w-xs object-cover"
        />
      </a>
    );
  }
  if (attachment.kind === "video") {
    return (
      <video
        src={attachment.url}
        controls
        className="max-h-48 max-w-xs rounded-md border border-border"
      />
    );
  }
  if (attachment.kind === "audio") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <audio src={attachment.url} controls className="h-8" />
        <span className="text-xs text-foreground">{attachment.name}</span>
      </div>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-foreground/5"
    >
      {attachment.kind === "doc" || attachment.kind === "file" ? (
        <FileIcon className="h-4 w-4 text-[color:var(--ink)]" />
      ) : (
        <ImageIcon className="h-4 w-4 text-[color:var(--ink)]" />
      )}
      <span className="max-w-[180px] truncate text-foreground">{attachment.name}</span>
      {attachment.size ? (
        <span className="text-muted-foreground">{fmtSize(attachment.size)}</span>
      ) : null}
    </a>
  );
}

function EmptyThread() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-muted/20 px-6 text-center">
      <div className="rounded-2xl bg-[color:var(--accent)] p-5">
        <Hash className="h-7 w-7 text-[color:var(--accent-foreground)]" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">
          Choisissez un canal ou démarrez une conversation directe
        </h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Vos messages apparaîtront ici en temps réel. Les mentions notifient les
          membres, les pièces jointes s'uploadent en un clic.
        </p>
      </div>
    </div>
  );
}

function ChannelDetails({
  detail,
  channel,
  members,
  onOpenDM,
}: {
  detail: ChannelDetail | null;
  channel: ChannelRow;
  members: MemberRow[];
  onOpenDM: (userId: string) => void;
}) {
  const list = detail?.members ?? [];
  const isAgency = !!channel.agencyId;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Détails
        </p>
        {channel.type === "channel" && channel.topic && (
          <p className="mt-1 text-xs text-foreground">{channel.topic}</p>
        )}
        {channel.type === "channel" && !channel.topic && (
          <p className="mt-1 text-xs text-muted-foreground">Aucun sujet défini.</p>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          <div>
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Membres ({list.length})
            </p>
            <ul className="space-y-0.5">
              {list.map((m) => (
                <li key={m.userId}>
                  <button
                    onClick={() => onOpenDM(m.userId)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5"
                    title={`DM avec ${m.name ?? m.email}`}
                  >
                    <Avatar className="h-6 w-6">
                      {m.avatarUrl ? (
                        <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {initials(m.name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {m.name ?? m.email}
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-2 py-2 text-xs text-muted-foreground">Aucun membre.</li>
              )}
            </ul>
          </div>
          <div>
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isAgency ? "Tous les membres de l'agence" : "Tous les membres du workspace"}
            </p>
            <ul className="space-y-0.5">
              {members.map((m) => (
                <li key={m.userId}>
                  <button
                    onClick={() => onOpenDM(m.userId)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <Avatar className="h-5 w-5">
                      {m.avatarUrl ? (
                        <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} />
                      ) : null}
                      <AvatarFallback className="text-[9px]">
                        {initials(m.name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{m.name ?? m.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
