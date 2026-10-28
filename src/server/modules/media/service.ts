// Make It — Media domain service.
// `saveUpload(workspaceId, file)` — saves a multipart/base64 file under
// `/home/z/my-project/public/uploads/workspace/{workspaceId}/{folder}/{file}` and creates MediaAsset
// with storagePath = `/uploads/workspace/{workspaceId}/{folder}/{file}`.
// `ensureFolder(path)` — mkdir -p.
// `computeMediaType(mime)` — image | video | audio | doc | thumb.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export const UPLOAD_ROOT = path.resolve(process.cwd(), "public/uploads");
export const PUBLIC_PREFIX = "/uploads";

export type MediaKind = "image" | "video" | "audio" | "doc" | "thumb";

// Map MIME → kind + folder name (Section 16 layout: brand | images | videos | audio | styles | templates | exports)
export function computeMediaType(mime: string): { kind: MediaKind; folder: string } {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return { kind: "image", folder: "images" };
  if (m.startsWith("video/")) return { kind: "video", folder: "videos" };
  if (m.startsWith("audio/")) return { kind: "audio", folder: "audio" };
  if (m === "application/pdf") return { kind: "doc", folder: "templates" };
  // Fallback for other doc MIME types
  if (m.startsWith("application/") || m.startsWith("text/")) return { kind: "doc", folder: "templates" };
  return { kind: "doc", folder: "templates" };
}

const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/", "application/pdf"];
const ALLOWED_MIME_EXTRA = ["application/octet-stream"]; // some browsers send this for binaries

export function isMimeAllowed(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p)) ||
    ALLOWED_MIME_EXTRA.includes(m)
  );
}

export async function ensureFolder(absPath: string): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
}

// Sanitize a filename: replace unsafe chars, keep extension.
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || "file");
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.length > 80 ? safe.slice(-80) : safe;
}

// Build a unique filename: prefix with date + short uuid to avoid collisions.
export function buildUniqueFilename(original: string): string {
  const safe = sanitizeFilename(original);
  const ext = path.extname(safe) || "";
  const stem = path.basename(safe, ext) || "file";
  const uid = randomUUID().slice(0, 8);
  const date = new Date().toISOString().slice(0, 10);
  return `${date}_${stem}_${uid}${ext}`.toLowerCase();
}

// Compute total storage used (bytes) by the workspace's media.
export async function workspaceStorageBytes(workspaceId: string): Promise<number> {
  const rows = await db.mediaAsset.findMany({
    where: { workspaceId },
    select: { size: true },
  });
  return rows.reduce((acc, r) => acc + (r.size ?? 0), 0);
}

export async function workspaceStorageLimitMb(workspaceId: string): Promise<number> {
  // Pull the workspace's plan from the Subscription relation; default to free plan limits.
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { subscription: { include: { plan: true } } },
  });
  const planName = ws?.subscription?.plan?.name ?? ws?.plan ?? "free";
  const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
  return plan?.storageLimitMb ?? 500;
}

// Save a file (Buffer) coming from a multipart upload or a base64 data URL.
// Returns the MediaAsset row.
export async function saveUpload(
  workspaceId: string,
  file: { name: string; mime: string; data: Buffer; size?: number }
) {
  if (!isMimeAllowed(file.mime)) {
    throw new Error(`MIME type not allowed: ${file.mime}`);
  }
  const { kind, folder } = computeMediaType(file.mime);
  const relFolder = path.join("workspace", workspaceId, folder);
  const absFolder = path.join(UPLOAD_ROOT, relFolder);
  await ensureFolder(absFolder);

  const uniqueName = buildUniqueFilename(file.name);
  const absPath = path.join(absFolder, uniqueName);
  await fs.writeFile(absPath, file.data);

  const storagePath = `${PUBLIC_PREFIX}/${relFolder.replace(/\\/g, "/")}/${uniqueName}`;
  const size = file.size ?? file.data.byteLength;

  const asset = await db.mediaAsset.create({
    data: {
      workspaceId,
      kind,
      filename: uniqueName,
      mimeType: file.mime,
      size,
      storagePath,
      metadata: JSON.stringify({ originalName: file.name }),
    },
  });
  return asset;
}

// Parse a data URL (e.g. `data:image/png;base64,...`) into a Buffer + mime + name.
export function parseDataUrl(dataUrl: string, fallbackName = "upload"): { data: Buffer; mime: string; name: string } | null {
  // Use a non-flagged regex so we're compatible with the project's tsconfig target.
  const m = /^data:([^;]+);base64,(.*)$/m.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] ?? "application/octet-stream";
  const base64 = m[2] ?? "";
  // Strip any whitespace/newlines that may have slipped in.
  const cleanBase64 = base64.replace(/\s+/g, "");
  const data = Buffer.from(cleanBase64, "base64");
  const extByMime: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  const ext = extByMime[mime] ?? "";
  return { data, mime, name: `${fallbackName}${ext}` };
}

// List media with optional filters (kind, contentId) + pagination.
export async function listMedia(workspaceId: string, filters: { kind?: string; contentId?: string; page: number; limit: number }) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters.kind) where.kind = filters.kind;
  if (filters.contentId) where.contentId = filters.contentId;
  const [total, items] = await Promise.all([
    db.mediaAsset.count({ where }),
    db.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return { items, total, page: filters.page, limit: filters.limit, pages: Math.max(1, Math.ceil(total / filters.limit)) };
}

export async function getMedia(workspaceId: string, id: string) {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.workspaceId !== workspaceId) return null;
  return asset;
}

export async function deleteMedia(workspaceId: string, id: string): Promise<boolean> {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.workspaceId !== workspaceId) return false;
  // Best-effort delete file
  try {
    const abs = path.join(UPLOAD_ROOT, asset.storagePath.replace(PUBLIC_PREFIX, ""));
    await fs.unlink(abs);
  } catch {
    // ignore — file may already be gone
  }
  await db.mediaAsset.delete({ where: { id } });
  return true;
}
