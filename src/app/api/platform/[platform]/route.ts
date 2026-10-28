// Make It — GET /api/platform/[platform]
// One platform profile (all JSON parsed). Any member.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, notFound } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { db } from "@/lib/db";
import { jsonParse, PLATFORMS } from "@/server/core/types";

type CtxParams = { params: Promise<{ platform: string }> };

export async function GET(req: NextRequest, { params }: CtxParams) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as never)) return badRequest("Plateforme inconnue", { platform });

  const p = await db.platformProfile.findUnique({ where: { platform } });
  if (!p) return notFound("Profil de plateforme introuvable");

  return ok(
    {
      id: p.id,
      platform: p.platform,
      preferredContentTypes: jsonParse<string[]>(p.preferredContentTypes, []),
      recommendedLength: p.recommendedLength,
      tone: p.tone,
      hookBehavior: p.hookBehavior,
      ctaPatterns: jsonParse<string[]>(p.ctaPatterns, []),
      hashtags: jsonParse<string[]>(p.hashtags, []),
      visualPatterns: p.visualPatterns,
      audienceBehavior: p.audienceBehavior,
      contentNorms: p.contentNorms,
      updatedAt: p.updatedAt,
    },
    { platform, workspaceId: ctx.workspaceId }
  );
}
