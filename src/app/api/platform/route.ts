// Make It — GET /api/platform
// List all PlatformProfile rows (DNA database). Any member.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const items = await db.platformProfile.findMany({
    orderBy: { platform: "asc" },
  });

  const data = items.map((p) => ({
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
  }));

  return ok(data, { count: data.length, workspaceId: ctx.workspaceId });
}
