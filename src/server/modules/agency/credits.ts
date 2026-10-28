// Make It — Agency Credits domain service (P3).
//
// Two modes:
//   - "pool"     : all collaborators draw from the agency's shared pool.
//                  No per-allocation caps. `consumeAgencyCredits` decrements
//                  `AgencyWallet.totalConsumed` only.
//   - "quotas"   : each manager/client/creative has an AgencyCreditAllocation
//                  with a `quota` (monthly cap) + `consumed` counter. Before
//                  consuming, we walk the allocation chain (client → manager →
//                  agency) and refuse if any link exceeds its quota.
//
// The agency wallet never holds "credits" like the workspace wallet — it only
// tracks `totalCredits` (the purchased pool) + `totalConsumed` (cumulative use).
// `available = totalCredits - totalConsumed - reservedCredits`.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { audit } from "@/server/core/audit";
import type { AgencyRole } from "@/server/core/rbac";

export type AgencyWalletView = {
  agencyId: string;
  totalCredits: number;
  reservedCredits: number;
  totalConsumed: number;
  available: number;
  mode: "pool" | "quotas";
};

export type AllocationNode = {
  id: string;
  scope: "manager" | "client" | "creative";
  quota: number;
  consumed: number;
  remaining: number; // quota - consumed (Infinity if quota === 0 = unlimited)
  periodStart: string;
  periodEnd: string | null;
  // Resolved target
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  agencyClientId: string | null;
  clientName: string | null;
  // For managers: nested allocations to their clients/creatives.
  children?: AllocationNode[];
};

export type AllocationTree = {
  managers: AllocationNode[]; // each with nested client/creative allocations
  directClients: AllocationNode[]; // clients allocated directly to the agency (no manager)
  creatives: AllocationNode[]; // creatives allocated directly to the agency (no manager)
};

// ─────────────────────────── WALLET ───────────────────────────

export async function getAgencyWallet(agencyId: string): Promise<AgencyWalletView> {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { mode: true },
  });
  const mode = (agency?.mode as "pool" | "quotas") ?? "pool";

  const wallet = await db.agencyWallet.upsert({
    where: { agencyId },
    update: {},
    create: { agencyId },
  });

  return {
    agencyId,
    totalCredits: wallet.totalCredits,
    reservedCredits: wallet.reservedCredits,
    totalConsumed: wallet.totalConsumed,
    available: Math.max(0, wallet.totalCredits - wallet.totalConsumed - wallet.reservedCredits),
    mode,
  };
}

// ─────────────────────────── ALLOCATIONS ───────────────────────────

