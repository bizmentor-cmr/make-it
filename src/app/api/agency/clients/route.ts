// Make It — GET/POST /api/agency/clients
// GET  : list the agency's clients (active + archived) with Make It Score +
//        status + manager. Visible to all agency members (creatives see only
//        assigned clients — handled inside the service).
// POST : admin/manager creates a new agency client: creates a fresh Workspace
//        (the client's own workspace) + an AgencyClient linking it to the
//        agency + the BrandProfile with the chosen sector/country/objective +
//        a WorkspaceMember for the creator. Returns the new AgencyClient row.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveAgency, isAgencyManager } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { listAgencyClients } from "@/server/modules/agency/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// GET /api/agency/clients
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  try {
    const { clients } = await listAgencyClients(ctx.agencyId, ctx.userId);
    return ok({ clients }, {
      agencyId: ctx.agencyId,
      role: ctx.role,
      count: clients.length,
    });
  } catch (e) {
    return serverError("Échec de lecture des clients", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveAgency(req);
  if (!ctx) return forbidden("Accès agence requis");
  if (!isAgencyManager(ctx)) return forbidden("Rôle manager+ requis");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const name = asString(body.name);
  if (!name) return badRequest("Champ `name` requis");
  const sector = asString(body.sector);
  const country = asString(body.country);
  const objective = asString(body.objective);
  const platforms = asStringArr(body.platforms);
  const slugBase = slugify(name) || `client-${Date.now()}`;

  try {
    // Ensure slug uniqueness.
    let slug = slugBase;
    let suffix = 1;
    while (await db.workspace.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${slugBase}-${suffix}`;
    }

    // Create the client workspace (owned by the agency admin).
    const workspace = await db.workspace.create({
      data: {
        name,
        slug,
        ownerId: user.id,
        plan: "starter",
      },
    });

    // Make the creator a manager of the client workspace.
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "manager",
      },
    });

    // BrandProfile (sector + country + objective).
    await db.brandProfile.create({
      data: {
        workspaceId: workspace.id,
        businessName: name,
        industry: sector,
        country,
        objectives: JSON.stringify(objective ? [objective] : []),
      },
    });

    // AgencyClient linking the workspace to the agency.
    const agencyClient = await db.agencyClient.create({
      data: {
        agencyId: ctx.agencyId,
        workspaceId: workspace.id,
        status: "active",
      },
    });

    // Assign the creator as the manager of this client.
    await db.agencyClientAccess.create({
      data: {
        agencyClientId: agencyClient.id,
        userId: user.id,
        role: "manager",
        assignedById: user.id,
      },
    });

    // Seed a workspace credit wallet so the publishing/AI engine works.
    await db.creditWallet.create({
      data: { workspaceId: workspace.id, subscriptionCredits: 0, purchasedCredits: 0 },
    });

    await audit({
      workspaceId: workspace.id,
      userId: user.id,
      action: "agency.client.create",
      entity: "AgencyClient",
      entityId: agencyClient.id,
      metadata: { agencyId: ctx.agencyId, name, slug, sector, country, objective, platforms },
      ip: clientIp(req),
    });

    // P5: Auto-create a `#client-{name}` channel at the agency level for
    // cross-team discussion about this client (best-effort).
    try {
      const { seedClientChannel } = await import("@/server/modules/messaging/service");
      void (await seedClientChannel(ctx.agencyId, name, user.id));
    } catch {
      /* ignore — never fail client creation */
    }

    return ok(
      {
        id: agencyClient.id,
        workspaceId: workspace.id,
        name,
        slug,
        status: "active",
      },
      { agencyId: ctx.agencyId },
      { status: 201 }
    );
  } catch (e) {
    return serverError("Échec de création du client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
