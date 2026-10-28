// Make It — White-Label Reports service (P4).
//
// Builds on top of the existing report generation pipeline (LLM "report" prompt
// via `/api/reports/generate` + the `report` AIJob runner) but wraps the output
// in a branding envelope (logo, colors, agency/client name) and stores a
// `WhiteLabelReport` row. The agency can edit the content before export.
//
// For the MVP, "PDF export" returns a printable HTML page (the agency can use
// the browser's "Print to PDF" — this avoids heavy PDF dependencies). The
// `exportWhiteLabelReportHtml` function returns the full HTML document string.

import { db } from "@/lib/db";
import { audit } from "@/server/core/audit";
import { logger } from "@/server/core/logger";
import { jsonStringify, jsonParse } from "@/server/core/types";
import {
  computeScores,
} from "@/server/modules/insights/performance";
import { aggregateAnalytics } from "@/server/modules/analytics/service";
import { textChat } from "@/server/core/ai";
import { getPrompt, renderTemplate } from "@/server/core/prompts";
import { getClientBranding, type ClientBrandingRow } from "@/server/modules/agency/clients";

// ─────────────────────────── types ───────────────────────────

export type WhiteLabelReportType = "weekly" | "monthly" | "campaign";

export const WHITE_LABEL_REPORT_TYPES: readonly WhiteLabelReportType[] = [
  "weekly",
  "monthly",
  "campaign",
] as const;

export type WhiteLabelBranding = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  font?: string | null;
  agencyName?: string | null;
  clientName?: string | null;
};

export type WhiteLabelReportContent = {
  title: string;
  periodLabel?: string | null;
  commentary?: string | null;
  recommendations?: string[] | null;
  working?: string[] | null;
  declining?: string[] | null;
  growing?: string[] | null;
  toChange?: string[] | null;
  actions?: Array<{ title?: string; cta?: string }> | null;
  rawBody?: string | null;
  metrics?: Record<string, unknown> | null;
  score?: { total: number; delta: number } | null;
};

export type WhiteLabelReportRow = {
  id: string;
  workspaceId: string;
  agencyId: string | null;
  type: WhiteLabelReportType;
  branding: WhiteLabelBranding;
  content: WhiteLabelReportContent;
  pdfUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function isReportType(v: unknown): v is WhiteLabelReportType {
  return typeof v === "string" && (WHITE_LABEL_REPORT_TYPES as readonly string[]).includes(v);
}

function toRow(r: {
  id: string;
  workspaceId: string;
  agencyId: string | null;
  type: string;
  branding: string | null;
  content: string | null;
  pdfUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): WhiteLabelReportRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    agencyId: r.agencyId,
    type: isReportType(r.type) ? r.type : "monthly",
    branding: jsonParse<WhiteLabelBranding>(r.branding ?? "{}", {}),
    content: jsonParse<WhiteLabelReportContent>(
      r.content ?? "{}",
      { title: "Rapport" }
    ),
    pdfUrl: r.pdfUrl,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─────────────────────────── helpers ───────────────────────────

// Resolves the agency id + client name for a workspace.
async function resolveAgencyAndClient(workspaceId: string): Promise<{
  agencyId: string | null;
  clientName: string;
  agencyName: string | null;
  branding: ClientBrandingRow;
}> {
  const agencyClient = await db.agencyClient.findUnique({
    where: { workspaceId },
    include: {
      agency: { select: { id: true, name: true } },
      workspace: { select: { name: true } },
    },
  });
  const branding = await getClientBranding(agencyClient?.id ?? "");
  return {
    agencyId: agencyClient?.agency.id ?? null,
    clientName: agencyClient?.workspace.name ?? "Client",
    agencyName: agencyClient?.agency.name ?? null,
    branding,
  };
}

// Lenient JSON parse (mirrors the runner's parseLenient — used because the LLM
// report output may be plain text or a partial JSON object).
function parseLenient<T = unknown>(raw: string): T | string {
  if (!raw) return "" as unknown as T;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      try {
        return JSON.parse(s.slice(i)) as T;
      } catch {
        continue;
      }
    }
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return s as unknown as T;
  }
}

