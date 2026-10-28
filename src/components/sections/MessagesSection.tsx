"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  RefreshCw,
  Zap,
  ScanSearch,
  ArrowUpNarrowWide,
  Smartphone,
  Search,
  CornerDownLeft,
} from "lucide-react";

import { SectionHeader } from "@/components/shared/SectionHeader";
import { PlatformDot } from "@/components/shared/PlatformBadge";
import { AIBadge, MakeItMark } from "@/components/shared/AIBadge";
import { RecommendationCard } from "@/components/shared/RecommendationCard";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  messageThreads as mockThreads,
  type MessageThread,
  type Platform,
} from "@/lib/mock-data";
import { apiGet, apiPost, apiTry } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";

/* ------------------------------------------------------------------ */
/*  Intent metadata                                                    */
/* ------------------------------------------------------------------ */

type Intent = MessageThread["intent"];

const INTENT_META: Record<
  Intent,
  {
    label: string;
    chip: string;
    dot: string;
    banner: string;
    detection: string;
    reply: string;
    alt: string;
    confidence: number;
    icon: string;
  }
> = {
  purchase: {
    label: "Achat",
    chip: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
    banner: "bg-emerald-50 border-emerald-200 text-emerald-900",
    detection:
      "Intention d'achat. Recommandation : proposez le pack premium + lien WhatsApp.",
    reply:
      "Bonjour, oui la promo est valable en boutique jusqu'à dimanche. Souhaitez-vous que je vous réserve le pack premium ? 🙌",
    alt:
      "Bonjour 🙌 La promo est valable en boutique jusqu'à dimanche. Je peux vous bloquer le pack premium dès maintenant, souhaitez-vous ?",
    confidence: 92,
    icon: "🛍️",
  },
  question: {
    label: "Question",
    chip: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
    banner: "bg-amber-50 border-amber-200 text-amber-900",
    detection:
      "Intention : question. Recommandation : précisez le prix, la disponibilité et ajoutez un CTA WhatsApp.",
    reply:
      "Bonjour 👋 Le prix affiché est bien à jour, et la livraison est offerte dès 50 €. Souhaitez-vous que je vous envoie le lien direct ?",
    alt:
      "Bonjour 🙌 Oui le prix est à jour. Disponible en plusieurs tailles, livraison offerte dès 50€. Je vous envoie le lien ?",
    confidence: 78,
    icon: "❓",
  },
  support: {
    label: "Support",
    chip: "bg-rose-100 text-rose-800",
    dot: "bg-rose-500",
    banner: "bg-rose-50 border-rose-200 text-rose-900",
    detection:
      "Intention : support. Recommandation : proposez une résolution immédiate et confirmez par e-mail.",
    reply:
      "Bonjour, désolé pour ce souci 🙏 Pouvez-vous me confirmer l'adresse e-mail de la commande ? Je relance le paiement immédiatement.",
    alt:
      "Bonjour 🙏 Désolé pour la gêne. Confirmez-moi votre e-mail de commande, je règle ça sous 24 h et je vous offre -10%.",
    confidence: 85,
    icon: "🛠️",
  },
  praise: {
    label: "Éloge",
    chip: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
    banner: "bg-emerald-50 border-emerald-200 text-emerald-900",
    detection:
      "Intention : éloge. Recommandation : remerciez et invitez à taguer la marque pour du contenu partagé.",
    reply:
      "Merci infiniment 🙌 Ça nous touche énormément. N'hésitez pas à taguer @atelierlumiere sur vos créations, on les repartage avec plaisir !",
    alt:
      "Merci du fond du cœur 💚 On adore ce retour. Taguez @atelierlumiere sur vos créations, on les repartage avec plaisir !",
    confidence: 88,
    icon: "💚",
  },
  spam: {
    label: "Spam",
    chip: "bg-zinc-100 text-zinc-700",
    dot: "bg-zinc-500",
    banner: "bg-zinc-50 border-zinc-200 text-zinc-700",
    detection:
      "Intention : spam. Recommandation : ne pas répondre, masquer et bloquer le contact.",
    reply:
      "Bonjour, merci pour votre message. Nous ne proposons pas ce type de service. Au revoir.",
    alt:
      "Bonjour, nous ne sommes pas intéressés. Merci de ne plus nous contacter.",
    confidence: 96,
    icon: "🚫",
  },
};

