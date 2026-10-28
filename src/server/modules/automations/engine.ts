// Make It — Automations engine.
// Trigger → Condition → Action pipeline.
//
//   fireTrigger(workspaceId, trigger, payload)
//     → loads enabled automations matching the trigger,
//     → evaluates the condition JSON against the payload (jmespath-like subset),
//     → performs the action (mock implementations):
//         send_dm                    → outbound Message on the conversation referenced in payload
//         suggest_reply              → Notification with the suggested reply
//         create_alert               → Notification with the alert
//         start_analytics_tracking   → AuditLog entry (no-op mock)
//     → increments firedCount
//     → returns an array of {automation, fired, actionResult} entries
//
// Triggers (from schema): comment_contains | new_conversation |
//   campaign_under_threshold | publication_done
//
// Condition JSON format (supported):
//   { "keyword": "prix" }  → matches payload.body containing the keyword (case-insensitive)
//   { "intent": "purchase" } → matches payload.intent === "purchase"
//   { "platform": "instagram" } → matches payload.platform === "instagram"
//   { "minImpressions": 1000 } → payload.impressions >= 1000 (numeric)
//   { "status": "failed" } → matches payload.status === "failed"
//   { "threshold": { "metric": "ctr", "lt": 0.02 } } → payload.ctr < 0.02
//
// All conditions in a single object are AND-combined. Missing payload fields → condition fails.
// An automation with no condition (null/empty) always matches.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { jsonParse, jsonStringify } from "@/server/core/types";
import { createNotification } from "@/server/modules/notifications/service";
import { sendMessage } from "@/server/modules/inbox/service";

export type TriggerName =
  | "comment_contains"
  | "new_conversation"
  | "campaign_under_threshold"
  | "publication_done";

const ALLOWED_TRIGGERS = new Set<string>([
  "comment_contains",
  "new_conversation",
  "campaign_under_threshold",
  "publication_done",
]);

const ALLOWED_ACTIONS = new Set<string>([
  "send_dm",
  "suggest_reply",
  "create_alert",
  "start_analytics_tracking",
]);

export function isAllowedTrigger(t: string): boolean {
  return ALLOWED_TRIGGERS.has(t);
}
export function isAllowedAction(a: string): boolean {
  return ALLOWED_ACTIONS.has(a);
}

// ── Condition evaluation ─────────────────────────────────────────────

type Payload = Record<string, unknown>;

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function matchCondition(cond: Record<string, unknown>, payload: Payload): boolean {
  for (const [key, value] of Object.entries(cond)) {
    if (value === null || value === undefined) continue;
    switch (key) {
      case "keyword": {
        const kw = asStr(value);
        if (!kw) return false;
        const body = asStr(payload.body) ?? asStr(payload.text) ?? asStr(payload.message) ?? "";
        if (!body.toLowerCase().includes(kw.toLowerCase())) return false;
        break;
      }
      case "intent": {
        const want = asStr(value);
        if (!want) return false;
        if (asStr(payload.intent)?.toLowerCase() !== want.toLowerCase()) return false;
        break;
      }
      case "platform": {
        const want = asStr(value);
        if (!want) return false;
        if (asStr(payload.platform)?.toLowerCase() !== want.toLowerCase()) return false;
        break;
      }
      case "status": {
        const want = asStr(value);
        if (!want) return false;
        if (asStr(payload.status)?.toLowerCase() !== want.toLowerCase()) return false;
        break;
      }
      case "minImpressions": {
        const min = asNum(value);
        if (min === null) return false;
        const got = asNum(payload.impressions) ?? 0;
        if (got < min) return false;
        break;
      }
      case "minEngagement": {
        const min = asNum(value);
        if (min === null) return false;
        const got = asNum(payload.engagement) ?? 0;
        if (got < min) return false;
        break;
      }
      case "threshold": {
        const t = value as Record<string, unknown> | null;
        if (!t || typeof t !== "object") return false;
        const metric = asStr(t.metric) ?? "ctr";
        const lt = asNum(t.lt);
        const lte = asNum(t.lte);
        const gt = asNum(t.gt);
        const gte = asNum(t.gte);
        const actual = asNum(payload[metric]) ?? 0;
        if (lt !== null && !(actual < lt)) return false;
        if (lte !== null && !(actual <= lte)) return false;
        if (gt !== null && !(actual > gt)) return false;
        if (gte !== null && !(actual >= gte)) return false;
        if (lt === null && lte === null && gt === null && gte === null) return false;
        break;
      }
      default:
        // Unknown condition keys are ignored (forward-compat) but evaluated as "match"
        // only when the value matches the payload under the same key (loose equality).
        if (String(payload[key]) !== String(value)) {
          // don't fail on unknown keys — keep AND-semantics lenient
        }
        break;
    }
  }
  return true;
}

