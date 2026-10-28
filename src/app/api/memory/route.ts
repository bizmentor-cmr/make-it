// Make It — GET / POST /api/memory
// GET  : workspace's WorkspaceMemory (facts, learnings, history, JSON-parsed).
// POST : { fact?:{type, value, source}, learning?: string } → append. `manager+` only.
// Never crosses workspaces.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { getMemory, addFact, addLearning } from "@/server/modules/memory/service";

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
    const memory = await getMemory(ctx.workspaceId);
    return ok({ memory }, { workspaceId: ctx.workspaceId });
  } catch (e) {
    return serverError("Échec de lecture de la mémoire", {
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

  const factRaw = asObject(body.fact);
  const learning = asString(body.learning);
  if (!factRaw && !learning) {
    return badRequest("Champ `fact` (objet {type, value, source}) ou `learning` (string) requis");
  }

  try {
    let memory;
    if (factRaw) {
      const fact = {
        type: asString(factRaw.type) ?? "general",
        value: asString(factRaw.value) ?? "",
        source: asString(factRaw.source) ?? "manual",
      };
      if (!fact.value) return badRequest("Champ `fact.value` requis");
      memory = await addFact(ctx.workspaceId, fact);
      await audit({
        workspaceId: ctx.workspaceId,
        userId: user.id,
        action: "memory.fact.add",
        entity: "WorkspaceMemory",
        metadata: { fact },
        ip: clientIp(req),
      });
    } else if (learning) {
      memory = await addLearning(ctx.workspaceId, learning);
      await audit({
        workspaceId: ctx.workspaceId,
        userId: user.id,
        action: "memory.learning.add",
        entity: "WorkspaceMemory",
        metadata: { learning: learning.slice(0, 200) },
        ip: clientIp(req),
      });
    } else {
      return badRequest("Aucune action à effectuer");
    }
    return ok({ memory }, { updated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("requis")) return badRequest(msg);
    return serverError("Échec de la mise à jour de la mémoire", { error: msg });
  }
}
