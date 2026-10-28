// Make It — GET /api/brand
// Returns the active workspace's full brand merged from the 4 brand tables
// (profile + identity + voice + rules). All JSON columns are parsed back
// to typed arrays/objects before being returned. Any member can read.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";
import { jsonParse } from "@/server/core/types";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const [profile, identity, voice, rules] = await Promise.all([
    db.brandProfile.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.brandIdentity.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.brandVoice.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.brandRules.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return ok({
    profile: profile
      ? {
          id: profile.id,
          workspaceId: profile.workspaceId,
          businessName: profile.businessName,
          description: profile.description,
          industry: profile.industry,
          website: profile.website,
          country: profile.country,
          language: profile.language,
          timezone: profile.timezone,
          targetMarket: profile.targetMarket,
          positioning: profile.positioning,
          valueProposition: profile.valueProposition,
          objectives: jsonParse<string[]>(profile.objectives, []),
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        }
      : null,
    identity: identity
      ? {
          id: identity.id,
          workspaceId: identity.workspaceId,
          colors: jsonParse<string[]>(identity.colors, []),
          fonts: jsonParse<string[]>(identity.fonts, []),
          logoUrl: identity.logoUrl,
          visualStyle: identity.visualStyle,
          imageryStyle: identity.imageryStyle,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        }
      : null,
    voice: voice
      ? {
          id: voice.id,
          workspaceId: voice.workspaceId,
          tone: voice.tone,
          personality: voice.personality,
          vocabulary: jsonParse<string[]>(voice.vocabulary, []),
          formality: voice.formality,
          humor: voice.humor,
          localExpressions: jsonParse<string[]>(voice.localExpressions, []),
          createdAt: voice.createdAt,
          updatedAt: voice.updatedAt,
        }
      : null,
    rules: rules
      ? {
          id: rules.id,
          workspaceId: rules.workspaceId,
          topicsToPromote: jsonParse<string[]>(rules.topicsToPromote, []),
          topicsToAvoid: jsonParse<string[]>(rules.topicsToAvoid, []),
          wordsToUse: jsonParse<string[]>(rules.wordsToUse, []),
          wordsToAvoid: jsonParse<string[]>(rules.wordsToAvoid, []),
          claims: jsonParse<string[]>(rules.claims, []),
          ctaPreferences: jsonParse<string[]>(rules.ctaPreferences, []),
          createdAt: rules.createdAt,
          updatedAt: rules.updatedAt,
        }
      : null,
  });
}
