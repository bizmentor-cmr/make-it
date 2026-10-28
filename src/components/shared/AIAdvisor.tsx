"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { advisorStarter, advisorSuggestions } from "@/lib/mock-data";
import { apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Send, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "assistant" | "user"; content: string };

export function AIAdvisor() {
  const { advisorOpen, setAdvisorOpen } = useAppStore();
  const [messages, setMessages] = useState<Msg[]>(advisorStarter);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message / pending change.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  if (!advisorOpen) return null;

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || pending) return;
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await apiPost<{ answer: string; consumedCredits?: number }>(
        "/api/ai/chat",
        { question: q, history }
      );
      setMessages([
        ...next,
        { role: "assistant", content: res.answer || "(réponse vide)" },
      ]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 402
          ? "Crédits insuffisants pour cette conversation."
          : e instanceof Error
          ? e.message
          : "Make It est injoignable. Réessayez.";
      setMessages([
        ...next,
        {
          role: "assistant",
          content: `Désolé, je n'ai pas pu répondre : ${msg}`,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={() => setAdvisorOpen(false)} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl animate-float-up">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--ink)] text-[color:var(--primary-foreground)]">
              <Sparkles className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
            </span>
            <div>
              <p className="text-sm font-semibold">Demander à Make It</p>
              <p className="text-xs text-muted-foreground">Votre conseiller marketing IA</p>
            </div>
          </div>
          <button
            onClick={() => setAdvisorOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto scroll-premium px-4 py-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line",
                  m.role === "user"
                    ? "bg-[color:var(--ink)] text-[color:var(--primary-foreground)]"
                    : "bg-muted text-foreground"
                )}
              >
                {m.content}
                {m.role === "assistant" && i > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="inline-flex items-center gap-1 rounded-lg bg-[color:var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--accent-foreground)] hover:opacity-90">
                      Faire maintenant <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Make It réfléchit…
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {advisorSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={pending}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Posez votre question..."
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
              disabled={pending}
            />
            <Button size="icon" onClick={() => send()} disabled={pending} className="rounded-xl">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdvisorFab() {
  const { advisorOpen, setAdvisorOpen } = useAppStore();
  if (advisorOpen) return null;
  return (
    <button
      onClick={() => setAdvisorOpen(true)}
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[color:var(--ink)] px-4 py-3 text-sm font-medium text-[color:var(--primary-foreground)] shadow-lg hover:shadow-xl transition-shadow animate-pulse-ring"
      aria-label="Ouvrir le conseiller IA"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Demander à Make It</span>
    </button>
  );
}