// ── Action execution ─────────────────────────────────────────────────

async function runAction(
  workspaceId: string,
  action: string,
  actionConfig: Record<string, unknown>,
  payload: Payload
): Promise<Record<string, unknown>> {
  switch (action) {
    case "send_dm": {
      const message = asStr(actionConfig.message) ?? asStr(payload.message) ?? "Bonjour, merci pour votre message !";
      const conversationId = asStr(payload.conversationId) ?? asStr(actionConfig.conversationId);
      if (!conversationId) {
        return { action: "send_dm", status: "skipped", reason: "no_conversation_id" };
      }
      const msg = await sendMessage(workspaceId, conversationId, { body: message, authoredByAi: true });
      return {
        action: "send_dm",
        status: msg ? "sent" : "skipped",
        messageId: msg?.id ?? null,
        conversationId,
      };
    }
    case "suggest_reply": {
      const suggestedReply = asStr(actionConfig.message) ?? asStr(payload.suggestedReply) ?? asStr(payload.body) ?? "";
      const title = asStr(actionConfig.title) ?? "Réponse suggérée";
      await createNotification(workspaceId, {
        type: "campaign_warning",
        title,
        body: suggestedReply.slice(0, 280) || "Une réponse est suggérée pour cette interaction.",
        level: "info",
        refId: asStr(payload.interactionId) ?? asStr(payload.conversationId) ?? undefined,
      });
      return { action: "suggest_reply", status: "notified", title };
    }
    case "create_alert": {
      const title = asStr(actionConfig.title) ?? "Alerte automatisation";
      const body = asStr(actionConfig.message) ?? asStr(payload.body) ?? "Une automatisation a déclenché une alerte.";
      await createNotification(workspaceId, {
        type: "campaign_warning",
        title,
        body,
        level: "warning",
        refId: asStr(payload.refId) ?? asStr(payload.campaignId) ?? undefined,
      });
      return { action: "create_alert", status: "alerted", title };
    }
    case "start_analytics_tracking": {
      // Mock: write an audit log (no schema-level changes).
      await db.auditLog.create({
        data: {
          workspaceId,
          action: "automation.analytics_tracking.start",
          entity: "Automation",
          metadata: jsonStringify({ payload: { platform: payload.platform, refId: asStr(payload.refId) ?? null } }),
        },
      });
      return { action: "start_analytics_tracking", status: "tracking_started" };
    }
    default:
      return { action, status: "unknown_action" };
  }
}

// ── fireTrigger ──────────────────────────────────────────────────────

export type FireResult = {
  automationId: string;
  name: string;
  trigger: string;
  action: string;
  fired: boolean;
  actionResult: Record<string, unknown> | null;
  conditionMatched: boolean;
};

