// Make It — GET / POST /api/automations
// GET  : list automations (any member).
// POST : create (manager+). Validates name, trigger, action + JSON condition + actionConfig.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  listAutomations,
  createAutomation,
  type AutomationInput,
} from "@/server/modules/automations/engine";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function asObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  try {
    const automations = await listAutomations(ctx.workspaceId);
    return ok({ automations }, { count: automations.length, workspaceId: ctx.workspaceId });
  } catch (e) {
    return serverError("Échec de lecture des automatisations", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = asString(body.name);
  if (!name) return badRequest("Champ `name` requis");
  const trigger = asString(body.trigger);
  if (!trigger) return badRequest("Champ `trigger` requis");
  const action = asString(body.action);
  if (!action) return badRequest("Champ `action` requis");

  const input: AutomationInput = {
    name,
    trigger,
    action,
    condition: asObject(body.condition),
    actionConfig: asObject(body.actionConfig),
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
  };

  try {
    const automation = await createAutomation(ctx.workspaceId, input);
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "automation.create",
      entity: "Automation",
      entityId: automation.id,
      metadata: { name, trigger, action, enabled: input.enabled },
      ip: clientIp(req),
    });
    return ok({ automation }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide") || msg.includes("requis")) return badRequest(msg);
    return serverError("Échec de la création", { error: msg });
  }
}
