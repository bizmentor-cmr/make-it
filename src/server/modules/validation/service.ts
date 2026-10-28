// Make It — Content Validation domain service (P3).
//
// Workflow stages: draft → pending_cdp → pending_client → validated
//                                                  ↘ refused
//
// `requireClientValidation(workspaceId)` decides whether the CDP validation
// moves the content to `pending_client` (client review required) or directly
// to `validated`. The setting is sourced from the AgencySetting of the agency
// owning the workspace (via AgencyClient.agencyId), with a per-content
// `requireClient` override (set on the ContentValidation row itself).
//
// System messages: on every stage transition, we attempt to post a system
// message to the workspace's primary internal channel (if one exists). The
// P1B messaging system message handler will also pick it up.

import { db } from "@/lib/db";
import { logger } from "@/server/core/logger";
import { audit } from "@/server/core/audit";

export type ValidationStage =
  | "draft"
  | "pending_cdp"
  | "pending_client"
  | "validated"
  | "refused";

export type ContentValidationRow = {
  id: string;
  workspaceId: string;
  contentId: string;
  stage: ValidationStage;
  requireClient: boolean;
  cdpValidatedById: string | null;
  cdpValidatedAt: string | null;
  cdpComment: string | null;
  clientValidatedById: string | null;
  clientValidatedAt: string | null;
  clientComment: string | null;
  refusedAt: string | null;
  refusedBy: string | null;
  refusedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const ALLOWED_STAGES: ValidationStage[] = [
  "draft",
  "pending_cdp",
  "pending_client",
  "validated",
  "refused",
];

function toRow(v: {
  id: string;
  workspaceId: string;
  contentId: string;
  stage: string;
  requireClient: boolean;
  cdpValidatedById: string | null;
  cdpValidatedAt: Date | null;
  cdpComment: string | null;
  clientValidatedById: string | null;
  clientValidatedAt: Date | null;
  clientComment: string | null;
  refusedAt: Date | null;
  refusedBy: string | null;
  refusedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ContentValidationRow {
  return {
    id: v.id,
    workspaceId: v.workspaceId,
    contentId: v.contentId,
    stage: (ALLOWED_STAGES as string[]).includes(v.stage)
      ? (v.stage as ValidationStage)
      : "draft",
    requireClient: v.requireClient,
    cdpValidatedById: v.cdpValidatedById,
    cdpValidatedAt: v.cdpValidatedAt?.toISOString() ?? null,
    cdpComment: v.cdpComment,
    clientValidatedById: v.clientValidatedById,
    clientValidatedAt: v.clientValidatedAt?.toISOString() ?? null,
    clientComment: v.clientComment,
    refusedAt: v.refusedAt?.toISOString() ?? null,
    refusedBy: v.refusedBy,
    refusedReason: v.refusedReason,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

// ─────────────────────────── requireClientValidation ───────────────────────────

// Checks whether the workspace's agency requires client validation.
// Returns true if AgencySetting.requireClientValidation is true for the agency
// owning this workspace. Falls back to false (no client validation) for solo
// workspaces without an agency.
export async function requireClientValidation(workspaceId: string): Promise<boolean> {
  const client = await db.agencyClient.findUnique({
    where: { workspaceId },
    include: {
      agency: { include: { settings: true } },
    },
  });
  if (!client || !client.agency?.settings) return false;
  return client.agency.settings.requireClientValidation;
}

// ─────────────────────────── getValidation ───────────────────────────

// Returns the validation row for a content; creates a default `draft` row if missing.
export async function getValidation(
  contentId: string,
  workspaceId: string
): Promise<ContentValidationRow> {
  // Verify content belongs to the workspace.
  const content = await db.content.findUnique({
    where: { id: contentId },
    select: { workspaceId: true },
  });
  if (!content || content.workspaceId !== workspaceId) {
    throw new Error("Contenu introuvable dans ce workspace");
  }

  const existing = await db.contentValidation.findUnique({ where: { contentId } });
  if (existing) return toRow(existing);

  // Create a default draft row.
  const requireClient = await requireClientValidation(workspaceId);
  const row = await db.contentValidation.create({
    data: {
      workspaceId,
      contentId,
      stage: "draft",
      requireClient,
    },
  });
  return toRow(row);
}

// ─────────────────────────── listPendingValidations ───────────────────────────

export type PendingValidation = ContentValidationRow & {
  contentTitle: string;
  contentStatus: string | null;
};

export async function listPendingValidations(
  workspaceId: string,
  stage?: ValidationStage
): Promise<PendingValidation[]> {
  const where: { workspaceId: string; stage?: ValidationStage } = { workspaceId };
  if (stage) where.stage = stage;
  const rows = await db.contentValidation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  if (rows.length === 0) return [];
  const contentIds = rows.map((r) => r.contentId);
  const contents = await db.content.findMany({
    where: { id: { in: contentIds } },
    select: { id: true, title: true, status: true },
  });
  const contentMap = new Map(contents.map((c) => [c.id, c]));
  const out: PendingValidation[] = [];
  for (const r of rows) {
    const c = contentMap.get(r.contentId);
    if (!c) continue;
    out.push({
      ...toRow(r),
      contentTitle: c.title,
      contentStatus: c.status,
    });
  }
  return out;
}

// ─────────────────────────── submitForCdpValidation ───────────────────────────

// draft → pending_cdp
export async function submitForCdpValidation(
  contentId: string,
  userId: string
): Promise<ContentValidationRow> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) {
    // Lazily create (verifies workspace via getValidation path).
    throw new Error("Validation introuvable — appelez getValidation d'abord");
  }
  if (v.stage !== "draft") {
    throw new Error(`Transition impossible depuis le stage "${v.stage}"`);
  }
  const updated = await db.contentValidation.update({
    where: { contentId },
    data: { stage: "pending_cdp", updatedAt: new Date() },
  });

  await audit({
    workspaceId: v.workspaceId,
    userId,
    action: "validation.submit_cdp",
    entity: "ContentValidation",
    entityId: v.id,
    metadata: { contentId, from: "draft", to: "pending_cdp" },
  });
  await postValidationSystemMessage(v.workspaceId, contentId, "submit_cdp");
  return toRow(updated);
}

// ─────────────────────────── cdpValidate / cdpRefuse ───────────────────────────

// pending_cdp → pending_client (if requireClient) OR → validated.
export async function cdpValidate(
  contentId: string,
  userId: string,
  opts: { comment?: string } = {}
): Promise<ContentValidationRow> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) throw new Error("Validation introuvable");
  if (v.stage !== "pending_cdp") {
    throw new Error(`Transition impossible depuis le stage "${v.stage}"`);
  }
  const requireClient = v.requireClient || (await requireClientValidation(v.workspaceId));
  const nextStage: ValidationStage = requireClient ? "pending_client" : "validated";
  const updated = await db.contentValidation.update({
    where: { contentId },
    data: {
      stage: nextStage,
      cdpValidatedById: userId,
      cdpValidatedAt: new Date(),
      cdpComment: opts.comment ?? null,
      updatedAt: new Date(),
    },
  });
  await audit({
    workspaceId: v.workspaceId,
    userId,
    action: "validation.cdp_validate",
    entity: "ContentValidation",
    entityId: v.id,
    metadata: { contentId, from: "pending_cdp", to: nextStage, comment: opts.comment ?? null },
  });
  await postValidationSystemMessage(
    v.workspaceId,
    contentId,
    nextStage === "validated" ? "cdp_validate_final" : "cdp_validate_to_client"
  );
  return toRow(updated);
}

// pending_cdp → refused
export async function cdpRefuse(
  contentId: string,
  userId: string,
  opts: { reason?: string }
): Promise<ContentValidationRow> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) throw new Error("Validation introuvable");
  if (v.stage !== "pending_cdp") {
    throw new Error(`Transition impossible depuis le stage "${v.stage}"`);
  }
  const updated = await db.contentValidation.update({
    where: { contentId },
    data: {
      stage: "refused",
      refusedAt: new Date(),
      refusedBy: userId,
      refusedReason: opts.reason ?? null,
      updatedAt: new Date(),
    },
  });
  await audit({
    workspaceId: v.workspaceId,
    userId,
    action: "validation.cdp_refuse",
    entity: "ContentValidation",
    entityId: v.id,
    metadata: { contentId, from: "pending_cdp", to: "refused", reason: opts.reason ?? null },
  });
  await postValidationSystemMessage(v.workspaceId, contentId, "cdp_refuse");
  return toRow(updated);
}

