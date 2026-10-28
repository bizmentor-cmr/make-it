// Make It — Audit log helper.

import { db } from "@/lib/db";

export async function audit(opts: {
  workspaceId?: string;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: opts.workspaceId,
        userId: opts.userId,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        ip: opts.ip,
      },
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
