// Make It — GET/POST /api/agency
// GET  : returns the current user's agency (or 404 if none).
// POST : activate "Make It for Agencies" — creates Agency + wallet + settings +
//        admin membership + onboards the user's current workspace as the first
//        AgencyClient. Body: { name }.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, notFound } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import {
  activateAgency as activateAgencyService,
  getAgency as getAgencyService,
  deactivateAgency as deactivateAgencyService,
} from "@/server/modules/agency/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// GET /api/agency — current user's agency (or 404 if none).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const agency = await getAgencyService(user.id);
  if (!agency) return notFound("Mode agence non activé");
  return ok(agency, { mode: "agency" });
}

// POST /api/agency — activate agency mode.
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
  // Fall back to the user's name + " Agence" if no name provided.
  const finalName = name || (user.name ? `${user.name} — Agence` : "Mon Agence");
  if (finalName.length < 2) return badRequest("Nom de l'agence requis (2 caractères min)");

  try {
    const result = await activateAgencyService({ userId: user.id, name: finalName });
    await audit({
      userId: user.id,
      action: "agency.activate.api",
      entity: "Agency",
      entityId: result.agency.id,
      metadata: {
        name: result.agency.name,
        slug: result.agency.slug,
        via: "POST /api/agency",
        firstClientId: result.firstClientId || null,
      },
      ip: clientIp(req),
    });
    return ok(
      {
        agency: result.agency,
        role: result.role,
        firstClientId: result.firstClientId,
        firstClientName: result.firstClientName,
        activated: true,
      },
      { created: true },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NAME_REQUIRED") return badRequest("Nom de l'agence requis");
    return serverError("Impossible d'activer le mode agence", { error: msg });
  }
}

// DELETE /api/agency — deactivate agency mode (archives all clients, keeps data).
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const agency = await getAgencyService(user.id);
  if (!agency) return notFound("Mode agence non activé");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* allow empty body */
  }
  // Require explicit confirmation in the body.
  if (body.confirm !== true) {
    return badRequest("Confirmation requise", {
      hint: "Envoyer { confirm: true } pour désactiver le mode agence.",
    });
  }

  try {
    const result = await deactivateAgencyService({
      agencyId: agency.agency.id,
      userId: user.id,
    });
    await audit({
      userId: user.id,
      action: "agency.deactivate.api",
      entity: "Agency",
      entityId: agency.agency.id,
      metadata: { archivedClientCount: result.archivedClientCount },
      ip: clientIp(req),
    });
    return ok(result, { deactivated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ADMIN_ONLY") return forbidden("Réservé à l'administrateur de l'agence");
    if (msg === "NOT_AGENCY_MEMBER") return forbidden("Vous n'êtes pas membre d'une agence");
    return serverError("Impossible de désactiver le mode agence", { error: msg });
  }
}