// ─────────────────────────── clientValidate / clientRefuse ───────────────────────────

// pending_client → validated
export async function clientValidate(
  contentId: string,
  clientUserId: string,
  opts: { comment?: string } = {}
): Promise<ContentValidationRow> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) throw new Error("Validation introuvable");
  if (v.stage !== "pending_client") {
    throw new Error(`Transition impossible depuis le stage "${v.stage}"`);
  }
  const updated = await db.contentValidation.update({
    where: { contentId },
    data: {
      stage: "validated",
      clientValidatedById: clientUserId,
      clientValidatedAt: new Date(),
      clientComment: opts.comment ?? null,
      updatedAt: new Date(),
    },
  });
  await audit({
    workspaceId: v.workspaceId,
    // NOTE: `clientUserId` references a ClientUser row (not a User row), so we
    // do NOT pass it as `userId` (the AuditLog.userId field has a FK to User).
    // It's preserved in metadata for traceability.
    action: "validation.client_validate",
    entity: "ContentValidation",
    entityId: v.id,
    metadata: { contentId, clientUserId, from: "pending_client", to: "validated", comment: opts.comment ?? null },
  });
  await postValidationSystemMessage(v.workspaceId, contentId, "client_validate");
  return toRow(updated);
}

// pending_client → refused
export async function clientRefuse(
  contentId: string,
  clientUserId: string,
  opts: { reason?: string }
): Promise<ContentValidationRow> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) throw new Error("Validation introuvable");
  if (v.stage !== "pending_client") {
    throw new Error(`Transition impossible depuis le stage "${v.stage}"`);
  }
  const updated = await db.contentValidation.update({
    where: { contentId },
    data: {
      stage: "refused",
      refusedAt: new Date(),
      refusedBy: clientUserId,
      refusedReason: opts.reason ?? null,
      updatedAt: new Date(),
    },
  });
  await audit({
    workspaceId: v.workspaceId,
    // See note in clientValidate — `clientUserId` is a ClientUser id, not a User id.
    action: "validation.client_refuse",
    entity: "ContentValidation",
    entityId: v.id,
    metadata: { contentId, clientUserId, from: "pending_client", to: "refused", reason: opts.reason ?? null },
  });
  await postValidationSystemMessage(v.workspaceId, contentId, "client_refuse");
  return toRow(updated);
}

