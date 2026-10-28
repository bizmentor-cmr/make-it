// Make It — GET/POST /api/workspaces
// GET  : list the current user's workspaces.
// POST : create a new workspace (owner membership auto-created).

import { NextRequest } from "next/server";
import { ok, unauthorized, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { listUserWorkspaces } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { createWorkspaceWithOwner } from "@/server/modules/workspaces/service";
import { PLANS, type Plan } from "@/server/core/types";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const workspaces = await listUserWorkspaces(user.id);
  return ok({ workspaces }, { count: workspaces.length });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const plan = isPlan(body.plan) ? body.plan : "free";
  if (!name || name.length < 2) return badRequest("Nom du workspace requis (2 caractères min)");

  try {
    const { workspace, membership } = await createWorkspaceWithOwner({
      ownerId: user.id,
      name,
      plan,
    });
    await audit({
      workspaceId: workspace.id,
      userId: user.id,
      action: "workspace.create",
      entity: "Workspace",
      entityId: workspace.id,
      metadata: { name: workspace.name, slug: workspace.slug, plan, via: "POST /api/workspaces" },
      ip: clientIp(req),
    });
    return ok(
      {
        workspace,
        membership,
      },
      { created: true }
    );
  } catch (e) {
    return serverError("Impossible de créer le workspace", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
