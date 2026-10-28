// Make It — POST/PATCH /api/brand/rules
// Upsert BrandRules for the active workspace. manager+ allowed.
// All 6 list columns are JSON-String on disk and parsed on read.

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
    topicsToPromote: jsonStringify(asStringArray(body.topicsToPromote)),
    topicsToAvoid: jsonStringify(asStringArray(body.topicsToAvoid)),
    wordsToUse: jsonStringify(asStringArray(body.wordsToUse)),
    wordsToAvoid: jsonStringify(asStringArray(body.wordsToAvoid)),
    claims: jsonStringify(asStringArray(body.claims)),
    ctaPreferences: jsonStringify(asStringArray(body.ctaPreferences)),
  };

  try {
    const rules = await db.brandRules.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, ...data },
      update: data,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "brand.rules.upsert",
      entity: "BrandRules",
      entityId: rules.id,
      metadata: { source: "POST /api/brand/rules" },
      ip: clientIp(req),
    });

    return ok(
      {
        rules: {
          ...rules,
          topicsToPromote: jsonParse<string[]>(rules.topicsToPromote, []),
          topicsToAvoid: jsonParse<string[]>(rules.topicsToAvoid, []),
          wordsToUse: jsonParse<string[]>(rules.wordsToUse, []),
          wordsToAvoid: jsonParse<string[]>(rules.wordsToAvoid, []),
          claims: jsonParse<string[]>(rules.claims, []),
          ctaPreferences: jsonParse<string[]>(rules.ctaPreferences, []),
        },
      },
      { upserted: true }
    );
  } catch (e) {
    return serverError("Impossible d'enregistrer les règles de marque", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const PATCH = POST;
