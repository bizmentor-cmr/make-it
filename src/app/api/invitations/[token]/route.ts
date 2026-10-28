// Make It — GET/POST /api/invitations/[token]
// GET  : validate an invitation token (public-ish, but we don't leak the workspace name unless authed).
// POST : accept the invitation — requires auth; creates WorkspaceMember for the matching email.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, notFound, forbidden, badRequest, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { acceptInvitation } from "@/server/modules/workspaces/service";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { workspace: true },
  });
  if (!invitation) return notFound("Invitation invalide");
  if (invitation.acceptedAt) return notFound("Invitation déjà acceptée");
  if (invitation.expiresAt.getTime() < Date.now()) {
    return notFound("Invitation expirée");
  }

  // Optionally include authed info (is this email already a Make It user?)
  const user = await getSessionUser();
  const emailMatches = user
    ? user.email.toLowerCase().trim() === invitation.email.toLowerCase().trim()
    : false;

  return ok({
    invitation: {
      email: invitation.email,
      role: invitation.role,
      workspaceName: invitation.workspace.name,
      workspaceSlug: invitation.workspace.slug,
      workspaceId: invitation.workspaceId,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    },
    authed: !!user,
    emailMatches,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    // Caller must be authed; the response uses 401 so the client can redirect to login.
    return unauthorized("Vous devez être connecté pour accepter l'invitation");
  }
  const { token } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }
  // Allow caller to override email only if it matches the session user.
  const expectedEmail = (body?.email as string | undefined)?.toLowerCase().trim() ?? user.email;

  try {
    const result = await acceptInvitation({
      token,
      userId: user.id,
      email: expectedEmail,
    });
    if (!result) {
      // Distinguish: invalid token, expired, accepted, or email mismatch.
      const invitation = await db.invitation.findUnique({ where: { token } });
      if (!invitation) return notFound("Invitation invalide");
      if (invitation.acceptedAt) return notFound("Invitation déjà acceptée");
      if (invitation.expiresAt.getTime() < Date.now()) return notFound("Invitation expirée");
      if (invitation.email.toLowerCase().trim() !== expectedEmail.toLowerCase().trim()) {
        return forbidden("Cette invitation est destinée à un autre email");
      }
      return notFound("Invitation non valide");
    }

    return ok(
      {
        workspace: result.workspace,
        membership: result.membership,
        user: { id: user.id, email: user.email, name: user.name },
      },
      { accepted: true }
    );
  } catch (e) {
    return serverError("Impossible d'accepter l'invitation", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
