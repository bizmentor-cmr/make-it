// Make It — Client Portal auth (P4).
//
// The Client Portal is a SEPARATE auth surface from the main NextAuth
// (agency) session. Client users sign in via `/portal` with the credentials
// the agency created for them (see `agency/clients.ts:createClientUser`).
//
// On successful login we mint a JWT signed with a SEPARATE secret
// (`CLIENT_PORTAL_SECRET` — distinct from `NEXTAUTH_SECRET`) containing
// `{ clientUserId, agencyClientId, workspaceId, email, name, iat, exp }`.
// The portal frontend stores this token in `localStorage` (or as a cookie)
// and sends it as `Authorization: Bearer <token>` on every `/api/client-portal/*`
// request.
//
// `requireClientPortal(req)` is the helper used by every portal data route:
// it reads the bearer token, verifies it, and returns the resolved context
// (clientUser, agencyClient, workspace, branding) — or null (route returns 401).
//
// These JWTs CANNOT be used to access the main app routes (no `/api/workspaces`,
// `/api/brand`, etc.) — those routes still require a NextAuth session cookie.
// A client user is NOT a User in the main system.

import { NextRequest } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { db } from "@/lib/db";
import {
  verifyClientUserCredentials,
  getClientBranding,
  type ClientUserRow,
  type ClientBrandingRow,
} from "@/server/modules/agency/clients";

// ─────────────────────────── config ───────────────────────────

const CLIENT_PORTAL_SECRET =
  process.env.CLIENT_PORTAL_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "make-it-dev-client-portal-secret";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

const encoder = new TextEncoder();

function secretKey(): Uint8Array {
  return encoder.encode(CLIENT_PORTAL_SECRET);
}

// ─────────────────────────── types ───────────────────────────

export type ClientPortalTokenPayload = JWTPayload & {
  clientUserId: string;
  agencyClientId: string;
  workspaceId: string;
  email: string;
  name: string | null;
};

export type ClientPortalContext = {
  clientUser: ClientUserRow;
  agencyClient: {
    id: string;
    agencyId: string;
    workspaceId: string;
    status: string;
    name: string; // workspace name (the client's brand)
    slug: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
  branding: ClientBrandingRow;
  agency: {
    id: string;
    name: string;
    slug: string;
    whiteLabel: boolean;
  };
};

// ─────────────────────────── clientLogin ───────────────────────────

// Returns a signed JWT (string) + the public client user row + agency client
// name + branding. The frontend stores the token and uses it for subsequent
// requests.
export async function clientLogin(email: string, password: string): Promise<{
  token: string;
  clientUser: ClientUserRow;
  agencyClient: { id: string; name: string; workspaceId: string };
  branding: ClientBrandingRow;
} | null> {
  const user = await verifyClientUserCredentials(email, password);
  if (!user) return null;

  // Resolve the agency client + workspace + agency.
  const agencyClient = await db.agencyClient.findUnique({
    where: { id: user.agencyClientId },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
      agency: { select: { id: true, name: true, slug: true, settings: true } },
    },
  });
  if (!agencyClient) return null;
  // Don't allow portal access for archived clients.
  if (agencyClient.status === "archived") return null;

  const token = await new SignJWT({
    clientUserId: user.id,
    agencyClientId: user.agencyClientId,
    workspaceId: agencyClient.workspaceId,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());

  const branding = await getClientBranding(user.agencyClientId);

  return {
    token,
    clientUser: user,
    agencyClient: {
      id: agencyClient.id,
      name: agencyClient.workspace.name,
      workspaceId: agencyClient.workspaceId,
    },
    branding,
  };
}

// ─────────────────────────── verifyClientToken ───────────────────────────

// Verifies a JWT and returns the typed payload, or null if invalid/expired.
export async function verifyClientToken(token: string): Promise<ClientPortalTokenPayload | null> {
  if (!token || typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.clientUserId !== "string" ||
      typeof payload.agencyClientId !== "string" ||
      typeof payload.workspaceId !== "string"
    ) {
      return null;
    }
    return payload as ClientPortalTokenPayload;
  } catch {
    return null;
  }
}

// ─────────────────────────── getClientContext ───────────────────────────

// Resolves the full portal context (client user + agency client + workspace +
// branding + agency meta) from a verified token. Returns null if the client
// user / agency client / workspace no longer exists or has been archived.
export async function getClientContext(token: string): Promise<ClientPortalContext | null> {
  const payload = await verifyClientToken(token);
  if (!payload) return null;

  const [clientUser, agencyClient] = await Promise.all([
    db.clientUser.findUnique({ where: { id: payload.clientUserId } }),
    db.agencyClient.findUnique({
      where: { id: payload.agencyClientId },
      include: {
        workspace: { select: { id: true, name: true, slug: true, plan: true } },
        agency: { select: { id: true, name: true, slug: true, settings: true } },
      },
    }),
  ]);
  if (!clientUser || !agencyClient) return null;
  if (agencyClient.status === "archived") return null;
  if (clientUser.status !== "active") return null;
  // Defense-in-depth: ensure the workspace id matches the token.
  if (agencyClient.workspaceId !== payload.workspaceId) return null;

  const branding = await getClientBranding(agencyClient.id);

  return {
    clientUser: {
      id: clientUser.id,
      agencyClientId: clientUser.agencyClientId,
      email: clientUser.email,
      name: clientUser.name,
      status: clientUser.status as "active" | "suspended",
      lastLoginAt: clientUser.lastLoginAt ? clientUser.lastLoginAt.toISOString() : null,
      createdAt: clientUser.createdAt.toISOString(),
    },
    agencyClient: {
      id: agencyClient.id,
      agencyId: agencyClient.agencyId,
      workspaceId: agencyClient.workspaceId,
      status: agencyClient.status,
      name: agencyClient.workspace.name,
      slug: agencyClient.workspace.slug,
    },
    workspace: {
      id: agencyClient.workspace.id,
      name: agencyClient.workspace.name,
      slug: agencyClient.workspace.slug,
      plan: agencyClient.workspace.plan,
    },
    branding,
    agency: {
      id: agencyClient.agency.id,
      name: agencyClient.agency.name,
      slug: agencyClient.agency.slug,
      whiteLabel: agencyClient.agency.settings?.whiteLabel ?? false,
    },
  };
}

// ─────────────────────────── requireClientPortal ───────────────────────────

// Helper used by every `/api/client-portal/*` route. Reads the Bearer token
// from the Authorization header (or `?token=` query — fallback for the export
// PDF endpoint which opens in a new tab), verifies it, and returns the
// resolved context — or null (caller returns 401).
export async function requireClientPortal(req: NextRequest | Request): Promise<ClientPortalContext | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  let token: string | null = null;
  if (auth && /^bearer\s+/i.test(auth)) {
    token = auth.replace(/^bearer\s+/i, "").trim();
  }
  if (!token) {
    const url = new URL(req.url);
    token = url.searchParams.get("token");
  }
  if (!token) return null;
  return getClientContext(token);
}
