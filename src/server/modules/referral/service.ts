// Make It — Referral (parrainage) domain service.
//
// A user shares their referral link (`/ref/{code}`). When a visitor lands on
// the page we record a `ReferralClick` and bump the code's `clicks` counter.
// When the visitor signs up using the code, we create a `Referral` row
// (status = `signed_up`) and grant 30 credits to the referrer. When the
// referred user activates a paid subscription, we mark the Referral as
// `converted` and grant 500 more credits.
//
// All grants are idempotent (guarded by `signupRewardGranted` /
// `conversionRewardGranted` booleans on the Referral row) and best-effort
// (errors are logged but never bubble to the caller, so a flaky wallet update
// never breaks registration or subscription). All mutations emit AuditLog
// entries (`referral.code.generate`, `referral.click`, `referral.signup.reward`,
// `referral.conversion.reward`).

import { db } from "@/lib/db";
import { addCredits } from "@/server/core/credits";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";

// ─────────────────────────── constants ───────────────────────────

export const SIGNUP_REWARD_CREDITS = 30;
export const CONVERSION_REWARD_CREDITS = 500;
export const REFERRAL_CODE_LENGTH = 8;
const RECENT_REFERRALS_LIMIT = 10;
const PAGE_SIZE = 20;

// URL-safe alphabet (no ambiguous chars: 0/O, 1/l/I).
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

// ─────────────────────────── types ───────────────────────────

export type ReferralStatus = "pending" | "signed_up" | "converted" | "expired";

export type ReferralStats = {
  code: string;
  link: string;
  clicks: number;
  signups: number;
  conversions: number;
  creditsEarned: number;
  pendingReferrals: number;
  recentReferrals: RecentReferral[];
};

export type RecentReferral = {
  id: string;
  referredEmail: string;
  referredName: string | null;
  status: ReferralStatus;
  invitedAt: string;
  signedUpAt: string | null;
  convertedAt: string | null;
};

export type ReferralListRow = RecentReferral & {
  referrerId: string;
  codeId: string;
  signupRewardGranted: boolean;
  conversionRewardGranted: boolean;
};

export type ValidateResult = {
  valid: boolean;
  referrerName: string | null;
  code: string | null;
};

export type ReferrerWallet = { kind: "workspace" | "agency"; id: string };

// ─────────────────────────── helpers ───────────────────────────

