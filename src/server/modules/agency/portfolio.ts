// Make It — Agency Portfolio domain service (P3).
// `getPortfolio(agencyId, userId)` returns the per-client portfolio view:
//   - For admins: all agency clients.
//   - For managers/creatives: only clients they are assigned to (or, for managers,
//     all clients of the agency — managers can supervise multiple clients).
//
// Per-client data:
//   - Make It Score via `computeScores(workspaceId)` (reused from insights/performance.ts).
//   - Upcoming content count (status draft|ready|scheduled with scheduledAt >= now).
//   - Alerts count (failed publications, expired social tokens, pending CDP validations).
//   - Last activity (latest Publication.publishedAt OR Content.updatedAt).
//   - Manager name (first AgencyClientAccess with role=manager).
//   - Sector (from BrandProfile.industry).
//
// Summary aggregates the totals.

import { db } from "@/lib/db";
import { computeScores } from "@/server/modules/insights/performance";
import type { AgencyRole } from "@/server/core/rbac";

export type PortfolioClient = {
  id: string; // AgencyClient id
  workspaceId: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  makeItScore: number;
  scoreDelta: number;
  managerName: string | null;
  upcomingCount: number;
  alertsCount: number;
  lastActivityAt: string | null;
  sector: string | null;
  country: string | null;
  objective: string | null;
};

export type PortfolioSummary = {
  totalClients: number;
  activeClients: number;
  avgScore: number;
  totalAlerts: number;
};

export type Portfolio = {
  clients: PortfolioClient[];
  summary: PortfolioSummary;
};

const ALLOWED_STATUSES = new Set(["active", "paused", "archived"]);

export async function getPortfolio(
  agencyId: string,
  userId: string,
  role: AgencyRole
): Promise<Portfolio> {
  // Determine the client scope based on role.
  // Admins + managers see all agency clients. Creatives see only their assigned clients.
  let clientIds: string[] | null = null;
  if (role === "creative") {
    const accesses = await db.agencyClientAccess.findMany({
      where: { userId, agencyClient: { agencyId } },
      select: { agencyClientId: true },
    });
    clientIds = accesses.map((a) => a.agencyClientId);
  }

  const clients = await db.agencyClient.findMany({
    where: {
      agencyId,
      ...(clientIds ? { id: { in: clientIds } } : {}),
    },
    include: {
      workspace: {
        include: {
          brandProfile: true,
          socialAccounts: { select: { id: true, status: true, platform: true } },
        },
      },
      accesses: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { onboardedAt: "desc" },
  });

  const now = new Date();

  // Build the per-client list (parallel: computeScores + counts).
  const enriched = await Promise.all(
    clients.map(async (c) => {
      const workspaceId = c.workspaceId;

      // Make It Score — fall back to 0 if computeScores throws.
      let makeItScore = 0;
      let scoreDelta = 0;
      try {
        const scores = await computeScores(workspaceId);
        makeItScore = scores.total;
        scoreDelta = scores.delta;
      } catch {
        // ignore — leaves 0/0
      }

      // Manager name: first access with role=manager; fallback to first access.
      const managerAccess =
        c.accesses.find((a) => a.role === "manager") ?? c.accesses[0] ?? null;
      const managerName = managerAccess?.user?.name ?? managerAccess?.user?.email ?? null;

      // Upcoming content: draft | ready | scheduled with scheduledAt >= now, OR status=scheduled.
      const upcomingCount = await db.content.count({
        where: {
          workspaceId,
          OR: [
            { status: "scheduled" },
            {
              status: { in: ["draft", "ready"] },
              publications: { some: { scheduledAt: { gte: now } } },
            },
          ],
        },
      });

      // Alerts:
      //  - failed publications (status=failed, createdAt >= 7d ago)
      //  - expired social tokens (status=expired OR tokenExpiry < now)
      //  - pending CDP validations (stage=pending_cdp)
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const [failedPubs, expiredAccounts, pendingCdp] = await Promise.all([
        db.publication.count({
          where: { workspaceId, status: "failed", createdAt: { gte: since } },
        }),
        db.socialAccount.count({
          where: {
            workspaceId,
            OR: [
              { status: "expired" },
              { tokenExpiry: { lt: now } },
            ],
          },
        }),
        db.contentValidation.count({
          where: { workspaceId, stage: "pending_cdp" },
        }),
      ]);
      const alertsCount = failedPubs + expiredAccounts + pendingCdp;

      // Last activity: max(latest Publication.publishedAt, latest Content.updatedAt).
      const [latestPub, latestContent] = await Promise.all([
        db.publication.findFirst({
          where: { workspaceId, publishedAt: { not: null } },
          orderBy: { publishedAt: "desc" },
          select: { publishedAt: true },
        }),
        db.content.findFirst({
          where: { workspaceId },
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
      ]);
      const candidates = [
        latestPub?.publishedAt ?? null,
        latestContent?.updatedAt ?? null,
      ].filter((x): x is Date => x !== null);
      const lastActivityAt =
        candidates.length > 0
          ? new Date(Math.max(...candidates.map((d) => d.getTime()))).toISOString()
          : null;

      const status: "active" | "paused" | "archived" = ALLOWED_STATUSES.has(c.status)
        ? (c.status as "active" | "paused" | "archived")
        : "active";

      return {
        id: c.id,
        workspaceId,
        name: c.workspace.name,
        slug: c.workspace.slug,
        status,
        makeItScore,
        scoreDelta,
        managerName,
        upcomingCount,
        alertsCount,
        lastActivityAt,
        sector: c.workspace.brandProfile?.industry ?? null,
        country: c.workspace.brandProfile?.country ?? null,
        objective:
          (c.workspace.brandProfile?.objectives &&
            safeJsonParseArr(c.workspace.brandProfile.objectives)[0]) ||
          null,
      } satisfies PortfolioClient;
    })
  );

  const totalClients = enriched.length;
  const activeClients = enriched.filter((c) => c.status === "active").length;
  const totalAlerts = enriched.reduce((s, c) => s + c.alertsCount, 0);
  const avgScore =
    totalClients > 0
      ? Math.round(enriched.reduce((s, c) => s + c.makeItScore, 0) / totalClients)
      : 0;

  return {
    clients: enriched,
    summary: { totalClients, activeClients, avgScore, totalAlerts },
  };
}

function safeJsonParseArr(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}
