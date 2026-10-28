// Make It — POST/PATCH /api/brand/profile
// Upsert BrandProfile for the active workspace. manager+ allowed.
// JSON column `objectives` is stored as String and parsed back on read.

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

  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  if (!businessName) return badRequest("businessName requis");

  const objectives = Array.isArray(body.objectives)
    ? body.objectives.filter((o): o is string => typeof o === "string")
    : [];

  const data = {
    businessName,
    description: asString(body.description),
    industry: asString(body.industry),
    website: asString(body.website),
    country: asString(body.country),
    language: asString(body.language) ?? "fr",
    timezone: asString(body.timezone) ?? "Africa/Douala",
    targetMarket: asString(body.targetMarket),
    positioning: asString(body.positioning),
    valueProposition: asString(body.valueProposition),
    objectives: jsonStringify(objectives),
  };

  try {
    const profile = await db.brandProfile.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, ...data },
      update: data,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "brand.profile.upsert",
      entity: "BrandProfile",
      entityId: profile.id,
      metadata: { businessName, source: "POST /api/brand/profile" },
      ip: clientIp(req),
    });

    return ok(
      {
        profile: {
          ...profile,
          objectives: jsonParse<string[]>(profile.objectives, []),
        },
      },
      { upserted: true }
    );
  } catch (e) {
    return serverError("Impossible d'enregistrer le profil de marque", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// PATCH is the same upsert as POST.
export const PATCH = POST;
