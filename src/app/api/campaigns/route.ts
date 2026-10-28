// Make It — GET / POST /api/campaigns
// GET  : list (filters: status, objective; paginated).
// POST : create (manager+) — name, objective, budgetCents, startDate, endDate,
//         audience (JSON), platforms (JSON). Status defaults to "draft".

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { createCampaign, listCampaigns } from "@/server/modules/campaigns/service";

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
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

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
  const status = asString(url.searchParams.get("status"));
  const objective = asString(url.searchParams.get("objective"));

  try {
    const res = await listCampaigns(ctx.workspaceId, {
      status: status ?? undefined,
      objective: objective ?? undefined,
      page,
      limit,
    });
    return ok(
      { campaigns: res.items },
      {
        page: res.page,
        limit: res.limit,
        total: res.total,
        pages: res.pages,
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return badRequest(msg);
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
  const objective = asString(body.objective);
  if (!name) return badRequest("Champ `name` requis");
  if (!objective) return badRequest("Champ `objective` requis");

  const budgetCents =
    typeof body.budgetCents === "number" && Number.isFinite(body.budgetCents) && body.budgetCents >= 0
      ? Math.floor(body.budgetCents)
      : 0;

  const startDate =
    typeof body.startDate === "string" ? new Date(body.startDate) : null;
  const endDate =
    typeof body.endDate === "string" ? new Date(body.endDate) : null;
  if (startDate && Number.isNaN(startDate.getTime())) return badRequest("Date `startDate` invalide");
  if (endDate && Number.isNaN(endDate.getTime())) return badRequest("Date `endDate` invalide");

  const platforms = Array.isArray(body.platforms)
    ? (body.platforms as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;

  const audience =
    body.audience !== undefined && body.audience !== null
      ? (body.audience as Record<string, unknown>)
      : null;

  try {
    const campaign = await createCampaign(ctx.workspaceId, {
      name,
      objective,
      budgetCents,
      startDate,
      endDate,
      audience,
      platforms,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "campaign.create",
      entity: "Campaign",
      entityId: campaign.id,
      metadata: { name, objective, budgetCents, platforms },
      ip: clientIp(req),
    });

    return ok({ campaign }, { created: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide") || msg.includes("requis")) {
      return badRequest(msg);
    }
    return serverError("Échec de la création de la campagne", { error: msg });
  }
}
