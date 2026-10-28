// Make It — Credit engine.
// Wallet with subscriptionCredits + purchasedCredits + reservedCredits.
// Consumption priority: subscription credits first, then purchased.
// Reservation: lock credits before a job, consume real amount on completion, refund surplus.

import { db } from "@/lib/db";
import { logger } from "./logger";
import { emitCreditUpdate } from "./realtime";

export type Wallet = {
  workspaceId: string;
  subscriptionCredits: number;
  purchasedCredits: number;
  reservedCredits: number;
  totalConsumed: number;
};

export async function getWallet(workspaceId: string): Promise<Wallet> {
  const w = await db.creditWallet.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  });
  return w;
}

export function walletBalance(w: Wallet) {
  return w.subscriptionCredits + w.purchasedCredits - w.reservedCredits;
}

export function availableBalance(w: Wallet) {
  // credits not reserved
  return Math.max(0, w.subscriptionCredits + w.purchasedCredits - w.reservedCredits);
}

// Reserve credits for a job. Subtract from available (subscription first).
export async function reserveCredits(workspaceId: string, amount: number, jobId: string): Promise<boolean> {
  await db.$transaction(async (tx) => {
    const w = await tx.creditWallet.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
    const available = w.subscriptionCredits + w.purchasedCredits - w.reservedCredits;
    if (available < amount) throw new Error("INSUFFICIENT_CREDITS");
    // Reserve from subscription first
    let toReserve = amount;
    let subReserve = Math.min(w.subscriptionCredits, toReserve);
    let purchReserve = toReserve - subReserve;
    await tx.creditWallet.update({
      where: { workspaceId },
      data: {
        reservedCredits: w.reservedCredits + amount,
      },
    });
    await tx.creditTransaction.create({
      data: {
        workspaceId,
        type: "reservation",
        operation: "reservation",
        amount: -amount,
        referenceId: jobId,
        note: `Reservation for job ${jobId}`,
      },
    });
  });
  emitCreditUpdate(workspaceId, await getWallet(workspaceId));
  logger.info("credits:reserve", { workspaceId, amount, jobId });
  return true;
}

// Consume real credits after job completion. Refunds the surplus from the reservation.
// consumption priority: subscription first, then purchased.
export async function consumeCredits(
  workspaceId: string,
  reservedAmount: number,
  consumedAmount: number,
  operation: string,
  jobId: string
): Promise<void> {
  if (consumedAmount < 0) consumedAmount = 0;
  if (consumedAmount > reservedAmount) consumedAmount = reservedAmount;
  await db.$transaction(async (tx) => {
    const w = await tx.creditWallet.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
    // Release reservation first
    const newReserved = Math.max(0, w.reservedCredits - reservedAmount);
    // Deduct consumed from subscription first, then purchased
    let remaining = consumedAmount;
    const newSub = Math.max(0, w.subscriptionCredits - remaining);
    remaining -= w.subscriptionCredits - newSub;
    const newPurch = Math.max(0, w.purchasedCredits - remaining);
    await tx.creditWallet.update({
      where: { workspaceId },
      data: {
        subscriptionCredits: newSub,
        purchasedCredits: newPurch,
        reservedCredits: newReserved,
        totalConsumed: w.totalConsumed + consumedAmount,
      },
    });
    if (consumedAmount > 0) {
      await tx.creditTransaction.create({
        data: {
          workspaceId,
          type: "consumption",
          operation,
          amount: -consumedAmount,
          referenceId: jobId,
          note: `Consommation ${operation}`,
        },
      });
    }
    if (reservedAmount - consumedAmount > 0) {
      await tx.creditTransaction.create({
        data: {
          workspaceId,
          type: "release",
          operation,
          amount: reservedAmount - consumedAmount,
          referenceId: jobId,
          note: `Restitution surplus reservation`,
        },
      });
    }
  });
  emitCreditUpdate(workspaceId, await getWallet(workspaceId));
  logger.info("credits:consume", { workspaceId, reservedAmount, consumedAmount, operation, jobId });
}

// Refund entire reservation (job failed before consumption).
export async function refundReservation(workspaceId: string, reservedAmount: number, jobId: string): Promise<void> {
  if (reservedAmount <= 0) return;
  await db.$transaction(async (tx) => {
    const w = await tx.creditWallet.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
    await tx.creditWallet.update({
      where: { workspaceId },
      data: { reservedCredits: Math.max(0, w.reservedCredits - reservedAmount) },
    });
    await tx.creditTransaction.create({
      data: {
        workspaceId,
        type: "release",
        operation: "refund",
        amount: reservedAmount,
        referenceId: jobId,
        note: `Restitution (job échoué) ${jobId}`,
      },
    });
  });
  emitCreditUpdate(workspaceId, await getWallet(workspaceId));
  logger.info("credits:refund", { workspaceId, reservedAmount, jobId });
}

// Add credits (purchase or bonus or allocation).
export async function addCredits(workspaceId: string, amount: number, type: "purchase" | "bonus" | "allocation", referenceId?: string, note?: string) {
  await db.$transaction(async (tx) => {
    const w = await tx.creditWallet.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
    const data = type === "purchase"
      ? { purchasedCredits: w.purchasedCredits + amount }
      : type === "allocation"
      ? { subscriptionCredits: w.subscriptionCredits + amount }
      : { purchasedCredits: w.purchasedCredits + amount };
    await tx.creditWallet.update({ where: { workspaceId }, data });
    await tx.creditTransaction.create({
      data: { workspaceId, type, amount, referenceId, note: note ?? `${type} ${amount} crédits` },
    });
  });
  emitCreditUpdate(workspaceId, await getWallet(workspaceId));
}

// Expire subscription credits (called by a cron).
export async function expireSubscriptionCredits(workspaceId: string, amount: number) {
  if (amount <= 0) return;
  await db.$transaction(async (tx) => {
    const w = await tx.creditWallet.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
    await tx.creditWallet.update({
      where: { workspaceId },
      data: { subscriptionCredits: Math.max(0, w.subscriptionCredits - amount) },
    });
    await tx.creditTransaction.create({
      data: { workspaceId, type: "expiration", amount: -amount, note: "Expiration crédits abonnement" },
    });
  });
  emitCreditUpdate(workspaceId, await getWallet(workspaceId));
}
