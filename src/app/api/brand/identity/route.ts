// Make It — POST/PATCH /api/brand/identity
// Upsert BrandIdentity for the active workspace. manager+ allowed.
// JSON columns `colors` and `fonts` are stored as String arrays.

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
import { jsonParse, jsonStringify } from "@/server/core/types";
import { audit } from "@/server/core/audit";

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
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

  const data = {
    colors: jsonStringify(asStringArray(body.colors)),
    fonts: jsonStringify(asStringArray(body.fonts)),
    logoUrl: asString(body.logoUrl),
    visualStyle: asString(body.visualStyle),
    imageryStyle: asString(body.imageryStyle),
  };

  try {
    const identity = await db.brandIdentity.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, ...data },
      update: data,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "brand.identity.upsert",
      entity: "BrandIdentity",
      entityId: identity.id,
      metadata: { source: "POST /api/brand/identity" },
      ip: clientIp(req),
    });

    return ok(
      {
        identity: {
          ...identity,
          colors: jsonParse<string[]>(identity.colors, []),
          fonts: jsonParse<string[]>(identity.fonts, []),
        },
      },
      { upserted: true }
    );
  } catch (e) {
    return serverError("Impossible d'enregistrer l'identité de marque", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const PATCH = POST;