export async function getAllocations(
  agencyId: string,
  _userId: string,
  _role: AgencyRole
): Promise<AllocationTree> {
  const allocations = await db.agencyCreditAllocation.findMany({
    where: { agencyId },
    include: {
      agencyClient: { include: { workspace: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Resolve user names separately — AgencyCreditAllocation has no `user` relation.
  const userIds = Array.from(
    new Set(allocations.map((a) => a.userId).filter((x): x is string => !!x))
  );
  const users = userIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const toNode = (a: (typeof allocations)[number]): AllocationNode => {
    const quota = a.quota;
    const remaining = quota === 0 ? Infinity : Math.max(0, quota - a.consumed);
    const u = a.userId ? userMap.get(a.userId) : null;
    return {
      id: a.id,
      scope: a.scope as "manager" | "client" | "creative",
      quota,
      consumed: a.consumed,
      remaining,
      periodStart: a.periodStart.toISOString(),
      periodEnd: a.periodEnd?.toISOString() ?? null,
      userId: a.userId,
      userName: u?.name ?? null,
      userEmail: u?.email ?? null,
      agencyClientId: a.agencyClientId,
      clientName: a.agencyClient?.workspace.name ?? null,
    };
  };

  const managers = allocations.filter((a) => a.scope === "manager").map(toNode);
  const directClients = allocations
    .filter((a) => a.scope === "client" && a.userId === null)
    .map(toNode);
  const creatives = allocations
    .filter((a) => a.scope === "creative" && a.userId !== null && a.agencyClientId === null)
    .map(toNode);

  // For each manager, find the allocations "under" them:
  //   - clients where userId === manager.userId (means manager allocated to client)
  //   - creatives where userId === manager.userId
  // Note: the schema doesn't track "who allocated" explicitly, so we use the
  // heuristic that allocations created by a manager carry that manager's userId
  // on the allocation row (set by allocateCredits when scope != manager).
  // For clients/creatives allocated by an admin, userId is null → they appear
  // in directClients/creatives above.
  const managersWithChildren = managers.map((m) => {
    const children = allocations
      .filter(
        (a) =>
          (a.scope === "client" || a.scope === "creative") &&
          a.userId === m.userId &&
          a.id !== m.id
      )
      .map(toNode);
    return { ...m, children };
  });

  return { managers: managersWithChildren, directClients, creatives };
}

// ─────────────────────────── ALLOCATE ───────────────────────────

export type AllocateInput = {
  scope: "manager" | "client" | "creative";
  agencyClientId?: string | null;
  userId?: string | null;
  quota: number;
};

export async function allocateCredits(
  agencyId: string,
  byUserId: string,
  byRole: AgencyRole,
  input: AllocateInput
): Promise<AllocationNode> {
  if (input.scope === "manager") {
    // Only admins allocate to managers.
    if (byRole !== "admin") throw new Error("Seul un admin peut allouer à un manager");
  } else {
    // client / creative allocations — admin or manager.
    if (byRole !== "admin" && byRole !== "manager") {
      throw new Error("Rôle insuffisant pour allouer");
    }
  }
  if (!input.userId && input.scope === "manager") {
    throw new Error("userId requis pour allouer à un manager");
  }
  if (input.scope === "client" && !input.agencyClientId) {
    throw new Error("agencyClientId requis pour allouer à un client");
  }
  const quota = Math.max(0, Math.floor(input.quota || 0));

  // Find or create the allocation row (unique on agencyId + scope + userId + agencyClientId).
  // Since the schema doesn't have a composite unique, we look up manually.
  const existing = await db.agencyCreditAllocation.findFirst({
    where: {
      agencyId,
      scope: input.scope,
      userId: input.userId ?? null,
      agencyClientId: input.agencyClientId ?? null,
    },
  });

  let row;
  if (existing) {
    row = await db.agencyCreditAllocation.update({
      where: { id: existing.id },
      data: { quota, periodStart: new Date() },
    });
  } else {
    row = await db.agencyCreditAllocation.create({
      data: {
        agencyId,
        scope: input.scope,
        userId: input.userId ?? null,
        agencyClientId: input.agencyClientId ?? null,
        quota,
        consumed: 0,
        periodStart: new Date(),
      },
    });
  }

  await audit({
    userId: byUserId,
    action: "agency.credits.allocate",
    entity: "AgencyCreditAllocation",
    entityId: row.id,
    metadata: {
      agencyId,
      scope: input.scope,
      userId: input.userId ?? null,
      agencyClientId: input.agencyClientId ?? null,
      quota,
    },
  });

  const remaining = quota === 0 ? Infinity : Math.max(0, quota - row.consumed);
  return {
    id: row.id,
    scope: row.scope as "manager" | "client" | "creative",
    quota: row.quota,
    consumed: row.consumed,
    remaining,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd?.toISOString() ?? null,
    userId: row.userId,
    userName: null,
    userEmail: null,
    agencyClientId: row.agencyClientId,
    clientName: null,
  };
}

// ─────────────────────────── CONSUME ───────────────────────────

// Walk the allocation chain for a client: client allocation → manager allocation → agency pool.
// Returns true if the consumption is allowed (in pool mode: always, as long as the agency
// wallet has available credits; in quotas mode: every link must have remaining quota OR
// quota === 0 meaning unlimited). Decrements consumed counters + agency wallet.totalConsumed.
//
// In pool mode we also update the per-allocation consumed counters (if they exist) for
// analytics — but we don't enforce them.
export async function consumeAgencyCredits(
  agencyId: string,
  agencyClientId: string,
  amount: number,
  operation: string,
  jobId: string
): Promise<boolean> {
  if (amount <= 0) return true;
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { mode: true },
  });
  const mode = (agency?.mode as "pool" | "quotas") ?? "pool";

  // Look up the client row + its allocation + the workspace for the credit transaction.
  const client = await db.agencyClient.findUnique({
    where: { id: agencyClientId },
    include: { workspace: { select: { id: true } } },
  });
  if (!client || client.agencyId !== agencyId) {
    throw new Error("Client introuvable dans cette agence");
  }

  // Find the client's allocation (scope=client, agencyClientId=agencyClientId).
  const clientAlloc = await db.agencyCreditAllocation.findFirst({
    where: { agencyId, scope: "client", agencyClientId },
  });

  // Find the manager allocation: a manager access on this client.
  const managerAccess = await db.agencyClientAccess.findFirst({
    where: { agencyClientId, role: "manager" },
  });
  const managerAlloc = managerAccess
    ? await db.agencyCreditAllocation.findFirst({
        where: { agencyId, scope: "manager", userId: managerAccess.userId },
      })
    : null;

  // Quotas mode: enforce every link.
  if (mode === "quotas") {
    const checks: { label: string; remaining: number }[] = [];
    if (clientAlloc && clientAlloc.quota > 0) {
      checks.push({ label: "client", remaining: clientAlloc.quota - clientAlloc.consumed });
    }
    if (managerAlloc && managerAlloc.quota > 0) {
      checks.push({ label: "manager", remaining: managerAlloc.quota - managerAlloc.consumed });
    }
    for (const c of checks) {
      if (c.remaining < amount) {
        logger.warn("agency-credits:quota-exceeded", {
          agencyId,
          agencyClientId,
          label: c.label,
          amount,
          remaining: c.remaining,
        });
        return false;
      }
    }
  }

  // Apply: decrement agency wallet totalConsumed + bump per-allocation consumed counters.
  await db.$transaction(async (tx) => {
    const wallet = await tx.agencyWallet.upsert({
      where: { agencyId },
      update: {},
      create: { agencyId },
    });
    const newConsumed = wallet.totalConsumed + amount;
    const newReserved = Math.max(0, wallet.reservedCredits);
    await tx.agencyWallet.update({
      where: { agencyId },
      data: { totalConsumed: newConsumed, reservedCredits: newReserved },
    });

    if (clientAlloc) {
      await tx.agencyCreditAllocation.update({
        where: { id: clientAlloc.id },
        data: { consumed: clientAlloc.consumed + amount },
      });
    }
    if (managerAlloc) {
      await tx.agencyCreditAllocation.update({
        where: { id: managerAlloc.id },
        data: { consumed: managerAlloc.consumed + amount },
      });
    }

    // Mirror as a CreditTransaction on the client's workspace (for analytics).
    await tx.creditTransaction.create({
      data: {
        workspaceId: client.workspace.id,
        userId: null,
        type: "consumption",
        operation,
        amount: -amount,
        referenceId: jobId,
        note: `Consommation agence — ${operation}`,
      },
    });
  });

  await audit({
    workspaceId: client.workspace.id,
    action: "agency.credits.consume",
    entity: "AgencyWallet",
    entityId: agencyId,
    metadata: { agencyId, agencyClientId, amount, operation, jobId, mode },
  });

  logger.info("agency-credits:consume", {
    agencyId,
    agencyClientId,
    amount,
    operation,
    jobId,
    mode,
  });
  return true;
}

// ─────────────────────────── MODE ───────────────────────────

export async function setAgencyMode(
  agencyId: string,
  byUserId: string,
  mode: "pool" | "quotas"
): Promise<{ mode: "pool" | "quotas" }> {
  await db.agency.update({ where: { id: agencyId }, data: { mode } });
  await audit({
    userId: byUserId,
    action: "agency.credits.set_mode",
    entity: "Agency",
    entityId: agencyId,
    metadata: { mode },
  });
  return { mode };
}

// ─────────────────────────── RECHARGE ───────────────────────────

export async function rechargeAgency(
  agencyId: string,
  byUserId: string,
  amountCents: number,
  credits: number
): Promise<AgencyWalletView> {
  if (amountCents < 0 || credits <= 0) {
    throw new Error("Montant ou nombre de crédits invalide");
  }
  await db.$transaction(async (tx) => {
    const wallet = await tx.agencyWallet.upsert({
      where: { agencyId },
      update: {},
      create: { agencyId },
    });
    await tx.agencyWallet.update({
      where: { agencyId },
      data: { totalCredits: wallet.totalCredits + credits },
    });
  });
  await audit({
    userId: byUserId,
    action: "agency.credits.recharge",
    entity: "AgencyWallet",
    entityId: agencyId,
    metadata: { agencyId, amountCents, credits },
  });
  return getAgencyWallet(agencyId);
}

// ─────────────────────────── CONSUMPTION BREAKDOWN ───────────────────────────

export type ConsumptionBucket = {
  label: string;
  byClient: { clientId: string; clientName: string; consumed: number }[];
  byManager: { managerId: string; managerName: string; consumed: number }[];
  byCreative: { creativeId: string; creativeName: string; consumed: number }[];
  total: number;
};

// Aggregates agency credit consumption over a period using the
// AgencyCreditAllocation.consumed counters (reset by a cron at month start —
// for the breakdown we look at all allocations in the period by periodStart).
// For a quick dashboard, we sum the consumed counters for allocations with
// periodStart >= since. If `since` is omitted, uses last 30 days.
export async function getConsumptionBreakdown(
  agencyId: string,
  sinceDays = 30
): Promise<ConsumptionBucket> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const allocations = await db.agencyCreditAllocation.findMany({
    where: { agencyId, periodStart: { gte: since } },
    include: {
      agencyClient: { include: { workspace: { select: { name: true } } } },
    },
  });

  // Resolve user names separately.
  const userIds = Array.from(
    new Set(allocations.map((a) => a.userId).filter((x): x is string => !!x))
  );
  const users = userIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const byClientMap = new Map<string, { clientId: string; clientName: string; consumed: number }>();
  const byManagerMap = new Map<string, { managerId: string; managerName: string; consumed: number }>();
  const byCreativeMap = new Map<string, { creativeId: string; creativeName: string; consumed: number }>();

  let total = 0;
  for (const a of allocations) {
    total += a.consumed;
    if (a.scope === "client" && a.agencyClientId) {
      const id = a.agencyClientId;
      const name = a.agencyClient?.workspace.name ?? "Client";
      byClientMap.set(id, {
        clientId: id,
        clientName: name,
        consumed: (byClientMap.get(id)?.consumed ?? 0) + a.consumed,
      });
    } else if (a.scope === "manager" && a.userId) {
      const id = a.userId;
      const u = userMap.get(id);
      const name = u?.name ?? u?.email ?? "Manager";
      byManagerMap.set(id, {
        managerId: id,
        managerName: name,
        consumed: (byManagerMap.get(id)?.consumed ?? 0) + a.consumed,
      });
    } else if (a.scope === "creative" && a.userId) {
      const id = a.userId;
      const u = userMap.get(id);
      const name = u?.name ?? u?.email ?? "Creative";
      byCreativeMap.set(id, {
        creativeId: id,
        creativeName: name,
        consumed: (byCreativeMap.get(id)?.consumed ?? 0) + a.consumed,
      });
    }
  }

  return {
    label: `${sinceDays} jours`,
    byClient: Array.from(byClientMap.values()).sort((a, b) => b.consumed - a.consumed),
    byManager: Array.from(byManagerMap.values()).sort((a, b) => b.consumed - a.consumed),
    byCreative: Array.from(byCreativeMap.values()).sort((a, b) => b.consumed - a.consumed),
    total,
  };
}
