// Make It — Publishing domain service.
// `schedulePublication` — create a Publication + enqueue a publishing job.
// `publishNow`        — multi-platform immediate publish.
// `runPublisherJob`   — the queue handler body that runs at scheduledAt.
//
// The publishing job waits until scheduledAt (mock: setTimeout until that
// instant, or if past, immediately) then calls the publisher, updates the
// Publication row, and emits `publication:status`.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { enqueue, registerHandler } from "@/server/core/queue";
import { emitPublicationStatus } from "@/server/core/realtime";
import { getPublisher, publishWithRetry, markAccountExpiredIfNeeded, type SocialAccountInfo } from "./publisher";
import { isPublishable } from "@/server/modules/validation/service";

// ── Types ────────────────────────────────────────────────────────────

export type ScheduleInput = {
  contentId: string;
  socialAccountId: string;
  scheduledAt?: Date | null;
};

export type PublicationRow = {
  id: string;
  workspaceId: string;
  contentId: string | null;
  socialAccountId: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  status: string;
  externalPostId: string | null;
  externalPermalink: string | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(p: {
  id: string; workspaceId: string; contentId: string | null; socialAccountId: string;
  scheduledAt: Date | null; publishedAt: Date | null; status: string;
  externalPostId: string | null; externalPermalink: string | null;
  error: string | null; attempts: number; createdAt: Date; updatedAt: Date;
}): PublicationRow {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    contentId: p.contentId,
    socialAccountId: p.socialAccountId,
    scheduledAt: p.scheduledAt,
    publishedAt: p.publishedAt,
    status: p.status,
    externalPostId: p.externalPostId,
    externalPermalink: p.externalPermalink,
    error: p.error,
    attempts: p.attempts,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ── schedulePublication ──────────────────────────────────────────────

let queueHandlerRegistered = false;

export async function schedulePublication(
  workspaceId: string,
  input: ScheduleInput
): Promise<PublicationRow> {
  // Validate content belongs to the workspace.
  const content = await db.content.findUnique({ where: { id: input.contentId } });
  if (!content || content.workspaceId !== workspaceId) {
    throw new Error("Contenu introuvable");
  }
  // Validate socialAccount belongs to the workspace + is connected.
  const account = await db.socialAccount.findUnique({ where: { id: input.socialAccountId } });
  if (!account || account.workspaceId !== workspaceId) {
    throw new Error("Compte social introuvable");
  }
  if (account.status !== "connected") {
    throw new Error(`Compte social non connecté (statut: ${account.status})`);
  }

  // ── Validation gate (P3) — content must be validated before scheduling. ──
  const publishable = await isPublishable(input.contentId, workspaceId).catch(() => true);
  if (!publishable) {
    throw new Error("Validation requise avant publication");
  }

  const scheduledAt = input.scheduledAt ?? null;

  const publication = await db.publication.create({
    data: {
      workspaceId,
      contentId: input.contentId,
      socialAccountId: input.socialAccountId,
      scheduledAt,
      status: scheduledAt ? "pending" : "pending",
    },
  });

  // Register the queue handler once (idempotent).
  if (!queueHandlerRegistered) {
    registerHandler("publishing", runPublisherJob);
    queueHandlerRegistered = true;
  }

  // Enqueue the publishing job.
  enqueue({
    type: "publishing",
    payload: { publicationId: publication.id },
    maxAttempts: 3,
  });

  return toRow(publication);
}

// ── publishNow (multi-platform immediate publish) ───────────────────

export type PublishNowResult = {
  published: Array<{
    publicationId: string;
    platform: string;
    status: string;
    externalPostId?: string | null;
    externalPermalink?: string | null;
    error?: string | null;
  }>;
};

export async function publishNow(
  workspaceId: string,
  input: { contentId: string; socialAccountIds: string[] }
): Promise<PublishNowResult> {
  // Validate content belongs to the workspace.
  const content = await db.content.findUnique({ where: { id: input.contentId } });
  if (!content || content.workspaceId !== workspaceId) {
    throw new Error("Contenu introuvable");
  }

  // ── Validation gate (P3) — content must be validated before publishing. ──
  const publishable = await isPublishable(input.contentId, workspaceId).catch(() => true);
  if (!publishable) {
    throw new Error("Validation requise avant publication");
  }

  if (input.socialAccountIds.length === 0) {
    throw new Error("Au moins un compte social est requis");
  }

  // Resolve accounts (workspace-scoped).
  const accounts = await db.socialAccount.findMany({
    where: { id: { in: input.socialAccountIds }, workspaceId },
  });
  if (accounts.length !== input.socialAccountIds.length) {
    throw new Error("Un ou plusieurs comptes sociaux introuvables");
  }

  const published: PublishNowResult["published"] = [];

  for (const account of accounts) {
    // Create the publication row.
    const publication = await db.publication.create({
      data: {
        workspaceId,
        contentId: input.contentId,
        socialAccountId: account.id,
        scheduledAt: null,
        status: "publishing",
      },
    });

    const accountInfo: SocialAccountInfo = {
      id: account.id,
      platform: account.platform,
      accountName: account.accountName,
      handle: account.handle,
      externalAccountId: account.externalAccountId,
      tokenExpiry: account.tokenExpiry,
      status: account.status,
    };

    // Check token expiry first.
    const expired = await markAccountExpiredIfNeeded(accountInfo);
    if (expired || account.status === "expired") {
      await db.publication.update({
        where: { id: publication.id },
        data: { status: "failed", error: "Token expiré" },
      });
      await emitPublicationStatus(workspaceId, {
        id: publication.id,
        status: "failed",
        contentId: input.contentId,
        platform: account.platform,
      });
      published.push({
        publicationId: publication.id,
        platform: account.platform,
        status: "failed",
        error: "Token expiré",
      });
      continue;
    }

    const publisher = getPublisher(account.platform);
    if (!publisher) {
      await db.publication.update({
        where: { id: publication.id },
        data: { status: "failed", error: `Aucun publisher pour la plateforme ${account.platform}` },
      });
      published.push({
        publicationId: publication.id,
        platform: account.platform,
        status: "failed",
        error: `Aucun publisher pour la plateforme ${account.platform}`,
      });
      continue;
    }

    try {
      const { result, attempts } = await publishWithRetry(
        publisher,
        {
          publicationId: publication.id,
          contentTitle: content.title,
          contentDescription: content.description,
          contentId: content.id,
        },
        accountInfo
      );

      await db.publication.update({
        where: { id: publication.id },
        data: {
          status: "published",
          externalPostId: result.externalPostId,
          externalPermalink: result.externalPermalink ?? null,
          publishedAt: new Date(),
          attempts,
        },
      });

      await emitPublicationStatus(workspaceId, {
        id: publication.id,
        status: "published",
        contentId: content.id,
        platform: account.platform,
      });

      published.push({
        publicationId: publication.id,
        platform: account.platform,
        status: "published",
        externalPostId: result.externalPostId,
        externalPermalink: result.externalPermalink ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("publish:now-failed", { publicationId: publication.id, error: msg });
      await db.publication.update({
        where: { id: publication.id },
        data: { status: "failed", error: msg },
      });
      await emitPublicationStatus(workspaceId, {
        id: publication.id,
        status: "failed",
        contentId: content.id,
        platform: account.platform,
      });
      published.push({
        publicationId: publication.id,
        platform: account.platform,
        status: "failed",
        error: msg,
      });
    }
  }

  return { published };
}

// ── runPublisherJob — the queue handler body ────────────────────────

export async function runPublisherJob(job: { payload: unknown }): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
  const { publicationId } = job.payload as { publicationId: string };
  if (!publicationId) {
    return { ok: false, error: "publicationId manquant", retryable: false };
  }

  const publication = await db.publication.findUnique({
    where: { id: publicationId },
    include: { socialAccount: true, content: true },
  });
  if (!publication) {
    return { ok: false, error: "Publication introuvable", retryable: false };
  }
  // Canceled while waiting?
  if (publication.status === "canceled") {
    return { ok: true };
  }

  // Wait until scheduledAt if it's in the future (mock: setTimeout).
  const scheduledAt = publication.scheduledAt;
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    const waitMs = Math.min(60 * 1000, scheduledAt.getTime() - Date.now());
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    // If we waited but it's still not the right time (more than 60s away), re-enqueue.
    if (scheduledAt.getTime() > Date.now() + 1000) {
      // Re-enqueue to be processed again.
      enqueue({ type: "publishing", payload: { publicationId }, maxAttempts: 3 });
      return { ok: true };
    }
  }

  const account = publication.socialAccount;
  const content = publication.content;

  // Mark expired if needed.
  const expired = await markAccountExpiredIfNeeded({
    id: account.id,
    platform: account.platform,
    accountName: account.accountName,
    handle: account.handle,
    externalAccountId: account.externalAccountId,
    tokenExpiry: account.tokenExpiry,
    status: account.status,
  });
  if (expired || account.status === "expired") {
    await db.publication.update({
      where: { id: publicationId },
      data: { status: "failed", error: "Token expiré" },
    });
    await emitPublicationStatus(publication.workspaceId, {
      id: publicationId,
      status: "failed",
      contentId: publication.contentId ?? undefined,
      platform: account.platform,
    });
    return { ok: false, error: "Token expiré", retryable: false };
  }

  const publisher = getPublisher(account.platform);
  if (!publisher) {
    await db.publication.update({
      where: { id: publicationId },
      data: { status: "failed", error: `Aucun publisher pour ${account.platform}` },
    });
    return { ok: false, error: `Aucun publisher pour ${account.platform}`, retryable: false };
  }

  // Move to "publishing" state.
  await db.publication.update({
    where: { id: publicationId },
    data: { status: "publishing" },
  });
  await emitPublicationStatus(publication.workspaceId, {
    id: publicationId,
    status: "publishing",
    contentId: publication.contentId ?? undefined,
    platform: account.platform,
  });

  try {
    const { result, attempts } = await publishWithRetry(
      publisher,
      {
        publicationId,
        contentTitle: content?.title ?? "",
        contentDescription: content?.description,
        contentId: content?.id,
        scheduledAt: publication.scheduledAt,
      },
      {
        id: account.id,
        platform: account.platform,
        accountName: account.accountName,
        handle: account.handle,
        externalAccountId: account.externalAccountId,
        tokenExpiry: account.tokenExpiry,
        status: account.status,
      }
    );

    await db.publication.update({
      where: { id: publicationId },
      data: {
        status: "published",
        externalPostId: result.externalPostId,
        externalPermalink: result.externalPermalink ?? null,
        publishedAt: new Date(),
        attempts,
      },
    });

    await emitPublicationStatus(publication.workspaceId, {
      id: publicationId,
      status: "published",
      contentId: publication.contentId ?? undefined,
      platform: account.platform,
    });

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn("publish:job-failed", { publicationId, error: msg });
    await db.publication.update({
      where: { id: publicationId },
      data: { status: "failed", error: msg },
    });
    await emitPublicationStatus(publication.workspaceId, {
      id: publicationId,
      status: "failed",
      contentId: publication.contentId ?? undefined,
      platform: account.platform,
    });
    const retryable = (e as { retryable?: boolean }).retryable !== false;
    return { ok: false, error: msg, retryable };
  }
}

// ── cancelPublication ────────────────────────────────────────────────

export async function cancelPublication(
  workspaceId: string,
  publicationId: string
): Promise<boolean> {
  const publication = await db.publication.findUnique({ where: { id: publicationId } });
  if (!publication || publication.workspaceId !== workspaceId) return false;
  if (publication.status !== "pending" && publication.status !== "publishing") return false;
  await db.publication.update({
    where: { id: publicationId },
    data: { status: "canceled" },
  });
  await emitPublicationStatus(workspaceId, {
    id: publicationId,
    status: "canceled",
    contentId: publication.contentId ?? undefined,
  });
  return true;
}
