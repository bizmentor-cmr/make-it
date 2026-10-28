// Make It — Publisher abstraction.
// Abstract `Publisher` interface + concrete `MockPublisher` + per-platform
// stub classes (Facebook, Instagram, TikTok, LinkedIn, YouTube, Google,
// WhatsApp) that delegate to the Mock.
//
// Retry policy: 3 attempts, exponential backoff (1s, 2s, 4s).
// Token-expiry handling: if SocialAccount.tokenExpiry < now → mark "expired" and fail gracefully.
//
// REAL OAUTH / PUBLISH SLOTS:
//   - InstagramPublisher → Instagram Graph API /content publishing (token exchange,
//     media container, publish).
//   - FacebookPublisher  → Graph API /feed /photos /videos.
//   - TikTokPublisher    → TikTok Content Posting API (video upload, post).
//   - LinkedInPublisher  → LinkedIn Share API (UGC posts).
//   - YouTubePublisher   → YouTube Data API v3 (videos.insert).
//   - GooglePublisher    → Google Business Profile API (local posts).
//   - WhatsAppPublisher  → WhatsApp Cloud API (messages).

import { logger } from "@/server/core/logger";

export type PublishInput = {
  publicationId: string;
  contentTitle: string;
  contentDescription?: string | null;
  contentId?: string | null;
  scheduledAt?: Date | null;
};

export type SocialAccountInfo = {
  id: string;
  platform: string;
  accountName: string | null;
  handle: string | null;
  externalAccountId: string | null;
  tokenExpiry: Date | null;
  status: string;
};

export type PublishResult = {
  externalPostId: string;
  externalPermalink?: string | null;
};

export type PublishError = {
  kind: "token_expired" | "rate_limited" | "platform_error" | "network" | "unknown";
  message: string;
  retryable: boolean;
};

// Abstract Publisher interface.
export interface Publisher {
  readonly platform: string;
  publish(input: PublishInput, account: SocialAccountInfo): Promise<PublishResult>;
}

// Helper: sleep for backoff.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mock Publisher — generates deterministic mock IDs + permalinks.
export class MockPublisher implements Publisher {
  readonly platform = "mock";

  async publish(input: PublishInput, account: SocialAccountInfo): Promise<PublishResult> {
    // Token-expiry handling: if the account's token has expired, fail gracefully.
    if (account.tokenExpiry && account.tokenExpiry.getTime() < Date.now()) {
      const err: PublishError = {
        kind: "token_expired",
        message: `Token expiré pour ${account.platform} (${account.handle ?? account.id})`,
        retryable: false,
      };
      throw Object.assign(new Error(err.message), err);
    }

    // Mock a tiny bit of latency to simulate a real platform call.
    await sleep(150);

    const externalPostId = `mock_${account.platform}_${input.publicationId.slice(-8)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const handleSlug = (account.handle ?? account.id).replace(/[^a-zA-Z0-9._-]/g, "");
    const externalPermalink = `https://${account.platform}.com/${handleSlug}/posts/${externalPostId}`;

    logger.info("publish:mock", {
      publicationId: input.publicationId,
      platform: account.platform,
      externalPostId,
    });

    return { externalPostId, externalPermalink };
  }
}

// Retry wrapper: 3 attempts, exponential backoff (1s, 2s, 4s).
// If the error is non-retryable (token_expired), fail immediately.
export async function publishWithRetry(
  publisher: Publisher,
  input: PublishInput,
  account: SocialAccountInfo,
  opts: { maxAttempts?: number; backoffMs?: number } = {}
): Promise<{ result: PublishResult; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 1000;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await publisher.publish(input, account);
      return { result, attempts: attempt };
    } catch (e) {
      lastError = e;
      const errKind = (e as PublishError).kind;
      const retryable = (e as PublishError).retryable !== false;
      logger.warn("publish:retry", {
        publicationId: input.publicationId,
        attempt,
        maxAttempts,
        error: e instanceof Error ? e.message : String(e),
        errKind,
      });
      // Non-retryable errors fail immediately.
      if (!retryable || errKind === "token_expired") break;
      // Don't sleep after the last attempt.
      if (attempt < maxAttempts) {
        const delay = backoffMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// Per-platform stub publishers. In production each one would call the
// corresponding platform's Graph/Content/Posting API. For this MVP they all
// delegate to the MockPublisher.
const mock = new MockPublisher();

export class FacebookPublisher implements Publisher {
  readonly platform = "facebook";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: call Graph API /{page-id}/feed or /{page-id}/photos with the page access token.
    return mock.publish(input, account);
  }
}

export class InstagramPublisher implements Publisher {
  readonly platform = "instagram";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: Instagram Content Publishing API — create media container, then publish.
    return mock.publish(input, account);
  }
}

export class TikTokPublisher implements Publisher {
  readonly platform = "tiktok";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: TikTok Content Posting API — video upload + post.
    return mock.publish(input, account);
  }
}

export class LinkedInPublisher implements Publisher {
  readonly platform = "linkedin";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: LinkedIn Share API — UGC posts.
    return mock.publish(input, account);
  }
}

export class YouTubePublisher implements Publisher {
  readonly platform = "youtube";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: YouTube Data API v3 — videos.insert.
    return mock.publish(input, account);
  }
}

export class GooglePublisher implements Publisher {
  readonly platform = "google";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: Google Business Profile API — local posts.
    return mock.publish(input, account);
  }
}

export class WhatsAppPublisher implements Publisher {
  readonly platform = "whatsapp";
  async publish(input: PublishInput, account: SocialAccountInfo) {
    // REAL: WhatsApp Cloud API — messages.
    return mock.publish(input, account);
  }
}

const PUBLISHER_BY_PLATFORM: Record<string, Publisher> = {
  facebook: new FacebookPublisher(),
  instagram: new InstagramPublisher(),
  tiktok: new TikTokPublisher(),
  linkedin: new LinkedInPublisher(),
  youtube: new YouTubePublisher(),
  google: new GooglePublisher(),
  whatsapp: new WhatsAppPublisher(),
};

export function getPublisher(platform: string): Publisher | null {
  return PUBLISHER_BY_PLATFORM[platform] ?? null;
}

// Helper to mark a SocialAccount as expired when token-expiry is detected.
export async function markAccountExpiredIfNeeded(account: SocialAccountInfo): Promise<boolean> {
  if (account.tokenExpiry && account.tokenExpiry.getTime() < Date.now()) {
    // Lazy import to avoid circular dependencies at module load.
    const { db } = await import("@/lib/db");
    await db.socialAccount.update({
      where: { id: account.id },
      data: { status: "expired" },
    });
    return true;
  }
  return false;
}
