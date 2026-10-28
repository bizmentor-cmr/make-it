// Make It — GET / PATCH / DELETE /api/automations/[id]
// GET    : one automation (any member).
// PATCH  : update fields (manager+).
// DELETE : delete (manager+).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  getAutomation,
  updateAutomation,
  deleteAutomation,
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  const { id } = await ctx.params;

  const automation = await getAutomation(wsCtx.workspaceId, id);
  if (!automation) return notFound("Automatisation introuvable");

  return ok({ automation });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Partial<AutomationInput> & { enabled?: boolean } = {};
  if (body.name !== undefined) patch.name = asString(body.name) ?? undefined;
  if (body.trigger !== undefined) patch.trigger = asString(body.trigger) ?? undefined;
  if (body.action !== undefined) patch.action = asString(body.action) ?? undefined;
  if (body.condition !== undefined) patch.condition = asObject(body.condition);
  if (body.actionConfig !== undefined) patch.actionConfig = asObject(body.actionConfig);
  if (body.enabled !== undefined) patch.enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;

  if (Object.keys(patch).length === 0) {
    return badRequest("Aucun champ à mettre à jour");
  }

  try {
    const updated = await updateAutomation(wsCtx.workspaceId, id, patch);
    if (!updated) return notFound("Automatisation introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "automation.update",
      entity: "Automation",
      entityId: id,
      metadata: { patch },
      ip: clientIp(req),
    });

    return ok({ automation: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const wsCtx = await resolveWorkspace(req);
  if (!wsCtx) return forbidden("Aucun workspace actif");
  if (!hasRole(wsCtx, "manager")) return forbidden("Rôle insuffisant (manager+ requis)");
  const { id } = await ctx.params;

  try {
    const deleted = await deleteAutomation(wsCtx.workspaceId, id);
    if (!deleted) return notFound("Automatisation introuvable");

    await audit({
      workspaceId: wsCtx.workspaceId,
      userId: user.id,
      action: "automation.delete",
      entity: "Automation",
      entityId: id,
      ip: clientIp(req),
    });

    return ok({ deleted: true, id });
  } catch (e) {
    return serverError("Échec de la suppression", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
