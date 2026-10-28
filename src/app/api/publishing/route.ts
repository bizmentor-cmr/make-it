// Make It — GET /api/publishing
// List Publications (filterable by status, socialAccountId, contentId; paginated).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, unauthorized, forbidden, serverError } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace } from "@/server/core/rbac";

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function asString(v: string | null): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
  const status = asString(url.searchParams.get("status"));
  const socialAccountId = asString(url.searchParams.get("socialAccountId"));
  const contentId = asString(url.searchParams.get("contentId"));

  const where: { workspaceId: string; status?: string; socialAccountId?: string; contentId?: string } = {
    workspaceId: ctx.workspaceId,
  };
  if (status) where.status = status;
  if (socialAccountId) where.socialAccountId = socialAccountId;
  if (contentId) where.contentId = contentId;

  try {
    const [total, items] = await Promise.all([
      db.publication.count({ where }),
      db.publication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          socialAccount: {
            select: { id: true, platform: true, accountName: true, handle: true },
          },
          content: { select: { id: true, title: true, type: true } },
        },
      }),
    ]);

    return ok(
      {
        publications: items.map((p) => ({
          id: p.id,
          workspaceId: p.workspaceId,
          contentId: p.contentId,
          socialAccountId: p.socialAccountId,
          socialAccount: p.socialAccount,
          content: p.content,
          scheduledAt: p.scheduledAt,
          publishedAt: p.publishedAt,
          status: p.status,
          externalPostId: p.externalPostId,
          externalPermalink: p.externalPermalink,
          error: p.error,
          attempts: p.attempts,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      },
      {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Échec de lecture des publications", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