// ─────────────────────────── generateWhiteLabelReport ───────────────────────────

// Generates a white-label report for a workspace. Uses the existing report
// LLM prompt (synchronous call — no AIJob for the MVP; agencies typically
// generate one report per client per month). Stores the result wrapped in a
// branding envelope as a `WhiteLabelReport` row.
//
// The `agencyId` arg is optional — passed by the agency-side API route after
// RBAC verification. If omitted, we resolve it from the workspace's agency.
export async function generateWhiteLabelReport(
  workspaceId: string,
  agencyId?: string | null,
  opts: {
    type?: WhiteLabelReportType;
    branding?: WhiteLabelBranding;
    generatedBy?: string; // user id (audit)
  } = {}
): Promise<WhiteLabelReportRow> {
  const type: WhiteLabelReportType = opts.type && isReportType(opts.type) ? opts.type : "monthly";

  // Resolve agency + client + default branding.
  const meta = await resolveAgencyAndClient(workspaceId);
  const resolvedAgencyId = agencyId ?? meta.agencyId;

  // Branding envelope: passed-in overrides > client's persistent branding > defaults.
  const baseBranding: WhiteLabelBranding = {
    logoUrl: meta.branding.logoUrl,
    primaryColor: meta.branding.primaryColor,
    secondaryColor: meta.branding.secondaryColor,
    font: meta.branding.font,
    agencyName: meta.branding.agencyName ?? meta.agencyName,
    clientName: meta.clientName,
  };
  const branding: WhiteLabelBranding = { ...baseBranding, ...(opts.branding ?? {}) };

  // Build the LLM input — same shape as the report runner.
  const period = type === "weekly" ? "7j" : type === "monthly" ? "30j" : "campaign";
  const days = type === "weekly" ? 7 : 30;

  const [analytics, score] = await Promise.all([
    aggregateAnalytics(workspaceId, days).catch(() => null),
    computeScores(workspaceId).catch(() => ({ total: 0, delta: 0, subscores: [] })),
  ]);

  const metricsStr = analytics
    ? jsonStringify({
        impressions: analytics.metrics.impressions,
        reach: analytics.metrics.reach,
        engagement: analytics.metrics.engagement,
        clicks: analytics.metrics.clicks,
        conversions: analytics.metrics.conversions,
        revenueCents: analytics.metrics.revenueCents,
        followers: analytics.metrics.followers,
        engagementRate: analytics.metrics.engagementRate,
        ctr: analytics.metrics.ctr,
        byPlatform: analytics.byPlatform.map((p) => ({
          platform: p.platform,
          impressions: p.metrics.impressions,
          engagement: p.metrics.engagement,
        })),
      })
    : "{}";

  // Run the LLM report generation (synchronous — MVP).
  let rawOutput = "";
  let parsed: {
    working?: string[];
    declining?: string[];
    growing?: string[];
    toChange?: string[];
    actions?: Array<{ title?: string; cta?: string }>;
  } = { working: [], declining: [], growing: [], toChange: [], actions: [] };

  try {
    const tpl = await getPrompt("report", workspaceId);
    const user = tpl?.userTemplate
      ? renderTemplate(tpl.userTemplate, {
          period,
          metrics: metricsStr,
          top: "[]",
          flops: "[]",
        })
      : `Période : ${period}\nMétriques : ${metricsStr}\nTop contenus : []\nFlops : []`;
    const res = await textChat({
      system: tpl?.systemPrompt ?? "Tu rédiges un rapport marketing clair et concis en français.",
      messages: [{ role: "user", content: user }],
    });
    rawOutput = res.content ?? "";
    const p = parseLenient<{
      working?: string[];
      declining?: string[];
      growing?: string[];
      toChange?: string[];
      actions?: Array<{ title?: string; cta?: string }>;
    }>(rawOutput);
    if (typeof p !== "string") {
      parsed = {
        working: Array.isArray(p.working) ? p.working : [],
        declining: Array.isArray(p.declining) ? p.declining : [],
        growing: Array.isArray(p.growing) ? p.growing : [],
        toChange: Array.isArray(p.toChange) ? p.toChange : [],
        actions: Array.isArray(p.actions) ? p.actions : [],
      };
    }
  } catch (e) {
    logger.warn("white-label:llm-failed", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    rawOutput = "Rapport basé sur les données analytiques (génération LLM indisponible).";
  }

  // Build the editable content body.
  const clientName = meta.clientName;
  const now = new Date();
  const periodLabel =
    type === "weekly"
      ? `Semaine du ${new Date(now.getTime() - 7 * 86400000).toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")}`
      : type === "campaign"
      ? `Campagne — ${now.toLocaleDateString("fr-FR")}`
      : `Mois du ${new Date(now.getTime() - 30 * 86400000).toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")}`;

  const title = type === "weekly"
    ? `Rapport hebdomadaire — ${clientName}`
    : type === "campaign"
    ? `Rapport de campagne — ${clientName}`
    : `Rapport mensuel — ${clientName}`;

  // Compose a commentary paragraph (LLM-derived or fallback heuristic).
  const commentary =
    rawOutput && rawOutput.length > 0 && rawOutput.length < 5000 && !rawOutput.startsWith("Rapport basé")
      ? rawOutput.split(/\n\s*\n/)[0] ?? rawOutput.slice(0, 600)
      : `Sur la période ${periodLabel.toLowerCase()}, le Make It Score de ${clientName} est de ${score.total}/100 (${score.delta >= 0 ? "+" : ""}${score.delta}% vs période précédente). ${
          (analytics?.metrics.impressions ?? 0) > 0
            ? `${analytics!.metrics.impressions.toLocaleString("fr-FR")} impressions, ${analytics!.metrics.engagement.toLocaleString("fr-FR")} engagements.`
            : "Aucune donnée analytique sur la période — basé sur l'activité éditoriale."
        }`;

  const recommendations =
    parsed.actions && parsed.actions.length > 0
      ? parsed.actions.map((a) => a.title ?? a.cta ?? "Action").filter(Boolean)
      : parsed.toChange && parsed.toChange.length > 0
      ? parsed.toChange
      : ["Maintenir le rythme éditorial", "Renforcer le format le plus performant", "Activer un CTA WhatsApp sur les top posts"];

  const content: WhiteLabelReportContent = {
    title,
    periodLabel,
    commentary,
    recommendations,
    working: parsed.working,
    declining: parsed.declining,
    growing: parsed.growing,
    toChange: parsed.toChange,
    actions: parsed.actions,
    rawBody: rawOutput,
    metrics: analytics
      ? {
          impressions: analytics.metrics.impressions,
          reach: analytics.metrics.reach,
          engagement: analytics.metrics.engagement,
          clicks: analytics.metrics.clicks,
          conversions: analytics.metrics.conversions,
          revenueCents: analytics.metrics.revenueCents,
          followers: analytics.metrics.followers,
          engagementRate: analytics.metrics.engagementRate,
          ctr: analytics.metrics.ctr,
        }
      : null,
    score: { total: score.total, delta: score.delta },
  };

  const row = await db.whiteLabelReport.create({
    data: {
      workspaceId,
      agencyId: resolvedAgencyId,
      type,
      branding: jsonStringify(branding),
      content: jsonStringify(content),
      status: "generated",
    },
  });

  await audit({
    workspaceId,
    userId: opts.generatedBy,
    action: "white_label_report.generate",
    entity: "WhiteLabelReport",
    entityId: row.id,
    metadata: { type, agencyId: resolvedAgencyId, clientName },
  });

  return toRow(row);
}

// ─────────────────────────── get / list / update ───────────────────────────

export async function getWhiteLabelReport(
  workspaceId: string,
  id: string
): Promise<WhiteLabelReportRow | null> {
  const row = await db.whiteLabelReport.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) return null;
  return toRow(row);
}