/* ------------------------------------------------------------------ */
/*  Mock conversation per intent                                       */
/* ------------------------------------------------------------------ */

type Msg = { from: "them" | "me"; text: string; time: string };

function getConversation(thread: MessageThread): Msg[] {
  const first = thread.name.split(" ")[0];
  switch (thread.intent) {
    case "purchase":
      return [
        { from: "them", text: "Bonjour, est-ce que la promo est valable en boutique ?", time: "14:32" },
        { from: "me", text: `Bonjour ${first} 👋 Oui, la promo est valable en boutique jusqu'à dimanche.`, time: "14:35" },
        { from: "them", text: "Super, je peux réserver le pack premium ?", time: "14:36" },
        { from: "me", text: "Avec plaisir. Je vous l'ajoute et je vous envoie le lien WhatsApp pour le retrait 🙌", time: "14:38" },
        { from: "them", text: "Parfait, merci !", time: "14:39" },
        { from: "me", text: "À très vite ✨", time: "14:40" },
      ];
    case "question":
      return [
        { from: "them", text: "Le prix indiqué est-il à jour ?", time: "12:10" },
        { from: "me", text: `Bonjour ${first} 👋 Oui, le prix affiché est bien à jour.`, time: "12:15" },
        { from: "them", text: "Et la disponibilité ?", time: "12:16" },
        { from: "me", text: "Disponible en plusieurs tailles, livraison offerte dès 50 €.", time: "12:18" },
      ];
    case "support":
      return [
        { from: "them", text: "Je n'arrive pas à finaliser ma commande 😞", time: "10:24" },
        { from: "me", text: `Bonjour ${first}, désolé pour ce souci 🙏 Quelle étape bloque exactement ?`, time: "10:28" },
        { from: "them", text: "Le paiement est refusé.", time: "10:29" },
        { from: "me", text: "Pouvez-vous me confirmer l'adresse e-mail de la commande ? Je relance le paiement immédiatement.", time: "10:30" },
        { from: "them", text: "Merci, je vous envoie ça.", time: "10:31" },
      ];
    case "praise":
      return [
        { from: "them", text: "Votre tuto est génial, je l'ai partagé ! 🙌", time: "Hier à 19:04" },
        { from: "me", text: `Merci infiniment ${first} 💚 Ça nous touche énormément.`, time: "Hier à 19:12" },
        { from: "them", text: "Je vais en faire d'autres !", time: "Hier à 19:15" },
        { from: "me", text: "Taguez @atelierlumiere, on les repartage avec plaisir ✨", time: "Hier à 19:18" },
      ];
    case "spam":
      return [
        { from: "them", text: "Boost your account with us 🔥", time: "Hier" },
        { from: "them", text: "Send us a DM to grow fast 📈", time: "Hier" },
      ];
  }
}

/* ------------------------------------------------------------------ */
/*  Small subcomponents                                                */
/* ------------------------------------------------------------------ */

function Avatar({ thread, className }: { thread: MessageThread; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white shadow-inner",
        thread.avatarColor,
        className
      )}
    >
      {thread.name.charAt(0).toUpperCase()}
    </span>
  );
}

function IntentChip({ intent, size = "sm" }: { intent: Intent; size?: "sm" | "md" }) {
  const m = INTENT_META[intent];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        m.chip
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all min-h-[44px]",
        active
          ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] shadow-sm"
          : "bg-foreground/5 text-foreground hover:bg-foreground/10"
      )}
    >
      {children}
    </button>
  );
}

function QuickActionButton({
  onClick,
  icon: Icon,
  label,
  tone = "soft",
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "soft" | "accent";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all",
        tone === "accent"
          ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:opacity-90"
          : "bg-foreground/5 text-foreground hover:bg-foreground/10"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function MessageBubble({ message }: { message: Msg }) {
  const mine = message.from === "me";
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] space-y-1")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed text-pretty shadow-sm",
            mine
              ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)] rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm"
          )}
        >
          {message.text}
        </div>
        <p
          className={cn(
            "text-[10px] text-muted-foreground tabular-nums",
            mine ? "text-right pr-1" : "pl-1"
          )}
        >
          {message.time}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Conversation pane (used by desktop middle + mobile sheet)         */