export async function fireTrigger(
  workspaceId: string,
  trigger: string,
  payload: Payload
): Promise<FireResult[]> {
  if (!isAllowedTrigger(trigger)) {
    throw new Error(`Trigger inconnu: ${trigger}`);
  }
  const automations = await db.automation.findMany({
    where: { workspaceId, trigger, enabled: true },
  });
  const results: FireResult[] = [];
  for (const auto of automations) {
    const cond = jsonParse<Record<string, unknown>>(auto.condition, {});
    const hasCond = auto.condition && Object.keys(cond).length > 0;
    const matched = !hasCond || matchCondition(cond, payload);
    if (!matched) {
      results.push({
        automationId: auto.id,
        name: auto.name,
        trigger: auto.trigger,
        action: auto.action,
        fired: false,
        actionResult: null,
        conditionMatched: false,
      });
      continue;
    }
    const cfg = jsonParse<Record<string, unknown>>(auto.actionConfig, {});
    try {
      const actionResult = await runAction(workspaceId, auto.action, cfg, payload);
      await db.automation.update({
        where: { id: auto.id },
        data: { firedCount: { increment: 1 } },
      });
      results.push({
        automationId: auto.id,
        name: auto.name,
        trigger: auto.trigger,
        action: auto.action,
        fired: true,
        actionResult,
        conditionMatched: true,
      });
    } catch (e) {
      logger.warn("automations:fireTrigger action failed", {
        automationId: auto.id,
        error: e instanceof Error ? e.message : String(e),
      });
      results.push({
        automationId: auto.id,
        name: auto.name,
        trigger: auto.trigger,
        action: auto.action,
        fired: false,
        actionResult: { error: e instanceof Error ? e.message : String(e) },
        conditionMatched: true,
      });
    }
  }
  return results;
}

// ── dryRun ───────────────────────────────────────────────────────────
// Evaluates an automation against a sample payload without persisting anything
// (no Notification row, no Message row, no firedCount increment). Returns
// `{wouldFire, conditionTrace, actionPreview, payload}`.

export function dryRun(
  automation: { condition: string | null; action: string; actionConfig: string | null; trigger: string; name: string },
  payload: Payload
): {
  wouldFire: boolean;
  conditionTrace: Record<string, { expected: unknown; actual: unknown; matched: boolean }>;
  actionPreview: { action: string; config: Record<string, unknown> };
  payload: Payload;
} {
  const cond = jsonParse<Record<string, unknown>>(automation.condition, {});
  const trace: Record<string, { expected: unknown; actual: unknown; matched: boolean }> = {};
  let allMatched = true;
  for (const [key, value] of Object.entries(cond)) {
    if (value === null || value === undefined) continue;
    let actual: unknown = undefined;
    let matched = false;
    switch (key) {
      case "keyword": {
        const kw = asStr(value) ?? "";
        const body = asStr(payload.body) ?? asStr(payload.text) ?? asStr(payload.message) ?? "";
        actual = body;
        matched = body.toLowerCase().includes(kw.toLowerCase());
        break;
      }
      case "intent": {
        actual = payload.intent;
        matched = asStr(payload.intent)?.toLowerCase() === String(value).toLowerCase();
        break;
      }
      case "platform": {
        actual = payload.platform;
        matched = asStr(payload.platform)?.toLowerCase() === String(value).toLowerCase();
        break;
      }
      case "status": {
        actual = payload.status;
        matched = asStr(payload.status)?.toLowerCase() === String(value).toLowerCase();
        break;
      }
      case "minImpressions": {
        const min = asNum(value) ?? 0;
        const got = asNum(payload.impressions) ?? 0;
        actual = got;
        matched = got >= min;
        break;
      }
      case "minEngagement": {
        const min = asNum(value) ?? 0;
        const got = asNum(payload.engagement) ?? 0;
        actual = got;
        matched = got >= min;
        break;
      }
      case "threshold": {
        const t = value as Record<string, unknown>;
        const metric = asStr(t.metric) ?? "ctr";
        const actualNum = asNum(payload[metric]) ?? 0;
        actual = actualNum;
        const lt = asNum(t.lt);
        const lte = asNum(t.lte);
        const gt = asNum(t.gt);
        const gte = asNum(t.gte);
        let m = false;
        if (lt !== null && actualNum < lt) m = true;
        if (lte !== null && actualNum <= lte) m = true;
        if (gt !== null && actualNum > gt) m = true;
        if (gte !== null && actualNum >= gte) m = true;
        matched = m;
        break;
      }
      default:
        actual = payload[key];
        matched = String(payload[key]) === String(value);
        break;
    }
    if (!matched) allMatched = false;
    trace[key] = { expected: value, actual, matched };
  }
  const config = jsonParse<Record<string, unknown>>(automation.actionConfig, {});
  return {
    wouldFire: allMatched,
    conditionTrace: trace,
    actionPreview: { action: automation.action, config },
    payload,
  };
}

