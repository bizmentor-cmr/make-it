// Make It — POST /api/analytics/ingest
// Ingest raw analytics into the unified AnalyticsSnapshot table.
//
// Accepts two body shapes:
//   1. { source: "api"|"csv"|"json"|"manual", platform?: string, rows: RawRow[] }
//   2. { source: "csv", platform?: string, csv: "date,reach,impressions,...\n..." }
//
// Raw rows are normalized via the connector `normalize()` mapping and then
// upserted (findFirst + create|update) into AnalyticsSnapshot scoped to the
// active workspace. manager+ allowed. Returns the count ingested + skipped.
//
// In the real product, this endpoint is hit by:
//   - Manual CSV uploads (source: "csv")
//   - JSON payloads from scheduled jobs (source: "json")
//   - Manual entry (source: "manual")
//   - Connector jobs that call MetaConnector / TikTokConnector / GA4Connector
//     / GoogleBusinessConnector and POST the normalized rows here (source: "api").

import { NextRequest } from "next/server";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/server/core/api-response";
import { getSessionUser } from "@/server/core/auth";
import { resolveWorkspace, hasRole } from "@/server/core/rbac";
import { audit } from "@/server/core/audit";
import { PLATFORMS } from "@/server/core/types";
import {
  normalize,
  type RawRow,
  type Row,
} from "@/server/modules/analytics/connectors";
import { ingestRows } from "@/server/modules/analytics/service";

const PLATFORM_SET = new Set<string>(PLATFORMS);
const SOURCES = new Set(["api", "csv", "json", "manual"]);

function clientIp(req: NextRequest | Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? undefined;
}

// ─── simple CSV parser ─────────────────────────────────────────────────────
// Supports a flat header + comma-separated rows. No quoting / escaping.
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    out.push(row);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ctx = await resolveWorkspace(req);
  if (!ctx) return forbidden("Aucun workspace actif");
  if (!hasRole(ctx, "manager")) return forbidden("Rôle insuffisant");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("JSON invalide");
  }

  const source = typeof body.source === "string" ? body.source.trim().toLowerCase() : "";
  if (!SOURCES.has(source)) {
    return badRequest("source invalide (api|csv|json|manual)", { source });
  }

  // Optional global platform stamp — applied to rows that don't carry their own.
  let platform: string | null = null;
  if (typeof body.platform === "string") {
    const p = body.platform.trim().toLowerCase();
    if (p.length > 0) {
      if (!PLATFORM_SET.has(p)) {
        return badRequest("Plateforme invalide", { platform: p });
      }
      platform = p;
    }
  }

  // Build the raw rows list.
  let rawRows: RawRow[] = [];
  if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    if (source !== "csv" && source !== "json") {
      return badRequest("Le champ `csv` n'est valable que pour source=csv|json", {
        source,
      });
    }
    rawRows = parseCsv(body.csv) as RawRow[];
  } else if (Array.isArray(body.rows)) {
    rawRows = body.rows as RawRow[];
  } else {
    return badRequest("`rows` (tableau) ou `csv` (chaîne) requis");
  }

  if (rawRows.length === 0) {
    return badRequest("Aucune ligne à ingérer");
  }

  // Normalize each raw row, then stamp platform if missing.
  const rows: Row[] = rawRows.map((r) => {
    const hasOwnPlatform =
      typeof r.platform === "string" && (r.platform as string).trim().length > 0;
    return normalize(r, hasOwnPlatform ? null : platform);
  });

  try {
    const result = await ingestRows(ctx.workspaceId, source, rows);

    await audit({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      action: "analytics.ingest",
      entity: "AnalyticsSnapshot",
      metadata: {
        source,
        platform,
        ingested: result.ingested,
        skipped: result.skipped,
        created: result.created,
        upserted: result.upserted,
      },
      ip: clientIp(req),
    });

    return ok(
      { ingested: result.ingested, skipped: result.skipped },
      {
        source,
        platform,
        rowsProvided: rawRows.length,
        created: result.created,
        upserted: result.upserted,
        workspaceId: ctx.workspaceId,
      }
    );
  } catch (e) {
    return serverError("Impossible d'ingérer les analytics", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
