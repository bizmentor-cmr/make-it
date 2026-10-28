// Make It — PATCH /api/admin/packs/[id]
// Update a CreditPack (admin only).

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { isAdmin, updatePack } from "@/server/modules/admin/service";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isAdmin(user.email)) return forbidden("Accès administrateur requis");
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const patch: Parameters<typeof updatePack>[1] = {};
  if (body.name !== undefined) {
    const v = asString(body.name);
    if (!v) return badRequest("Champ `name` invalide");
    patch.name = v;
  }
  if (body.credits !== undefined) {
    const v = asNum(body.credits);
    if (v === null || v <= 0) return badRequest("Champ `credits` invalide");
    patch.credits = v;
  }
  if (body.priceCents !== undefined) {
    const v = asNum(body.priceCents);
    if (v === null || v < 0) return badRequest("Champ `priceCents` invalide");
    patch.priceCents = v;
  }
  if (body.active !== undefined) {
    const v = asBool(body.active);
    if (v === null) return badRequest("Champ `active` invalide");
    patch.active = v;
  }
  if (body.popular !== undefined) {
    const v = asBool(body.popular);
    if (v === null) return badRequest("Champ `popular` invalide");
    patch.popular = v;
  }

  if (Object.keys(patch).length === 0) return badRequest("Aucun champ à mettre à jour");

  try {
    const updated = await updatePack(id, patch);
    if (!updated) return notFound("Pack introuvable");

    await audit({
      userId: user.id,
      action: "admin.pack.update",
      entity: "CreditPack",
      entityId: id,
      metadata: patch,
      ip: clientIp(req),
    });

    return ok({ pack: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalide")) return badRequest(msg);
    return serverError("Échec de la mise à jour", { error: msg });
  }
}
