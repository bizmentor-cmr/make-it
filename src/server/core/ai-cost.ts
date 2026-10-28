// Make It — AI cost configuration.
// Admin-configurable cost rules per operation. The orchestrator chooses the cheapest enabled rule.

import { db } from "@/lib/db";

export type CostEstimate = {
  operation: string;
  estimated: number; // credits
  ruleId: string;
};

const DEFAULT_RULES: { operation: string; baseCost: number; variableCost: number; unit: string }[] = [
  { operation: "chat", baseCost: 2, variableCost: 0.2, unit: "calls" },
  { operation: "text_generation", baseCost: 5, variableCost: 0.5, unit: "tokens" },
  { operation: "image_generation", baseCost: 80, variableCost: 0, unit: "images" },
  { operation: "image_edit", baseCost: 60, variableCost: 0, unit: "images" },
  { operation: "video_generation", baseCost: 800, variableCost: 0, unit: "calls" },
  { operation: "video_analysis", baseCost: 120, variableCost: 0, unit: "calls" },
  { operation: "style_analysis", baseCost: 100, variableCost: 0, unit: "calls" },
  { operation: "video_render", baseCost: 250, variableCost: 5, unit: "seconds" },
  { operation: "social_adaptation", baseCost: 15, variableCost: 0, unit: "calls" },
  { operation: "transcription", baseCost: 40, variableCost: 1, unit: "seconds" },
  { operation: "embedding", baseCost: 1, variableCost: 0.01, unit: "tokens" },
  { operation: "atomize", baseCost: 60, variableCost: 8, unit: "variants" },
  { operation: "calendar_generate", baseCost: 120, variableCost: 0, unit: "calls" },
  { operation: "message_analysis", baseCost: 3, variableCost: 0, unit: "messages" },
  { operation: "report", baseCost: 50, variableCost: 0, unit: "calls" },
  { operation: "insight", baseCost: 40, variableCost: 0, unit: "calls" },
  { operation: "adapt", baseCost: 15, variableCost: 0, unit: "calls" },
];

export async function ensureDefaultCostRules() {
  const count = await db.aICostRule.count();
  if (count > 0) return;
  await db.aICostRule.createMany({
    data: DEFAULT_RULES.map((r) => ({ ...r, enabled: true })),
  });
}

export async function getCostRule(operation: string) {
  await ensureDefaultCostRules();
  const rule = await db.aICostRule.findFirst({
    where: { operation, enabled: true },
    orderBy: { baseCost: "asc" },
  });
  return rule;
}

// Estimate credits for an operation given a quantity (tokens/seconds/variants).
export async function estimateCost(operation: string, quantity = 1): Promise<CostEstimate> {
  const rule = await getCostRule(operation);
  const base = rule?.baseCost ?? 10;
  const variable = rule?.variableCost ?? 0;
  const estimated = Math.max(1, Math.round(base + variable * quantity));
  return { operation, estimated, ruleId: rule?.id ?? "default" };
}
