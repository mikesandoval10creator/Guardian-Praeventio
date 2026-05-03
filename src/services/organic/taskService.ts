// SPDX-License-Identifier: MIT
// Sprint 15 — Task persistence layer.

import type { Task } from '../../types/organic';

export interface TaskStore {
  get(id: string): Promise<Task | null>;
  list(filter: { processId?: string; crewId?: string; date?: string }): Promise<Task[]>;
  create(t: Task): Promise<void>;
  update(id: string, patch: Partial<Task>): Promise<void>;
}

export function createMemoryTaskStore(): TaskStore {
  const data = new Map<string, Task>();
  return {
    async get(id) {
      return data.get(id) ?? null;
    },
    async list(filter) {
      return [...data.values()].filter((t) => {
        if (filter.processId && t.processId !== filter.processId) return false;
        if (filter.crewId && t.crewId !== filter.crewId) return false;
        if (filter.date && t.date !== filter.date) return false;
        return true;
      });
    },
    async create(t) {
      data.set(t.id, { ...t });
    },
    async update(id, patch) {
      const cur = data.get(id);
      if (!cur) throw new Error(`Task ${id} not found`);
      data.set(id, { ...cur, ...patch });
    },
  };
}

function genId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `task-${g.crypto.randomUUID()}`;
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTask(
  store: TaskStore,
  args: {
    processId: string;
    crewId: string;
    projectId: string;
    date: string;
    description: string;
    assignedUids?: string[];
  }
): Promise<Task> {
  if (!args.processId) throw new Error('processId is required');
  const t: Task = {
    id: genId(),
    processId: args.processId,
    crewId: args.crewId,
    projectId: args.projectId,
    date: args.date,
    description: args.description.trim() || 'Tarea',
    assignedUids: args.assignedUids ?? [],
    status: 'pending',
    completedAt: null,
  };
  await store.create(t);
  return t;
}

export async function markTaskDone(store: TaskStore, id: string): Promise<Task> {
  const cur = await store.get(id);
  if (!cur) throw new Error(`Task ${id} not found`);
  const completedAt = new Date().toISOString();
  await store.update(id, { status: 'done', completedAt });
  return { ...cur, status: 'done', completedAt };
}

export async function getTasksByProcess(store: TaskStore, processId: string): Promise<Task[]> {
  return store.list({ processId });
}
