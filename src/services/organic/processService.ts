// SPDX-License-Identifier: MIT
// Sprint 15 — Process lifecycle + positive XP economy.

import type { Process, ProcessType, ProcessStatus } from '../../types/organic';
import { awardCrewXp, type CrewStore } from './crewService';

export interface ProcessStore {
  get(id: string): Promise<Process | null>;
  list(filter: { crewId?: string; projectId?: string }): Promise<Process[]>;
  create(p: Process): Promise<void>;
  update(id: string, patch: Partial<Process>): Promise<void>;
}

export function createMemoryProcessStore(): ProcessStore {
  const data = new Map<string, Process>();
  return {
    async get(id) {
      return data.get(id) ?? null;
    },
    async list(filter) {
      return [...data.values()].filter((p) => {
        if (filter.crewId && p.crewId !== filter.crewId) return false;
        if (filter.projectId && p.projectId !== filter.projectId) return false;
        return true;
      });
    },
    async create(p) {
      data.set(p.id, { ...p });
    },
    async update(id, patch) {
      const cur = data.get(id);
      if (!cur) throw new Error(`Process ${id} not found`);
      data.set(id, { ...cur, ...patch });
    },
  };
}

/**
 * Base XP per process type. Tuned so that simpler/lower-risk processes
 * (e.g. transporte, topografia) award less than higher-stakes ones
 * (e.g. demolicion, soldadura, fachada). Multiplied by complianceScore/100
 * and an alertsResponded bonus at close time.
 */
export function baseXpForProcessType(type: ProcessType): number {
  const table: Record<ProcessType, number> = {
    concreto: 100,
    fachada: 140,
    movimiento_tierras: 120,
    soldadura: 130,
    mantenimiento: 80,
    demolicion: 150,
    instalacion_electrica: 110,
    pintura: 70,
    topografia: 60,
    transporte: 60,
    otro: 80,
  };
  return table[type];
}

/**
 * Pure XP formula. Exposed so UI ("Cerrar y celebrar") can preview the
 * award before commit, matching exactly what `closeProcess` will write.
 *
 *   xp = baseXp(type) * (complianceScore / 100) * (1 + alertsResponded * 0.05)
 *
 * Always positive. Floor to integer.
 */
export function computeProcessCloseXp(
  type: ProcessType,
  complianceScore: number,
  alertsResponded: number
): number {
  const score = Math.max(0, Math.min(100, complianceScore));
  const alertBonus = 1 + Math.max(0, alertsResponded) * 0.05;
  return Math.floor(baseXpForProcessType(type) * (score / 100) * alertBonus);
}

function genId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `proc-${g.crypto.randomUUID()}`;
  return `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function startProcess(
  store: ProcessStore,
  args: {
    crewId: string;
    projectId: string;
    type: ProcessType;
    name: string;
    description?: string;
    plannedEndDate?: string | null;
  }
): Promise<Process> {
  if (!args.crewId) throw new Error('crewId is required');
  if (!args.projectId) throw new Error('projectId is required');
  const now = new Date().toISOString();
  const proc: Process = {
    id: genId(),
    crewId: args.crewId,
    projectId: args.projectId,
    type: args.type,
    name: args.name.trim() || 'Proceso',
    description: args.description ?? '',
    startedAt: now,
    endedAt: null,
    plannedEndDate: args.plannedEndDate ?? null,
    status: 'active',
    complianceScore: 100,
    incidentsDuringProcess: 0,
    alertsResponded: 0,
    xpAwardedAtClose: null,
  };
  await store.create(proc);
  return proc;
}

async function setStatus(
  store: ProcessStore,
  id: string,
  status: ProcessStatus
): Promise<Process> {
  const cur = await store.get(id);
  if (!cur) throw new Error(`Process ${id} not found`);
  await store.update(id, { status });
  return { ...cur, status };
}

export const pauseProcess = (store: ProcessStore, id: string) => setStatus(store, id, 'paused');
export const resumeProcess = (store: ProcessStore, id: string) => setStatus(store, id, 'active');

/**
 * Sprint 17a — pure state-machine guard for `/api/processes/:id/status`.
 * Centralizes the allowed transitions so both the HTTP route and any
 * future workflow engine share the same rules.
 *
 * Allowed transitions:
 *   • planning → active | paused
 *   • active   ↔ paused
 *   • completed | aborted are TERMINAL — any change is rejected.
 *
 * Returns `{ ok: true }` on a legal transition or
 * `{ ok: false, reason }` with a stable machine-readable reason code
 * suitable for HTTP error envelopes.
 */
export type StatusTransitionCheck =
  | { ok: true }
  | { ok: false, reason: 'terminal' | 'invalid_target' | 'noop' };

export function checkStatusTransition(
  from: ProcessStatus,
  to: ProcessStatus
): StatusTransitionCheck {
  if (to !== 'active' && to !== 'paused') {
    return { ok: false, reason: 'invalid_target' };
  }
  if (from === 'completed' || from === 'aborted') {
    return { ok: false, reason: 'terminal' };
  }
  if (from === to) {
    return { ok: false, reason: 'noop' };
  }
  return { ok: true };
}

export async function recordAlertResponded(
  store: ProcessStore,
  id: string
): Promise<Process> {
  const cur = await store.get(id);
  if (!cur) throw new Error(`Process ${id} not found`);
  const next = { ...cur, alertsResponded: cur.alertsResponded + 1 };
  await store.update(id, { alertsResponded: next.alertsResponded });
  return next;
}

/**
 * Close a process and award crew XP. Side-effects:
 *   1. Process flagged `completed`, `endedAt` set, `xpAwardedAtClose` set.
 *   2. Crew gets `+xp`, `totalProcessesCompleted++`.
 *
 * Negative or zero XP cannot be written: the formula always returns ≥0,
 * and the crew XP path no-ops on non-positive amounts.
 */
export async function closeProcess(
  processStore: ProcessStore,
  crewStore: CrewStore,
  id: string,
  complianceScore: number
): Promise<{ process: Process; xpAwarded: number }> {
  const cur = await processStore.get(id);
  if (!cur) throw new Error(`Process ${id} not found`);
  if (cur.status === 'completed' || cur.status === 'aborted') {
    throw new Error(`Process ${id} already terminal (${cur.status})`);
  }
  const xp = computeProcessCloseXp(cur.type, complianceScore, cur.alertsResponded);
  const endedAt = new Date().toISOString();
  await processStore.update(id, {
    status: 'completed',
    endedAt,
    complianceScore: Math.max(0, Math.min(100, complianceScore)),
    xpAwardedAtClose: xp,
  });
  const crew = await crewStore.get(cur.crewId);
  if (crew) {
    await crewStore.update(cur.crewId, {
      totalProcessesCompleted: crew.totalProcessesCompleted + 1,
    });
    if (xp > 0) {
      await awardCrewXp(crewStore, cur.crewId, xp, 'process_close_bonus');
    }
  }
  const finalProcess = await processStore.get(id);
  if (!finalProcess) throw new Error('Process disappeared mid-close');
  return { process: finalProcess, xpAwarded: xp };
}
