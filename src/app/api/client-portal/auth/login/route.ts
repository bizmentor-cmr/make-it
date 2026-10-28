// Make It — POST /api/client-portal/auth/login
// Body: { email, password }
// Returns: { token, clientUser, agencyClient, branding } on success; 401 if invalid.

import { NextRequest } from "next/server";
import { ok, unauthorized, badRequest, serverError } from "@/server/core/api-response";
import { clientLogin } from "@/server/modules/client-portal/auth";
import { audit } from "@/server/core/audit";
import { db } from "@/lib/db";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }
  const email = asString(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) return badRequest("Champ `email` requis");
  if (!password) return badRequest("Champ `password` requis");

  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;

  try {
    const result = await clientLogin(email, password);
    if (!result) {
      await audit({
        action: "client_portal.login.failed",
        metadata: { email, ip },
      });
      return unauthorized("Email ou mot de passe invalide");
    }
    // Best-effort audit log (scoped to the client's workspace).
    // NOTE: clientUser.id is a ClientUser id, not a User id — do NOT pass as `userId`.
    const ws = await db.agencyClient.findUnique({
      where: { id: result.agencyClient.id },
      select: { workspaceId: true },
    });
    await audit({
      workspaceId: ws?.workspaceId,
      action: "client_portal.login.success",
      entity: "ClientUser",
      entityId: result.clientUser.id,
      metadata: { clientUserId: result.clientUser.id, email: result.clientUser.email, ip },
    });
    return ok(
      {
        token: result.token,
        clientUser: {
          id: result.clientUser.id,
          name: result.clientUser.name,
          email: result.clientUser.email,
        },
        agencyClient: {
          id: result.agencyClient.id,
          name: result.agencyClient.name,
        },
        branding: result.branding,
      },
      { auth: "client-portal" }
    );
  } catch (e) {
    return serverError("Échec de connexion au portail client", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
