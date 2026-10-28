// Make It — POST/PATCH /api/brand/voice
// Upsert BrandVoice for the active workspace. manager+ allowed.
// JSON columns `vocabulary` and `localExpressions` are stored as String arrays.

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
    tone: asString(body.tone),
    personality: asString(body.personality),
    vocabulary: jsonStringify(asStringArray(body.vocabulary)),
    formality: asString(body.formality),
    humor: asString(body.humor),
    localExpressions: jsonStringify(asStringArray(body.localExpressions)),
  };

  try {
    const voice = await db.brandVoice.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, ...data },
      update: data,
    });

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "brand.voice.upsert",
      entity: "BrandVoice",
      entityId: voice.id,
      metadata: { source: "POST /api/brand/voice" },
      ip: clientIp(req),
    });

    return ok(
      {
        voice: {
          ...voice,
          vocabulary: jsonParse<string[]>(voice.vocabulary, []),
          localExpressions: jsonParse<string[]>(voice.localExpressions, []),
        },
      },
      { upserted: true }
    );
  } catch (e) {
    return serverError("Impossible d'enregistrer la voix de marque", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const PATCH = POST;
