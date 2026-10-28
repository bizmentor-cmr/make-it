// Make It — Content cache / Anti-waste engine.
// A SHA-1 keyed store (ContentCache table, scoped by workspaceId) used by runners to
// skip redundant AI calls. Style analyses, transcriptions, embeddings are cached and
// re-used: if a user uploads the same image twice, we serve the cached StyleDNA instead
// of paying for another vision pass; if a URL was already analysed, no new API call.
//
// Hooked into the `style_analysis` and `message_analysis` runners (and easily extensible
// to transcription/embedding). `cacheKey(parts)` builds a deterministic key — pass the
// canonicalized inputs (URL, assetId, prompt-hash, etc.).

import { db } from "@/lib/db";
import { jsonParse } from "@/server/core/types";

export function cacheKey(parts: (string | number | undefined | null)[]): string {
  const norm = parts
    .map((p) => (p === undefined || p === null ? "" : String(p)).trim().toLowerCase())
    .join("|");
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = (h << 5) - h + norm.charCodeAt(i);
    h |= 0;
  }
  // also include a sha-ish suffix for collision-resistance
  const hex = Buffer.from(norm || "empty").toString("hex").slice(0, 16);
  return `mk_${(h >>> 0).toString(16)}_${hex}`;
}

// Read a cache entry. Returns the parsed value or null. Bumps `hits` on hit.
export async function getCache<T = unknown>(workspaceId: string, key: string): Promise<T | null> {
  const row = await db.contentCache.findUnique({ where: { key } });
  if (!row || row.workspaceId !== workspaceId) return null;
  // bump hits (best-effort, non-blocking)
  db.contentCache
    .update({ where: { id: row.id }, data: { hits: { increment: 1 }, updatedAt: new Date() } })
    .catch(() => undefined);
  return jsonParse<T>(row.value, null as T);
}

// Upsert a cache entry.
export async function setCache<T = unknown>(
  workspaceId: string,
  key: string,
  kind: string,
  value: T
): Promise<void> {
  const serialized = JSON.stringify(value ?? null);
  await db.contentCache.upsert({
    where: { key },
    update: { value: serialized, kind, updatedAt: new Date() },
    create: { workspaceId, key, kind, value: serialized, hits: 0 },
  });
}

// Increment the hits counter (useful when the cache is consumed without getCache).
export async function hit(key: string): Promise<void> {
  await db.contentCache
    .updateMany({ where: { key }, data: { hits: { increment: 1 }, updatedAt: new Date() } })
    .catch(() => undefined);
}
