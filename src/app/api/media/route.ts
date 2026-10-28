// Make It — GET / POST /api/media
// List media (filter by kind, contentId, paginated); POST upload (multipart/form-data file OR base64 data URL).
// Save under /home/z/my-project/public/uploads/workspace/{workspaceId}/{folder}/{file} and create MediaAsset
// with storagePath = /uploads/workspace/{workspaceId}/{folder}/{file}. Validate MIME allowlist
// (image/*, video/*, audio/*, application/pdf). Enforce per-workspace storage limit from
// SubscriptionPlan.storageLimitMb → 413 if exceeded.

import { NextRequest } from "next/server";
import { ok, unauthorized, forbidden, badRequest, serverError, fail } from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import {
  saveUpload,
  parseDataUrl,
  isMimeAllowed,
  listMedia,
  workspaceStorageBytes,
  workspaceStorageLimitMb,
} from "@/server/modules/media/service";

const ALLOWED_KINDS = new Set(["image", "video", "audio", "doc", "thumb"]);

function parsePositiveInt(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
  const kind = url.searchParams.get("kind");
  const contentId = url.searchParams.get("contentId");
  if (kind && !ALLOWED_KINDS.has(kind)) return badRequest("Kind invalide", { kind });

  const res = await listMedia(ctx.workspaceId, {
    kind: kind ?? undefined,
    contentId: contentId ?? undefined,
    page,
    limit,
  });
  return ok(res.items, {
    page: res.page,
    limit: res.limit,
    total: res.total,
    pages: res.pages,
    workspaceId: ctx.workspaceId,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "creator")) return forbidden("Rôle insuffisant (creator+ requis)");

  const contentType = req.headers.get("content-type") ?? "";

  try {
    let file: { name: string; mime: string; data: Buffer; size?: number };

    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return badRequest("Champ `file` (fichier) requis");
      file = { name: f.name || "upload", mime: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()), size: f.size };
    } else {
      // JSON body: { dataUrl, name? }
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest("Body invalide — multipart/form-data ou JSON { dataUrl } attendu");
      }
      const dataUrl = asString(body.dataUrl);
      if (!dataUrl) return badRequest("Champ `dataUrl` requis pour un upload JSON");
      const parsed = parseDataUrl(dataUrl, asString(body.name) ?? "upload");
      if (!parsed) return badRequest("dataUrl invalide (doit être au format data:<mime>;base64,<...>)");
      file = { name: parsed.name, mime: parsed.mime, data: parsed.data };
    }

    if (!isMimeAllowed(file.mime)) {
      return badRequest(`Type MIME non autorisé: ${file.mime}. Allowed: image/*, video/*, audio/*, application/pdf`);
    }

    // Enforce storage limit
    const limitMb = await workspaceStorageLimitMb(ctx.workspaceId);
    const usedBytes = await workspaceStorageBytes(ctx.workspaceId);
    const limitBytes = limitMb * 1024 * 1024;
    if (usedBytes + (file.size ?? file.data.byteLength) > limitBytes) {
      return fail(`Limite de stockage dépassée (${limitMb} Mo)`, { code: "storage_limit_exceeded", status: 413 });
    }

    const asset = await saveUpload(ctx.workspaceId, file);
    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "media.upload",
      entity: "MediaAsset",
      entityId: asset.id,
      metadata: { filename: asset.filename, mime: asset.mimeType, size: asset.size, kind: asset.kind },
      ip: clientIp(req),
    });
    return ok(asset, { created: true, storageMb: limitMb, usedBytes }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError("Échec de l'upload média", { error: msg });
  }
}