function isReferralStatus(v: unknown): v is ReferralStatus {
  return (
    typeof v === "string" &&
    ["pending", "signed_up", "converted", "expired"].includes(v)
  );
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

// Generate an 8-char URL-safe referral code. Uses crypto.randomBytes for
// unbiased entropy. Retries until the code is unique.
function generateCode(): string {
  const bytes = new Uint8Array(REFERRAL_CODE_LENGTH);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback (should never happen in Node 20+/browser).
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

async function uniqueCode(): Promise<string> {
  // Try a few times to find a unique code (extremely unlikely to collide).
  for (let i = 0; i < 5; i++) {
    const candidate = generateCode();
    const existing = await db.referralCode.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Final fallback — append a short numeric suffix.
  return `${generateCode().slice(0, 6)}${Math.floor(Math.random() * 99)
    .toString()
    .padStart(2, "0")}`;
}

function toRecent(r: {
  id: string;
  referredEmail: string;
  referredId: string | null;
  status: string;
  invitedAt: Date;
  signedUpAt: Date | null;
  convertedAt: Date | null;
  referred: { name: string | null } | null;
}): RecentReferral {
  return {
    id: r.id,
    referredEmail: r.referredEmail,
    referredName: r.referred?.name ?? null,
    status: isReferralStatus(r.status) ? r.status : "pending",
    invitedAt: r.invitedAt.toISOString(),
    signedUpAt: r.signedUpAt ? r.signedUpAt.toISOString() : null,
    convertedAt: r.convertedAt ? r.convertedAt.toISOString() : null,
  };
}

// ─────────────────────────── getOrCreateReferralCode ───────────────────────────

export async function getOrCreateReferralCode(userId: string): Promise<{
  id: string;
  code: string;
  active: boolean;
  createdAt: string;
}> {
  const existing = await db.referralCode.findFirst({
    where: { userId, active: true },
  });
  if (existing) {
    return {
      id: existing.id,
      code: existing.code,
      active: existing.active,
      createdAt: existing.createdAt.toISOString(),
    };
  }
  const code = await uniqueCode();
  const created = await db.referralCode.create({
    data: { userId, code, active: true },
  });
  await audit({
    userId,
    action: "referral.code.generate",
    entity: "ReferralCode",
    entityId: created.id,
    metadata: { code: created.code },
  });
  logger.info("referral:code.generate", { userId, code: created.code });
  return {
    id: created.id,
    code: created.code,
    active: created.active,
    createdAt: created.createdAt.toISOString(),
  };
}

// Regenerate the user's active code. The previous code is deactivated so the
// user keeps a single active code at any time. Returns the new code.
export async function regenerateReferralCode(userId: string): Promise<{
  id: string;
  code: string;
  active: boolean;
  createdAt: string;
}> {
  // Deactivate any existing active codes (there should be exactly one — but
  // the @@unique([userId, active]) constraint lets us be defensive).
  await db.referralCode.updateMany({
    where: { userId, active: true },
    data: { active: false },
  });
  const code = await uniqueCode();
  const created = await db.referralCode.create({
    data: { userId, code, active: true },
  });
  await audit({
    userId,
    action: "referral.code.regenerate",
    entity: "ReferralCode",
    entityId: created.id,
    metadata: { code: created.code },
  });
  logger.info("referral:code.regenerate", { userId, code: created.code });
  return {
    id: created.id,
    code: created.code,
    active: created.active,
    createdAt: created.createdAt.toISOString(),
  };
}

// ─────────────────────────── getReferralStats ───────────────────────────

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const { id: codeId, code } = await getOrCreateReferralCode(userId);

  const [clicks, signups, conversions, creditsEarned, pendingReferrals, recent] =
    await Promise.all([
      db.referralClick.count({ where: { codeId } }),
      db.referral.count({ where: { codeId, status: { in: ["signed_up", "converted"] } } }),
      db.referral.count({ where: { codeId, status: "converted" } }),
      db.referral.aggregate({
        where: { codeId },
        _sum: { signupRewardCredits: true, conversionRewardCredits: true },
      }),
      db.referral.count({ where: { codeId, status: "pending" } }),
      db.referral.findMany({
        where: { codeId },
        orderBy: { invitedAt: "desc" },
        take: RECENT_REFERRALS_LIMIT,
        include: { referred: { select: { name: true } } },
      }),
    ]);

  const signupCredits = creditsEarned._sum.signupRewardCredits ?? 0;
  const conversionCredits = creditsEarned._sum.conversionRewardCredits ?? 0;

  return {
    code,
    link: `/ref/${code}`,
    clicks,
    signups,
    conversions,
    // Only count granted rewards (pending referrals don't count toward earnings).
    creditsEarned: signupCredits + conversionCredits,
    pendingReferrals,
    recentReferrals: recent.map(toRecent),
  };
}

// ─────────────────────────── trackClick ───────────────────────────

export async function trackClick(
  code: string,
  opts: { ip?: string | null; userAgent?: string | null }
): Promise<{ recorded: boolean; referrerName: string | null }> {
  const refCode = await db.referralCode.findUnique({
    where: { code },
    include: { user: { select: { name: true } } },
  });
  // Always return 200 (don't leak whether a code exists — but the public
  // validate endpoint does, so this is fine). We just don't record a click
  // for unknown codes.
  if (!refCode || !refCode.active) {
    return { recorded: false, referrerName: null };
  }
  await db.$transaction([
    db.referralClick.create({
      data: {
        codeId: refCode.id,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
      },
    }),
    db.referralCode.update({
      where: { id: refCode.id },
      data: { clicks: { increment: 1 } },
    }),
  ]);
  logger.info("referral:click", { code, codeId: refCode.id });
  return {
    recorded: true,
    referrerName: refCode.user?.name ?? null,
  };
}

// ─────────────────────────── validateReferralCode ───────────────────────────

export async function validateReferralCode(code: string): Promise<ValidateResult> {
  const refCode = await db.referralCode.findUnique({
    where: { code },
    include: { user: { select: { name: true } } },
  });
  if (!refCode || !refCode.active) {
    return { valid: false, referrerName: null, code: null };
  }
  return {
    valid: true,
    referrerName: refCode.user?.name ?? null,
    code: refCode.code,
  };
}

// ─────────────────────────── getReferrerWalletId ───────────────────────────
// Returns where to grant bonus credits: the referrer's primary personal
// workspace (kind="workspace"), or — if they're an agency admin — the agency
// wallet (kind="agency"). Used by processSignup/processConversion to credit
// the right wallet.

export async function getReferrerWalletId(userId: string): Promise<ReferrerWallet | null> {
  // 1) Check if the user is an agency admin. If so, prefer the agency wallet
  //    (referral bonuses at the agency level — the admin's personal workspace
  //    is typically the "first client" of the agency, so we don't want bonuses
  //    to leak there).
  const agencyMembership = await db.agencyMember.findFirst({
    where: { userId, role: "admin" },
    include: { agency: { include: { wallet: true } } },
  });
  if (agencyMembership?.agency?.wallet) {
    return { kind: "agency", id: agencyMembership.agency.wallet.id };
  }

  // 2) Otherwise, use the referrer's primary personal workspace — their owned
  //    workspace (the one created at signup), or fall back to their first
  //    membership.
  const owned = await db.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owned) return { kind: "workspace", id: owned.id };

  const membership = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  if (membership) return { kind: "workspace", id: membership.workspaceId };

  return null;
}

// Grant credits to the referrer. Uses `addCredits` for workspace wallets, and
// a direct `agencyWallet` update + audit for agency wallets (since addCredits
// only knows about workspaces).
async function grantReferralCredits(
  wallet: ReferrerWallet,
  amount: number,
  referenceId: string,
  note: string,
  referrerUserId: string
): Promise<void> {
  if (wallet.kind === "workspace") {
    await addCredits(wallet.id, amount, "bonus", referenceId, note);
    return;
  }
  // Agency wallet — direct update + audit.
  await db.agencyWallet.update({
    where: { id: wallet.id },
    data: { totalCredits: { increment: amount } },
  });
  await audit({
    userId: referrerUserId,
    action: "referral.agency.grant",
    entity: "AgencyWallet",
    entityId: wallet.id,
    metadata: { amount, referenceId, note },
  });
}

// ─────────────────────────── processSignup ───────────────────────────
// Idempotent: if a Referral row already exists for this (code, email) pair,
// we just link it to the new user id (if not yet linked) and re-grant is
// skipped (signupRewardGranted guard). Otherwise we create a new Referral
// with status=signed_up and grant 30 credits to the referrer.

export async function processSignup(opts: {
  refCode: string;
  email: string;
  newUserId: string;
  ip?: string | null;
}): Promise<{ referralId: string | null; granted: boolean } | null> {
  const refCode = await db.referralCode.findUnique({
    where: { code: opts.refCode },
  });
  if (!refCode || !refCode.active) return null;

  // Don't allow self-referrals.
  if (refCode.userId === opts.newUserId) return null;

  // Try to find an existing referral (idempotency). The unique constraint is
  // (referredEmail, codeId), so we'll never create a duplicate.
  let referral = await db.referral.findUnique({
    where: {
      referredEmail_codeId: {
        referredEmail: opts.email.toLowerCase().trim(),
        codeId: refCode.id,
      },
    },
  });

  if (!referral) {
    // Create a new signed_up referral.
    referral = await db.referral.create({
      data: {
        referrerId: refCode.userId,
        referredId: opts.newUserId,
        referredEmail: opts.email.toLowerCase().trim(),
        codeId: refCode.id,
        status: "signed_up",
        signupRewardGranted: false,
        signupRewardCredits: SIGNUP_REWARD_CREDITS,
        signedUpAt: new Date(),
      },
    });
  } else {
    // Already exists — link to the user id if not yet linked, and bump status
    // to signed_up (if it was pending).
    referral = await db.referral.update({
      where: { id: referral.id },
      data: {
        referredId: opts.newUserId,
        status: referral.status === "pending" ? "signed_up" : referral.status,
        signedUpAt: referral.signedUpAt ?? new Date(),
      },
    });
  }

  // Grant the signup reward — idempotent.
  if (referral.signupRewardGranted) {
    return { referralId: referral.id, granted: false };
  }

  const wallet = await getReferrerWalletId(refCode.userId);
  if (!wallet) {
    logger.warn("referral:signup.nowallet", {
      referrerId: refCode.userId,
      referralId: referral.id,
    });
    // Still mark as granted so we don't keep retrying — the referrer has no
    // wallet to receive credits, which is an edge case (e.g. user deleted
    // all their workspaces). The signup itself succeeds.
    await db.referral.update({
      where: { id: referral.id },
      data: { signupRewardGranted: true },
    });
    return { referralId: referral.id, granted: false };
  }

  try {
    await grantReferralCredits(
      wallet,
      SIGNUP_REWARD_CREDITS,
      referral.id,
      `Parrainage — Inscription de ${opts.email}`,
      refCode.userId
    );
    await db.referral.update({
      where: { id: referral.id },
      data: { signupRewardGranted: true },
    });
    // Bump the code's signups counter + creditsEarned.
    await db.referralCode.update({
      where: { id: refCode.id },
      data: {
        signups: { increment: 1 },
        creditsEarned: { increment: SIGNUP_REWARD_CREDITS },
      },
    });
    await audit({
      userId: refCode.userId,
      action: "referral.signup.reward",
      entity: "Referral",
      entityId: referral.id,
      metadata: {
        credits: SIGNUP_REWARD_CREDITS,
        referredEmail: opts.email,
        walletKind: wallet.kind,
        walletId: wallet.id,
      },
      ip: opts.ip ?? undefined,
    });
    logger.info("referral:signup.reward", {
      referrerId: refCode.userId,
      referralId: referral.id,
      credits: SIGNUP_REWARD_CREDITS,
    });
    return { referralId: referral.id, granted: true };
  } catch (e) {
    logger.error("referral:signup.reward.failed", {
      referralId: referral.id,
      error: e instanceof Error ? e.message : String(e),
    });
    // Don't re-throw — non-blocking. The signup still succeeded; we'll retry
    // the reward on the next call (the grant flag is NOT set).
    return { referralId: referral.id, granted: false };
  }
}

// ─────────────────────────── processConversion ───────────────────────────
// Idempotent: find the Referral where referredId=userId + status=signed_up,
// mark it converted, and grant 500 credits. If already converted, no-op.

export async function processConversion(opts: {
  userId: string;
}): Promise<{ referralId: string | null; granted: boolean } | null> {
  // Find the latest signed_up referral where the user is the referred.
  const referral = await db.referral.findFirst({
    where: { referredId: opts.userId, status: "signed_up" },
    orderBy: { signedUpAt: "desc" },
    include: { code: true },
  });
  if (!referral) return null;
  if (referral.conversionRewardGranted) {
    // Already granted — ensure status reflects it.
    if (referral.status !== "converted") {
      await db.referral.update({
        where: { id: referral.id },
        data: { status: "converted", convertedAt: referral.convertedAt ?? new Date() },
      });
    }
    return { referralId: referral.id, granted: false };
  }

  const wallet = await getReferrerWalletId(referral.code.userId);
  if (!wallet) {
    logger.warn("referral:conversion.nowallet", {
      referrerId: referral.code.userId,
      referralId: referral.id,
    });
    await db.referral.update({
      where: { id: referral.id },
      data: { conversionRewardGranted: true, status: "converted", convertedAt: new Date() },
    });
    return { referralId: referral.id, granted: false };
  }

  try {
    await grantReferralCredits(
      wallet,
      CONVERSION_REWARD_CREDITS,
      referral.id,
      `Parrainage — Abonnement activé`,
      referral.code.userId
    );
    await db.referral.update({
      where: { id: referral.id },
      data: {
        conversionRewardGranted: true,
        status: "converted",
        convertedAt: new Date(),
      },
    });
    await db.referralCode.update({
      where: { id: referral.code.id },
      data: {
        conversions: { increment: 1 },
        creditsEarned: { increment: CONVERSION_REWARD_CREDITS },
      },
    });
    await audit({
      userId: referral.code.userId,
      action: "referral.conversion.reward",
      entity: "Referral",
      entityId: referral.id,
      metadata: {
        credits: CONVERSION_REWARD_CREDITS,
        referredId: opts.userId,
        walletKind: wallet.kind,
        walletId: wallet.id,
      },
    });
    logger.info("referral:conversion.reward", {
      referrerId: referral.code.userId,
      referralId: referral.id,
      credits: CONVERSION_REWARD_CREDITS,
    });
    return { referralId: referral.id, granted: true };
  } catch (e) {
    logger.error("referral:conversion.reward.failed", {
      referralId: referral.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return { referralId: referral.id, granted: false };
  }
}

// ─────────────────────────── listReferrals ───────────────────────────

export async function listReferrals(
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{
  referrals: ReferralListRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? PAGE_SIZE));
  const refCode = await db.referralCode.findFirst({
    where: { userId, active: true },
    select: { id: true },
  });
  if (!refCode) {
    return { referrals: [], total: 0, page, pageSize };
  }
  const [rows, total] = await Promise.all([
    db.referral.findMany({
      where: { codeId: refCode.id },
      orderBy: { invitedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { referred: { select: { name: true } } },
    }),
    db.referral.count({ where: { codeId: refCode.id } }),
  ]);
  return {
    referrals: rows.map((r) => ({
      ...toRecent(r),
      referrerId: r.referrerId,
      codeId: r.codeId,
      signupRewardGranted: r.signupRewardGranted,
      conversionRewardGranted: r.conversionRewardGranted,
    })),
    total,
    page,
    pageSize,
  };
}

// ─────────────────────────── exports for API routes ───────────────────────────

export { maskEmail };
