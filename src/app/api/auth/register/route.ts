// Make It — POST /api/auth/register
// Public endpoint: create user + default workspace "Mon entreprise" + owner membership.
// Returns { user, workspaceId }.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, badRequest, serverError } from "@/server/core/api-response";
import { hashPassword } from "@/server/core/auth";
import { audit } from "@/server/core/audit";
import { createWorkspaceWithOwner } from "@/server/modules/workspaces/service";
import { processSignup } from "@/server/modules/referral/service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ref =
    typeof body.ref === "string" ? body.ref.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email)) return badRequest("Email invalide", { email });
  if (!name || name.length < 2) return badRequest("Nom requis (2 caractères min)");
  if (password.length < 6) return badRequest("Mot de passe trop court (6 caractères min)");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return badRequest("Un compte existe déjà avec cet email", { email });

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash,
      locale: "fr",
      timezone: "Africa/Douala",
    },
  });

  const { workspace } = await createWorkspaceWithOwner({
    ownerId: user.id,
    name: "Mon entreprise",
    plan: "free",
  });

  await audit({
    userId: user.id,
    action: "auth.register",
    entity: "User",
    entityId: user.id,
    metadata: { email, name, workspaceId: workspace.id, ref: ref || null },
    ip: clientIp(req),
  });

  // Referral signup reward — non-blocking. If the visitor came in via a
  // /ref/{code} link (passed in the `ref` body field), we create a Referral
  // row (status=signed_up) and grant 30 credits to the referrer. Any error
  // is logged but never bubbles — the registration itself already succeeded.
  if (ref) {
    try {
      await processSignup({
        refCode: ref,
        email,
        newUserId: user.id,
        ip: clientIp(req) ?? null,
      });
    } catch (e) {
      console.error("[referral] processSignup failed", e);
    }
  }

  return ok(
    {
      user: { id: user.id, email: user.email, name: user.name },
      workspaceId: workspace.id,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        plan: workspace.plan,
      },
    },
    { registered: true }
  );
}
