// Make It — POST /api/ai/chat
// Synchronous AI chat (no job). Reserves + consumes ~2 credits (chat cost).
// If insufficient → 402. Uses the "chat" prompt + brand context.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { textChat } from "@/server/core/ai";
import { getPrompt, renderTemplate } from "@/server/core/prompts";
import { estimateCost } from "@/server/core/ai-cost";
import { getWallet, availableBalance, consumeCredits } from "@/server/core/credits";
import { buildBrandContext } from "@/server/modules/ai/orchestrator";
import "@/server/modules/ai/runners"; // side-effect: ensure runners registered

type ChatMsg = { role: "user" | "assistant"; content: string };

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const question = (body.question as string)?.trim();
  if (!question || question.length < 1) return badRequest("Question vide");
  const historyRaw = Array.isArray(body.history) ? (body.history as ChatMsg[]) : [];

  // Estimate cost — chat ≈ 2 credits
  const estimate = await estimateCost("chat", 1);
  const wallet = await getWallet(ctx.workspaceId);
  const available = availableBalance(wallet);
  if (available < estimate.estimated) {
    return fail("Crédits insuffisants pour cette conversation.", { code: "insufficient_credits", status: 402 });
  }

  try {
    const tpl = await getPrompt("chat", ctx.workspaceId);
    const brand = await buildBrandContext(ctx.workspaceId);
    const userContent = tpl?.userTemplate
      ? renderTemplate(tpl.userTemplate, { question, brand_context: brand, history: JSON.stringify(historyRaw.slice(-6)) })
      : `Question : ${question}\n\nContexte de la marque : ${brand}`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      ...historyRaw.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ];

    const res = await textChat({
      system: tpl?.systemPrompt ?? "Tu es Make It, le conseiller marketing IA.",
      messages,
    });
    const answer = res.content?.trim() ?? "";

    // Consume chat credits (no reservation since synchronous)
    await consumeCredits(ctx.workspaceId, estimate.estimated, estimate.estimated, "chat", `chat_${Date.now()}`);
    await audit({ workspaceId: ctx.workspaceId, userId: user.id, action: "ai.chat", entity: "AIJob", metadata: { question: question.slice(0, 200), answerLength: answer.length, cost: estimate.estimated }, ip: clientIp(req) });

    return ok({ answer, consumedCredits: estimate.estimated }, { workspaceId: ctx.workspaceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec du chat IA", { error: msg });
  }
}
