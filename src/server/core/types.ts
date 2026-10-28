// Make It — shared constants & type unions.

export const ROLES = ["owner", "admin", "manager", "creator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  creator: 40,
  viewer: 20,
};

export const PLANS = ["free", "starter", "pro", "business"] as const;
export type Plan = (typeof PLANS)[number];

export const PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "google", "whatsapp"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_TYPES = ["text", "image", "carousel", "video", "reel", "story", "ad"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const OBJECTIVES = ["notoriety", "engagement", "sales", "leads", "traffic", "retention"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const AI_OPERATIONS = [
  "text_generation",
  "image_generation",
  "video_generation",
  "video_analysis",
  "style_analysis",
  "image_edit",
  "video_render",
  "social_adaptation",
  "transcription",
  "chat",
  "embedding",
  "atomize",
  "calendar_generate",
  "message_analysis",
  "report",
  "insight",
  "adapt",
] as const;
export type AIOperation = (typeof AI_OPERATIONS)[number];

export const JOB_STATUSES = ["queued", "started", "analyzing", "generating", "rendering", "validating", "completed", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function jsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function jsonStringify(v: unknown): string {
  return JSON.stringify(v ?? null);
}