export async function listWhiteLabelReports(
  workspaceId: string,
  opts: { type?: string; limit?: number } = {}
): Promise<WhiteLabelReportRow[]> {
  const where: { workspaceId: string; type?: string } = { workspaceId };
  if (opts.type && isReportType(opts.type)) where.type = opts.type;
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)));
  const rows = await db.whiteLabelReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}

export async function updateWhiteLabelReport(
  workspaceId: string,
  id: string,
  patch: {
    content?: Partial<WhiteLabelReportContent>;
    branding?: Partial<WhiteLabelBranding>;
  },
  opts: { updatedBy?: string } = {}
): Promise<WhiteLabelReportRow> {
  const existing = await db.whiteLabelReport.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new Error("REPORT_NOT_FOUND");
  }
  const data: { content?: string; branding?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.content) {
    const current = jsonParse<WhiteLabelReportContent>(existing.content ?? "{}", { title: "Rapport" });
    const merged: WhiteLabelReportContent = { ...current, ...patch.content };
    data.content = jsonStringify(merged);
  }
  if (patch.branding) {
    const current = jsonParse<WhiteLabelBranding>(existing.branding ?? "{}", {});
    const merged: WhiteLabelBranding = { ...current, ...patch.branding };
    data.branding = jsonStringify(merged);
  }
  const updated = await db.whiteLabelReport.update({ where: { id }, data });
  await audit({
    workspaceId,
    userId: opts.updatedBy,
    action: "white_label_report.update",
    entity: "WhiteLabelReport",
    entityId: id,
    metadata: {
      changedContent: !!patch.content,
      changedBranding: !!patch.branding,
    },
  });
  return toRow(updated);
}

