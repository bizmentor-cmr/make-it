// Make It — GET/POST /api/social
// GET  : list the active workspace's social accounts (no tokens ever returned).
// POST : connect a new social account — tokens are encrypted via encrypt() before
//        storage; status defaults to "connected". manager+ allowed.

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
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { encrypt } from "@/server/core/crypto";
import { audit } from "@/server/core/audit";
import { PLATFORMS, type Platform } from "@/server/core/types";

const PLATFORM_SET = new Set<string>(PLATFORMS);

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// Public projection — never includes encrypted tokens.
function toPublicAccount(a: {
  id: string;
  platform: string;
  accountName: string | null;
  handle: string | null;
  externalAccountId: string | null;
  status: string;
  tokenExpiry: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    platform: a.platform,
    accountName: a.accountName,
    handle: a.handle,
    externalAccountId: a.externalAccountId,
    status: a.status,
    tokenExpiry: a.tokenExpiry,
    createdAt: a.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const accounts = await db.socialAccount.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
  });

  return ok(
    {
      accounts: accounts.map(toPublicAccount),
    },
    {
      count: accounts.length,
      workspaceId: ctx.workspaceId,
    }
  );
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "manager")) return forbidden("Rôle insuffisant");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const platformRaw = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (!PLATFORM_SET.has(platformRaw)) {
    return badRequest("Plateforme invalide", { platform: platformRaw });
  }
  const platform = platformRaw as Platform;

  const accountName = asString(body.accountName);
  const handle = asString(body.handle);
  const externalAccountId = asString(body.externalAccountId);

  if (!accountName && !handle && !externalAccountId) {
    return badRequest("Au moins un identifiant requis (accountName, handle ou externalAccountId)");
  }

  const accessToken = asString(body.accessToken);
  const refreshToken = asString(body.refreshToken);

  const data = {
    workspaceId: ctx.workspaceId,
    platform,
    externalAccountId,
    accountName,
    handle,
    encryptedAccessToken: accessToken ? encrypt(accessToken) : null,
    encryptedRefreshToken: refreshToken ? encrypt(refreshToken) : null,
    status: "connected",
  };

  try {
    // Upsert by the unique constraint (workspaceId, platform, externalAccountId).
    // When externalAccountId is null Prisma cannot use the compound unique key — fall
    // back to findFirst + create.
    let account;
    if (externalAccountId) {
      account = await db.socialAccount.upsert({
        where: {
          workspaceId_platform_externalAccountId: {
            workspaceId: ctx.workspaceId,
            platform,
            externalAccountId,
          },
        },
        create: data,
        update: {
          accountName: data.accountName,
          handle: data.handle,
          encryptedAccessToken: data.encryptedAccessToken,
          encryptedRefreshToken: data.encryptedRefreshToken,
          status: "connected",
        },
      });
    } else {
      const existing = await db.socialAccount.findFirst({
        where: { workspaceId: ctx.workspaceId, platform, handle: handle ?? null },
      });
      if (existing) {
        account = await db.socialAccount.update({
          where: { id: existing.id },
          data: {
            accountName: data.accountName,
            handle: data.handle,
            encryptedAccessToken: data.encryptedAccessToken,
            encryptedRefreshToken: data.encryptedRefreshToken,
            status: "connected",
          },
        });
      } else {
        account = await db.socialAccount.create({ data });
      }
    }

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "social.connect",
      entity: "SocialAccount",
      entityId: account.id,
      metadata: { platform, handle, externalAccountId },
      ip: clientIp(req),
    });

    return ok(
      {
        account: toPublicAccount(account),
      },
      { connected: true }
    );
  } catch (e) {
    return serverError("Impossible de connecter le compte social", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