/* ------------------------------------------------------------------ */

function ConversationPane({
  thread,
  messages,
  draft,
  setDraft,
  onSuggest,
  onReformulate,
  onAutomate,
  onSend,
}: {
  thread: MessageThread;
  messages: Msg[];
  draft: string;
  setDraft: (v: string) => void;
  onSuggest: () => void;
  onReformulate: () => void;
  onAutomate: () => void;
  onSend: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = INTENT_META[thread.intent];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, thread.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border p-3 sm:p-4">
        <Avatar thread={thread} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{thread.name}</p>
            <PlatformDot platform={thread.platform} className="h-5 w-5 text-[10px]" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {thread.handle} · {thread.time}
          </p>
        </div>
        <IntentChip intent={thread.intent} />
        <Button
          onClick={onSuggest}
          className="h-11 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">Répondre avec l'IA</span>
          <span className="sm:hidden">IA</span>
        </Button>
      </header>

      {/* Intent detection banner */}
      <div
        className={cn(
          "flex items-start gap-2.5 border-b px-4 py-3 text-xs sm:text-sm",
          meta.banner
        )}
      >
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/60">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="text-pretty leading-relaxed">
          <span className="font-semibold">Make It a détecté :</span>{" "}
          {meta.detection}
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto scroll-premium p-4"
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-card/50 p-3 space-y-2.5">
        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <QuickActionButton
            onClick={onSuggest}
            icon={Sparkles}
            label="Répondre avec l'IA"
            tone="accent"
          />
          <QuickActionButton
            onClick={onReformulate}
            icon={RefreshCw}
            label="Reformuler"
          />
          <QuickActionButton
            onClick={onAutomate}
            icon={Zap}
            label="Automatiser"
          />
        </div>
        {/* Textarea + Send */}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Écrivez votre réponse…"
            rows={2}
            className="min-h-[44px] flex-1 resize-none bg-card"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <Button
            onClick={onSend}
            disabled={!draft.trim()}
            className="h-11 shrink-0 bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Envoyer</span>
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" />
          Cmd / Ctrl + Entrée pour envoyer
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Right pane — Aide Make It                                          */
/* ------------------------------------------------------------------ */

function RightPane({ thread }: { thread: MessageThread }) {
  const meta = INTENT_META[thread.intent];
  const setAdvisorOpen = useAppStore((s) => s.setAdvisorOpen);
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <MakeItMark />
          <AIBadge label="Aide" />
        </div>

        {/* Intent summary */}
        <div className="surface-soft p-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Intention détectée
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xl">{meta.icon}</span>
            <span className="text-base font-semibold text-foreground">
              {meta.label}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              Confiance {meta.confidence}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${meta.confidence}%` }}
            />
          </div>
        </div>

        {/* Suggested reply (editable-looking) */}
        <div className="surface-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Brouillon suggéré
            </p>
            <AIBadge label="IA" />
          </div>
          <p className="text-sm text-foreground text-pretty leading-relaxed">
            {meta.reply}
          </p>
          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Modifiable avant envoi
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={() =>
              toast.success("Intention réanalysée", {
                description: `Confiance mise à jour : ${meta.confidence}%`,
              })
            }
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground/5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
          >
            <ScanSearch className="h-4 w-4" />
            Détecter l'intention
          </button>
          <button
            onClick={() =>
              toast.success("Conversation remontée en haut de la file")
            }
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground/5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
          >
            <ArrowUpNarrowWide className="h-4 w-4" />
            Prioriser
          </button>
          <button
            onClick={() =>
              toast.success("Règle d'automatisation créée", {
                description: "Les futures intentions similaires seront gérées automatiquement.",
              })
            }
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground/5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
          >
            <Zap className="h-4 w-4" />
            Automatiser
          </button>
        </div>

        {/* Conversion insight */}
        <div className="surface-accent p-3 flex items-start gap-2.5">
          <span className="text-base">🌱</span>
          <p className="text-xs leading-relaxed text-[color:var(--accent-foreground)] text-pretty">
            Ce contact a déjà échangé 3 fois — bon potentiel de conversion.
          </p>
        </div>

        {/* Recommendation card */}
        <RecommendationCard
          icon={<Smartphone className="h-4 w-4" />}
          tone="emerald"
          title="Ce lead semble chaud. Passez en WhatsApp Business pour confirmer."
          reason="Make It détecte 3 échanges récents et une intention d'achat forte. Une réponse directe sur WhatsApp augmente vos chances de conversion de 40%."
          cta="Ouvrir WhatsApp"
          onCta={() =>
            toast.success("WhatsApp Business ouvert", {
              description: "Conversation transférée vers WhatsApp.",
            })
          }
        />

        {/* Advisor CTA */}
        <button
          onClick={() => setAdvisorOpen(true)}
          className="flex w-full items-center justify-between rounded-lg border border-dashed border-border p-3 text-left transition-colors hover:bg-foreground/5"
        >
          <span className="text-xs text-muted-foreground">
            Besoin d'aide pour répondre ?
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
            Demander à Make It
            <Sparkles className="h-3 w-3" />
          </span>
        </button>
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  Main section                                                       */
/* ------------------------------------------------------------------ */

const PLATFORM_FILTERS: { key: "all" | Platform; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "tiktok", label: "TikTok" },
];

const INTENT_FILTERS: { key: "all" | Intent; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "purchase", label: "Achats" },
  { key: "question", label: "Questions" },
  { key: "support", label: "Support" },
  { key: "praise", label: "Éloges" },
  { key: "spam", label: "Spam" },
];

const PRIORITY_ORDER: Record<Intent, number> = {
  purchase: 0,
  question: 1,
  praise: 2,
  support: 3,
  spam: 4,
};

export function MessagesSection() {
  const [threads, setThreads] = useState<MessageThread[]>(mockThreads);
  const [selectedId, setSelectedId] = useState<string>(mockThreads[0]?.id ?? "");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const [intentFilter, setIntentFilter] = useState<"all" | Intent>("all");
  const [prioritize, setPrioritize] = useState(false);
  const [draft, setDraft] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [conversations, setConversations] = useState<Record<string, Msg[]>>({});
  const [aiBusy, setAiBusy] = useState(false);

  // Fetch the inbox list whenever prioritize changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await apiTry(async () => {
        const res = await apiGet<{
          conversations: {
            id: string;
            platform: string;
            participantName: string | null;
            participantHandle: string | null;
            intent?: string | null;
            sentiment?: string | null;
            priority?: string | null;
            unreadCount?: number;
            lastMessageAt?: string | null;
            lastMessagePreview?: string | null;
          }[];
        }>(`/api/inbox?prioritize=${prioritize ? "1" : "0"}`);
        return (res.conversations ?? []).map((c): MessageThread => ({
          id: c.id,
          name: c.participantName ?? c.participantHandle ?? "Conversation",
          handle: c.participantHandle ?? "",
          platform: (c.platform ?? "instagram") as Platform,
          preview: c.lastMessagePreview ?? "",
          time: c.lastMessageAt ? relativeTime(c.lastMessageAt) : "",
          unread: (c.unreadCount ?? 0) > 0,
          intent: (c.intent ?? "question") as Intent,
          avatarColor: avatarColorFor(c.id, c.platform ?? "instagram"),
        }));
      }, mockThreads);
      if (cancelled) return;
      if (list.length > 0) {
        setThreads(list);
        // If the previously selected thread no longer exists, pick the first.
        if (!list.some((t) => t.id === selectedId)) {
          setSelectedId(list[0].id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, [prioritize]);

  // Fetch the conversation messages whenever the selected id changes.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      // Skip if we already have messages for this conversation (the send path
      // populates this state).
      if (conversations[selectedId]) return;
      const conv = await apiTry(async () => {
        const res = await apiGet<{
          conversation: {
            id: string;
            messages?: {
              id: string;
              body: string;
              direction: string;
              createdAt: string;
            }[];
          };
        }>(`/api/inbox/${selectedId}`);
        return res.conversation;
      }, null);
      if (cancelled || !conv?.messages) return;
      const msgs: Msg[] = conv.messages.map((m) => ({
        from: m.direction === "outbound" ? "me" : "them",
        text: m.body,
        time: relativeTime(m.createdAt),
      }));
      setConversations((prev) => ({ ...prev, [selectedId]: msgs }));
    })();
    return () => {
      cancelled = true;
    };
     
  }, [selectedId]);

  const filteredThreads = useMemo(() => {
    let list = threads.filter(
      (t) =>
        (platformFilter === "all" || t.platform === platformFilter) &&
        (intentFilter === "all" || t.intent === intentFilter)
    );
    if (prioritize) {
      list = [...list].sort(
        (a, b) => PRIORITY_ORDER[a.intent] - PRIORITY_ORDER[b.intent]
      );
    }
    return list;
  }, [threads, platformFilter, intentFilter, prioritize]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  );

  const currentMessages = useMemo(() => {
    if (!selected) return [] as Msg[];
    return conversations[selected.id] ?? getConversation(selected);
  }, [selected, conversations]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setDraft("");
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileOpen(true);
    }
  };

  const handleSuggest = async () => {
    if (!selected || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await apiPost<{
        suggestedReply?: string;
        intent?: string;
        confidence?: number;
      }>(`/api/inbox/${selected.id}/ai-reply`, {});
      if (res.suggestedReply) {
        setDraft(res.suggestedReply);
        toast.success("Réponse suggérée", {
          description: `Make It a préparé un brouillon (intention : ${res.intent ?? "—"}).`,
        });
      } else {
        setDraft(INTENT_META[selected.intent].reply);
        toast.success("Réponse suggérée (locale)");
      }
    } catch (e) {
      setDraft(INTENT_META[selected.intent].reply);
      toast.error("Réponse IA indisponible", {
        description: e instanceof Error ? e.message : "Brouillon local chargé.",
      });
    } finally {
      setAiBusy(false);
    }
  };

  const handleReformulate = () => {
    if (!selected) return;
    setDraft(INTENT_META[selected.intent].alt);
    toast.success("Reformulation proposée");
  };

  const handleAutomate = () => {
    if (!selected) return;
    toast.success("Règle d'automatisation créée", {
      description:
        "Les futures conversations similaires seront traitées automatiquement.",
    });
  };

  const handleSend = async () => {
    if (!draft.trim() || !selected) return;
    const text = draft.trim();
    const newMsg: Msg = { from: "me", text, time: "À l'instant" };
    setConversations((prev) => ({
      ...prev,
      [selected.id]: [
        ...(prev[selected.id] ?? getConversation(selected)),
        newMsg,
      ],
    }));
    setDraft("");
    toast.success("Message envoyé");
    try {
      await apiPost(`/api/inbox/${selected.id}/messages`, { body: text });
    } catch (e) {
      toast.error("Échec de l'envoi", {
        description: e instanceof Error ? e.message : "Réessayez plus tard.",
      });
    }
  };

  const unreadCount = threads.filter((t) => t.unread).length;

  return (
    <div className="space-y-5">
      {/* 1. Section header */}
      <SectionHeader
        eyebrow="Inbox"
        title="Messages"
        description="Toutes vos interactions marketing, centralisées. Make It détecte l'intention et propose les réponses."
        actions={<AIBadge label="Réponse IA" />}
      />

      {/* 2. Top filter bar */}
      <div className="surface-soft p-3 sm:p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Platform filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plateforme
            </span>
            {PLATFORM_FILTERS.map((p) => (
              <FilterChip
                key={p.key}
                active={platformFilter === p.key}
                onClick={() => setPlatformFilter(p.key)}
              >
                {p.label}
              </FilterChip>
            ))}
          </div>

          {/* Prioritize switch */}
          <div className="flex items-center gap-2.5 rounded-full bg-card px-3.5 py-2 border border-border">
            <Sparkles className="h-4 w-4 text-[color:var(--accent-foreground)]" />
            <span className="text-sm font-medium text-foreground">
              Prioriser avec l'IA
            </span>
            <Switch checked={prioritize} onCheckedChange={setPrioritize} />
          </div>
        </div>

        {/* Intent filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Intention
          </span>
          {INTENT_FILTERS.map((it) => (
            <FilterChip
              key={it.key}
              active={intentFilter === it.key}
              onClick={() => setIntentFilter(it.key)}
            >
              {it.key !== "all" && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    INTENT_META[it.key as Intent].dot
                  )}
                />
              )}
              {it.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* 3. 3-pane layout (desktop) / list (mobile) */}
      <div className="grid h-[78vh] min-h-[500px] gap-4 lg:h-[calc(100vh-310px)] lg:min-h-[580px] lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        {/* LEFT — thread list */}
        <div className="surface-card flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-border p-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Conversations
              </h2>
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {unreadCount} non lues
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {threads.length} conversations
            </span>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <ul className="divide-y divide-border">
              {threads.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  Aucune conversation ne correspond à ce filtre.
                </li>
              )}
              {threads.map((t) => {
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => handleSelect(t.id)}
                      className={cn(
                        "flex w-full items-start gap-3 p-3 text-left transition-colors",
                        active
                          ? "surface-accent"
                          : "hover:bg-foreground/[0.03]"
                      )}
                    >
                      <Avatar thread={t} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-sm",
                              t.unread
                                ? "font-semibold text-foreground"
                                : "font-medium text-foreground/90"
                            )}
                          >
                            {t.name}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {t.time}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <PlatformDot
                            platform={t.platform}
                            className="h-4 w-4 text-[9px]"
                          />
                          <span className="truncate text-xs text-muted-foreground">
                            {t.handle}
                          </span>
                          {t.unread && (
                            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
                          )}
                        </div>
                        <p
                          className={cn(
                            "mt-1 truncate text-xs",
                            t.unread
                              ? "font-medium text-foreground/80"
                              : "text-muted-foreground"
                          )}
                        >
                          {t.preview}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <IntentChip intent={t.intent} />
                          {t.unread && (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">
                              Nouveau
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>

        {/* MIDDLE — conversation (desktop only) */}
        <div className="hidden min-h-0 flex-col overflow-hidden surface-card lg:flex">
          {selected ? (
            <ConversationPane
              thread={selected}
              messages={currentMessages}
              draft={draft}
              setDraft={setDraft}
              onSuggest={handleSuggest}
              onReformulate={handleReformulate}
              onAutomate={handleAutomate}
              onSend={handleSend}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
              <Search className="h-8 w-8" />
              <p className="text-sm">Sélectionnez une conversation à gauche.</p>
            </div>
          )}
        </div>

        {/* RIGHT — Aide Make It (desktop only) */}
        <div className="hidden min-h-0 flex-col overflow-hidden surface-card lg:flex">
          {selected ? (
            <RightPane thread={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
              <p className="text-sm">L'aide Make It apparaîtra ici.</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile conversation sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border p-3">
            <SheetTitle className="text-sm">Conversation</SheetTitle>
            <SheetDescription className="text-xs">
              Répondez depuis votre mobile.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            {selected && (
              <ConversationPane
                thread={selected}
                messages={currentMessages}
                draft={draft}
                setDraft={setDraft}
                onSuggest={handleSuggest}
                onReformulate={handleReformulate}
                onAutomate={handleAutomate}
                onSend={handleSend}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers (API mapping)                                             */
/* ------------------------------------------------------------------ */

const AVATAR_GRADIENTS = [
  "from-rose-300 to-amber-300",
  "from-emerald-300 to-teal-300",
  "from-violet-300 to-rose-300",
  "from-amber-300 to-rose-300",
  "from-teal-300 to-emerald-300",
  "from-zinc-300 to-zinc-400",
];

function avatarColorFor(id: string, _platform: string): string {
  // Deterministic pick from the set of mock gradients.
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "À l'instant";
  if (diff < 3_600_000) return `Il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Il y a ${Math.floor(diff / 3_600_000)} h`;
  return `Il y a ${Math.floor(diff / 86_400_000)} j`;
}