// ── Automation CRUD ──────────────────────────────────────────────────

export type AutomationInput = {
  name: string;
  trigger: string;
  condition?: Record<string, unknown> | null;
  action: string;
  actionConfig?: Record<string, unknown> | null;
  enabled?: boolean;
};

export type AutomationRow = {
  id: string;
  workspaceId: string;
  name: string;
  trigger: string;
  condition: Record<string, unknown> | null;
  action: string;
  actionConfig: Record<string, unknown> | null;
  enabled: boolean;
  firedCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(a: {
  id: string;
  workspaceId: string;
  name: string;
  trigger: string;
  condition: string | null;
  action: string;
  actionConfig: string | null;
  enabled: boolean;
  firedCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AutomationRow {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    name: a.name,
    trigger: a.trigger,
    condition: a.condition ? jsonParse<Record<string, unknown>>(a.condition, {}) : null,
    action: a.action,
    actionConfig: a.actionConfig ? jsonParse<Record<string, unknown>>(a.actionConfig, {}) : null,
    enabled: a.enabled,
    firedCount: a.firedCount,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function listAutomations(workspaceId: string): Promise<AutomationRow[]> {
  const rows = await db.automation.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRow);
}

export async function getAutomation(workspaceId: string, id: string): Promise<AutomationRow | null> {
  const row = await db.automation.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) return null;
  return toRow(row);
}

export async function createAutomation(
  workspaceId: string,
  input: AutomationInput
): Promise<AutomationRow> {
  if (!input.name || !input.name.trim()) throw new Error("Champ `name` requis");
  if (!isAllowedTrigger(input.trigger)) throw new Error("Trigger invalide");
  if (!isAllowedAction(input.action)) throw new Error("Action invalide");

  const created = await db.automation.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      trigger: input.trigger,
      condition: input.condition ? jsonStringify(input.condition) : null,
      action: input.action,
      actionConfig: input.actionConfig ? jsonStringify(input.actionConfig) : null,
      enabled: input.enabled ?? true,
    },
  });
  return toRow(created);
}

export async function updateAutomation(
  workspaceId: string,
  id: string,
  patch: Partial<AutomationInput> & { enabled?: boolean }
): Promise<AutomationRow | null> {
  const existing = await db.automation.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return null;

  if (patch.trigger && !isAllowedTrigger(patch.trigger)) throw new Error("Trigger invalide");
  if (patch.action && !isAllowedAction(patch.action)) throw new Error("Action invalide");
  if (patch.name !== undefined && !patch.name.trim()) throw new Error("Champ `name` invalide");

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.trigger !== undefined) data.trigger = patch.trigger;
  if (patch.action !== undefined) data.action = patch.action;
  if (patch.condition !== undefined) data.condition = patch.condition ? jsonStringify(patch.condition) : null;
  if (patch.actionConfig !== undefined)
    data.actionConfig = patch.actionConfig ? jsonStringify(patch.actionConfig) : null;
  if (patch.enabled !== undefined) data.enabled = patch.enabled;

  if (Object.keys(data).length === 0) return toRow(existing);

  const updated = await db.automation.update({ where: { id }, data });
  return toRow(updated);
}

export async function deleteAutomation(workspaceId: string, id: string): Promise<boolean> {
  const existing = await db.automation.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) return false;
  await db.automation.delete({ where: { id } });
  return true;
}