// ─────────────────────────── isPublishable ───────────────────────────

export async function isPublishable(
  contentId: string,
  workspaceId: string
): Promise<boolean> {
  const v = await db.contentValidation.findUnique({ where: { contentId } });
  if (!v) {
    // No validation row → check if the workspace is agency-managed.
    // For solo workspaces (no agency), publishing is allowed.
    const agencyClient = await db.agencyClient.findUnique({
      where: { workspaceId },
      select: { id: true },
    });
    if (!agencyClient) return true; // solo workspace — no validation required
    // Agency workspace without a validation row: lazily create + draft stage → not publishable.
    await getValidation(contentId, workspaceId);
    return false;
  }
  if (v.workspaceId !== workspaceId) return false;
  return v.stage === "validated";
}

// ─────────────────────────── system message helper ───────────────────────────

const STAGE_MESSAGES: Record<string, (contentId: string) => string> = {
  submit_cdp: () => "Un contenu a été soumis à la validation CDP.",
  cdp_validate_final: () => "Le contenu a été validé par le CDP (prêt à publier).",
  cdp_validate_to_client: () => "Le contenu a été validé par le CDP — en attente du client.",
  cdp_refuse: () => "Le contenu a été refusé par le CDP.",
  client_validate: () => "Le client a validé le contenu (prêt à publier).",
  client_refuse: () => "Le client a refusé le contenu.",
};

// Posts a system message to the workspace's first internal channel (if any).
// P1B's messaging layer will pick up messages from there; we just write the row.
async function postValidationSystemMessage(
  workspaceId: string,
  contentId: string,
  eventKey: string
): Promise<void> {
  try {
    const channel = await db.internalChannel.findFirst({
      where: { workspaceId, type: "channel" },
      orderBy: { createdAt: "asc" },
    });
    if (!channel) return; // no channel — P1B will pick up the audit log instead
    const tpl = STAGE_MESSAGES[eventKey];
    if (!tpl) return;
    const body = `${tpl(contentId)} (contentId=${contentId})`;
    // Find a system user — use the workspace owner as the system poster.
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (!ws) return;
    await db.internalMessage.create({
      data: {
        channelId: channel.id,
        userId: ws.ownerId,
        body,
        attachments: null,
        mentions: null,
      },
    });
    logger.info("validation:system-message", { workspaceId, contentId, eventKey, channelId: channel.id });
  } catch (e) {
    // Non-blocking — system message is best-effort.
    logger.warn("validation:system-message-failed", {
      workspaceId,
      contentId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ─────────────────────────── setting helpers ───────────────────────────

// Returns { requireClientValidation } for the workspace's agency (or false for solo).
export async function getRequireClientSetting(
  workspaceId: string
): Promise<{ requireClientValidation: boolean; hasAgency: boolean }> {
  const client = await db.agencyClient.findUnique({
    where: { workspaceId },
    include: { agency: { include: { settings: true } } },
  });
  if (!client) return { requireClientValidation: false, hasAgency: false };
  return {
    requireClientValidation: client.agency?.settings?.requireClientValidation ?? false,
    hasAgency: true,
  };
}

// Sets the agency's requireClientValidation setting (admin only). The caller
// is responsible for verifying the user is an admin of the agency.
export async function setRequireClientSetting(
  workspaceId: string,
  value: boolean
): Promise<{ requireClientValidation: boolean }> {
  const client = await db.agencyClient.findUnique({
    where: { workspaceId },
    include: { agency: { include: { settings: true } } },
  });
  if (!client) throw new Error("Workspace sans agence");
  const agencyId = client.agencyId;
  if (client.agency?.settings) {
    await db.agencySetting.update({
      where: { agencyId },
      data: { requireClientValidation: value },
    });
  } else {
    await db.agencySetting.create({
      data: { agencyId, requireClientValidation: value },
    });
  }
  await audit({
    workspaceId,
    action: "validation.set_require_client",
    entity: "AgencySetting",
    entityId: agencyId,
    metadata: { agencyId, value },
  });
  return { requireClientValidation: value };
}
