// Make It — AI Memory service.
// Workspace-scoped facts / learnings / history (WorkspaceMemory row, JSON columns).
// NEVER cross workspaces.

import { db } from "@/lib/db";
import { jsonParse, jsonStringify } from "@/server/core/types";

export type MemoryFact = {
  type: string;
  value: string;
  source: string;
  createdAt: string; // ISO
};

export type WorkspaceMemoryRow = {
  workspaceId: string;
  facts: MemoryFact[];
  learnings: string[];
  history: Array<Record<string, unknown>>;
  updatedAt: Date;
};

function toRow(m: {
  workspaceId: string;
  facts: string | null;
  learnings: string | null;
  history: string | null;
  updatedAt: Date;
}): WorkspaceMemoryRow {
  return {
    workspaceId: m.workspaceId,
    facts: jsonParse<MemoryFact[]>(m.facts, []),
    learnings: jsonParse<string[]>(m.learnings, []),
    history: jsonParse<Array<Record<string, unknown>>>(m.history, []),
    updatedAt: m.updatedAt,
  };
}

export async function getMemory(workspaceId: string): Promise<WorkspaceMemoryRow> {
  const m = await db.workspaceMemory.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId, facts: "[]", learnings: "[]", history: "[]" },
  });
  return toRow(m);
}

export async function addFact(
  workspaceId: string,
  fact: { type: string; value: string; source: string }
): Promise<WorkspaceMemoryRow> {
  if (!fact.value || !fact.value.trim()) throw new Error("Valeur de fait requise");
  const current = await getMemory(workspaceId);
  const newFact: MemoryFact = {
    type: fact.type || "general",
    value: fact.value.trim(),
    source: fact.source || "manual",
    createdAt: new Date().toISOString(),
  };
  const facts = [...current.facts, newFact].slice(-200); // cap to 200
  const updated = await db.workspaceMemory.upsert({
    where: { workspaceId },
    update: { facts: jsonStringify(facts) },
    create: { workspaceId, facts: jsonStringify(facts), learnings: jsonStringify(current.learnings), history: jsonStringify(current.history) },
  });
  return toRow(updated);
}

export async function addLearning(workspaceId: string, learning: string): Promise<WorkspaceMemoryRow> {
  if (!learning || !learning.trim()) throw new Error("Apprentissage requis");
  const current = await getMemory(workspaceId);
  const learnings = [...current.learnings, learning.trim()].slice(-200);
  const updated = await db.workspaceMemory.upsert({
    where: { workspaceId },
    update: { learnings: jsonStringify(learnings) },
    create: { workspaceId, facts: jsonStringify(current.facts), learnings: jsonStringify(learnings), history: jsonStringify(current.history) },
  });
  return toRow(updated);
}

export async function addHistory(
  workspaceId: string,
  entry: Record<string, unknown>
): Promise<WorkspaceMemoryRow> {
  const current = await getMemory(workspaceId);
  const history = [...current.history, { ...entry, at: new Date().toISOString() }].slice(-200);
  const updated = await db.workspaceMemory.upsert({
    where: { workspaceId },
    update: { history: jsonStringify(history) },
    create: { workspaceId, facts: jsonStringify(current.facts), learnings: jsonStringify(current.learnings), history: jsonStringify(history) },
  });
  return toRow(updated);
}
