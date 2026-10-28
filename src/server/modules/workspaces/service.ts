// Make It — Workspaces domain service.
// Helpers used by the API routes: createWorkspaceWithOwner, inviteMember,
// acceptInvitation, removeMember. All tenant-aware, side-effect-free of HTTP concerns.

import { db } from "@/lib/db";
import { audit } from "@/server/core/audit";
import { ROLES, type Role, jsonStringify } from "@/server/core/types";
import { getWallet } from "@/server/core/credits";

// ─────────────────────────── helpers ───────────────────────────

function slugify(input: string): string {
  const base = (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  return base || "workspace";
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let i = 1;
  while (await db.workspace.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

// ─────────────────────────── createWorkspaceWithOwner ───────────────────────────

export async function createWorkspaceWithOwner(opts: {
  ownerId: string;
  name: string;
  plan?: string;
}): Promise<{
  workspace: { id: string; name: string; slug: string; plan: string };
  membership: { id: string; role: string };
}> {
  const slug = await uniqueSlug(opts.name);
  const plan = opts.plan ?? "free";
  const workspace = await db.workspace.create({
    data: {
      name: opts.name,
      slug,
      ownerId: opts.ownerId,
      plan,
    },
  });
  const membership = await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: opts.ownerId,
      role: "owner",
    },
  });
  // Ensure a wallet exists for the new workspace (default 5000 subscription credits).
  await db.creditWallet.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id, subscriptionCredits: 5000 },
  });
  await audit({
    workspaceId: workspace.id,
    userId: opts.ownerId,
    action: "workspace.create",
    entity: "Workspace",
    entityId: workspace.id,
    metadata: { name: workspace.name, slug: workspace.slug, plan },
  });
  await audit({
    workspaceId: workspace.id,
    userId: opts.ownerId,
    action: "member.add",
    entity: "WorkspaceMember",
    entityId: membership.id,
    metadata: { role: "owner", self: true },
  });
  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, plan: workspace.plan },
    membership: { id: membership.id, role: membership.role },
  };
}

// ─────────────────────────── inviteMember ───────────────────────────

export async function inviteMember(opts: {
  workspaceId: string;
  invitedBy: string;
  email: string;
  role?: Role;
  expiresAt?: Date;
}): Promise<{
  invitation: {
    id: string;
    email: string;
    role: string;
    token: string;
    expiresAt: string;
  };
}> {
  const email = opts.email.toLowerCase().trim();
  if (!email) throw new Error("EMAIL_REQUIRED");
  const role: Role = isRole(opts.role) ? opts.role : "viewer";
  // expires in 7 days by default
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = crypto.randomUUID();

  // If the email is already a member, do not re-invite.
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const existing = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: opts.workspaceId, userId: existingUser.id } },
    });
    if (existing) {
      throw new Error("ALREADY_MEMBER");
    }
  }

  // Reuse any existing non-accepted invitation for the same email+workspace by expiring it
  // (we keep history simple by creating a fresh invitation).
  const invitation = await db.invitation.create({
    data: {
      workspaceId: opts.workspaceId,
      email,
      role,
      token,
      expiresAt,
    },
  });

  await audit({
    workspaceId: opts.workspaceId,
    userId: opts.invitedBy,
    action: "member.invite",
    entity: "Invitation",
    entityId: invitation.id,
    metadata: { email, role, expiresAt: expiresAt.toISOString() },
  });

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  };
}

// ─────────────────────────── acceptInvitation ───────────────────────────

export async function acceptInvitation(opts: {
  token: string;
  userId: string;
  email: string;
}): Promise<{
  workspace: { id: string; name: string; slug: string; plan: string };
  membership: { id: string; role: string };
} | null> {
  const invitation = await db.invitation.findUnique({
    where: { token: opts.token },
    include: { workspace: true },
  });
  if (!invitation) return null;
  if (invitation.acceptedAt) return null;
  if (invitation.expiresAt.getTime() < Date.now()) return null;
  if (invitation.email.toLowerCase().trim() !== opts.email.toLowerCase().trim()) {
    return null;
  }

  // Idempotent: if already a member, just mark accepted.
  const existing = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: opts.userId } },
  });
  let membership = existing;
  if (!existing) {
    membership = await db.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId: opts.userId,
        role: invitation.role as Role,
      },
    });
  }

  await db.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  await audit({
    workspaceId: invitation.workspaceId,
    userId: opts.userId,
    action: "member.accept",
    entity: "Invitation",
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role, membershipId: membership?.id },
  });

  return {
    workspace: {
      id: invitation.workspace.id,
      name: invitation.workspace.name,
      slug: invitation.workspace.slug,
      plan: invitation.workspace.plan,
    },
    membership: {
      id: membership?.id ?? "",
      role: membership?.role ?? invitation.role,
    },
  };
}

// ─────────────────────────── removeMember ───────────────────────────

export async function removeMember(workspaceId: string, memberId: string): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: { id: memberId },
  });
  if (!member || member.workspaceId !== workspaceId) return false;
  if (member.role === "owner") return false;
  await db.workspaceMember.delete({ where: { id: memberId } });
  return true;
}

// ─────────────────────────── getWorkspaceSummary ───────────────────────────

export async function getWorkspaceSummary(workspaceId: string) {
  const wallet = await getWallet(workspaceId);
  const memberCount = await db.workspaceMember.count({ where: { workspaceId } });
  return {
    wallet: {
      subscriptionCredits: wallet.subscriptionCredits,
      purchasedCredits: wallet.purchasedCredits,
      reservedCredits: wallet.reservedCredits,
      totalConsumed: wallet.totalConsumed,
    },
    memberCount,
  };
}

export { jsonStringify };
