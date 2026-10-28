// Make It — GET /api/platform/[platform]/learning
// Returns the workspace's WorkspacePlatformLearning for that platform.
// If none exists, returns null with a `learning: null` data shape so the frontend
// can decide whether to compute one.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest } from "@/server/core/api-response";
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

  const learning = await db.workspacePlatformLearning.findFirst({
    where: { workspaceId: ctx.workspaceId, platform },
  });

  if (!learning) {
    return ok({ learning: null }, { platform, workspaceId: ctx.workspaceId });
  }

  return ok(
    {
      learning: {
        id: learning.id,
        platform: learning.platform,
        socialAccountId: learning.socialAccountId,
        bestFormat: learning.bestFormat,
        bestTime: learning.bestTime,
        bestTone: learning.bestTone,
        bestHashtags: jsonParse<string[]>(learning.bestHashtags, []),
        avgEngagement: learning.avgEngagement,
        samples: learning.samples,
        updatedAt: learning.updatedAt,
      },
    },
    { platform, workspaceId: ctx.workspaceId }
  );
}