export async function deleteWhiteLabelReport(
  workspaceId: string,
  id: string,
  opts: { deletedBy?: string } = {}
): Promise<{ deleted: boolean; id: string }> {
  const existing = await db.whiteLabelReport.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new Error("REPORT_NOT_FOUND");
  }
  await db.whiteLabelReport.delete({ where: { id } });
  await audit({
    workspaceId,
    userId: opts.deletedBy,
    action: "white_label_report.delete",
    entity: "WhiteLabelReport",
    entityId: id,
  });
  return { deleted: true, id };
}

// ─────────────────────────── export (printable HTML) ───────────────────────────

// Returns a full HTML document for the report — printable via the browser's
// "Print to PDF" dialog. The MVP doesn't bundle a PDF library; the agency opens
// this HTML in a new tab and prints it.
export function exportWhiteLabelReportHtml(report: WhiteLabelReportRow): string {
  const b = report.branding;
  const c = report.content;
  const primary = b.primaryColor || "#7c3aed";
  const secondary = b.secondaryColor || "#10b981";
  const agencyName = b.agencyName || "Make It for Agencies";
  const clientName = b.clientName || "Client";
  const logoHtml = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(agencyName)}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="font-weight:700;font-size:1.25rem;color:${escapeHtml(primary)};">${escapeHtml(agencyName)}</div>`;

  const renderList = (label: string, items: string[] | null | undefined, color: string) => {
    if (!items || items.length === 0) return "";
    return `
      <section style="margin-top:24px;">
        <h3 style="color:${escapeHtml(color)};font-size:1rem;margin:0 0 8px 0;">${escapeHtml(label)}</h3>
        <ul style="margin:0;padding-left:20px;line-height:1.6;">
          ${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
        </ul>
      </section>`;
  };

  const renderActions = (actions: Array<{ title?: string; cta?: string }> | null | undefined) => {
    if (!actions || actions.length === 0) return "";
    return `
      <section style="margin-top:24px;">
        <h3 style="color:${escapeHtml(primary)};font-size:1rem;margin:0 0 8px 0;">Plan d'action</h3>
        <ol style="margin:0;padding-left:20px;line-height:1.6;">
          ${actions
            .map(
              (a) =>
                `<li>${escapeHtml(a.title ?? "")}${
                  a.cta ? ` — <em style="color:${escapeHtml(secondary)};">${escapeHtml(a.cta)}</em>` : ""
                }</li>`
            )
            .join("")}
        </ol>
      </section>`;
  };

  const renderMetrics = (m: Record<string, unknown> | null | undefined) => {
    if (!m) return "";
    const labels: Record<string, string> = {
      impressions: "Impressions",
      reach: "Portée",
      engagement: "Engagements",
      clicks: "Clics",
      conversions: "Conversions",
      followers: "Nouveaux abonnés",
      revenueCents: "Revenu (€)",
    };
    const tiles = Object.entries(labels)
      .map(([k, label]) => {
        const v = (m as Record<string, unknown>)[k];
        if (typeof v !== "number") return "";
        const display = k === "revenueCents" ? (v / 100).toFixed(2) + " €" : v.toLocaleString("fr-FR");
        return `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;flex:1;min-width:120px;">
            <div style="font-size:0.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
            <div style="font-size:1.25rem;font-weight:600;color:#111827;margin-top:4px;">${display}</div>
          </div>`;
      })
      .filter(Boolean)
      .join("");
    if (!tiles) return "";
    return `
      <section style="margin-top:24px;">
        <h3 style="color:${escapeHtml(primary)};font-size:1rem;margin:0 0 8px 0;">Métriques clés</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${tiles}</div>
      </section>`;
  };

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(c.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ${b.font ? `'${escapeHtml(b.font)}', ` : ""}system-ui, -apple-system, sans-serif; margin: 0; padding: 32px; color: #111827; background: #fff; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 2px solid ${escapeHtml(primary)}; }
    .header .agency { display: flex; align-items: center; gap: 12px; }
    .header .client { text-align: right; }
    .header .client .name { font-weight: 600; font-size: 1rem; }
    .header .client .period { font-size: 0.8rem; color: #6b7280; }
    .title { font-size: 1.875rem; font-weight: 700; color: ${escapeHtml(primary)}; margin: 24px 0 4px 0; }
    .subtitle { font-size: 0.875rem; color: #6b7280; margin-bottom: 16px; }
    .commentary { font-size: 1rem; line-height: 1.7; color: #111827; padding: 16px; background: #f9fafb; border-left: 4px solid ${escapeHtml(secondary)}; border-radius: 6px; }
    .score-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: ${escapeHtml(primary)}; color: #fff; border-radius: 999px; font-size: 0.875rem; font-weight: 600; margin-top: 8px; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280; text-align: center; }
    .actions { margin-top: 24px; }
    .print-btn { position: fixed; top: 16px; right: 16px; background: ${escapeHtml(primary)}; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Imprimer / PDF</button>
  <div class="header">
    <div class="agency">${logoHtml}</div>
    <div class="client">
      <div class="name">${escapeHtml(clientName)}</div>
      ${c.periodLabel ? `<div class="period">${escapeHtml(c.periodLabel)}</div>` : ""}
      ${c.score ? `<div class="score-badge">Make It Score: ${c.score.total}/100 ${c.score.delta >= 0 ? "+" : ""}${c.score.delta}%</div>` : ""}
    </div>
  </div>

  <h1 class="title">${escapeHtml(c.title)}</h1>
  <div class="subtitle">Rapport ${escapeHtml(report.type === "weekly" ? "hebdomadaire" : report.type === "campaign" ? "de campagne" : "mensuel")} • Généré le ${new Date(report.createdAt).toLocaleDateString("fr-FR")}</div>

  ${c.commentary ? `<div class="commentary">${escapeHtml(c.commentary).replace(/\n/g, "<br/>")}</div>` : ""}

  ${renderMetrics(c.metrics ?? null)}
  ${renderList("Ce qui fonctionne", c.working, secondary)}
  ${renderList("Ce qui décline", c.declining, "#ef4444")}
  ${renderList("Ce qui progresse", c.growing, secondary)}
  ${renderList("À ajuster", c.toChange, "#f59e0b")}

  ${
    c.recommendations && c.recommendations.length > 0
      ? `
    <section style="margin-top:24px;">
      <h3 style="color:${escapeHtml(primary)};font-size:1rem;margin:0 0 8px 0;">Recommandations</h3>
      <ul style="margin:0;padding-left:20px;line-height:1.6;">
        ${c.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
    </section>`
      : ""
  }

  ${renderActions(c.actions ?? null)}

  <div class="footer">
    Rapport généré par ${escapeHtml(agencyName)} • ${escapeHtml(clientName)} • ${new Date().toLocaleDateString("fr-FR")}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
