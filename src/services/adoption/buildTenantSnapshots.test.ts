// Tests para buildTenantSnapshots — Ticket 399aa66d-73fe-81d3-9eeb-ea2aa4cb064a.
//
// Construye TenantUsageSnapshot[] desde datos REALES de Firestore
// (subscription + actividad) — NUNCA métricas inventadas. El engine de
// churn (adoptionAnalytics.assessChurnRisk) ya existe; esto solo alimenta
// snapshots honestos desde la fuente.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import { buildTenantSnapshots } from './buildTenantSnapshots';

function seedUser(uid: string, over: Record<string, unknown> = {}) {
  H.db!._seed(`users/${uid}`, {
    uid,
    email: `${uid}@test.cl`,
    createdAt: '2026-07-01T00:00:00.000Z', // 40+ días antes del now de test
    ...over,
  });
}

function seedProject(pid: string, uid: string, over: Record<string, unknown> = {}) {
  H.db!._seed(`projects/${pid}`, {
    id: pid,
    name: `Proyecto ${pid}`,
    members: [uid],
    workersCount: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  });
}

function seedWorker(pid: string, wid: string) {
  H.db!._seed(`projects/${pid}/workers/${wid}`, {
    id: wid,
    name: `Worker ${wid}`,
    projectId: pid,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('buildTenantSnapshots — datos reales, sin fabricar', () => {
  it('devuelve [] sin tenants', async () => {
    const snaps = await buildTenantSnapshots(H.db!);
    expect(snaps).toEqual([]);
  });

  it('construye snapshot desde subscription + proyectos + workers reales', async () => {
    seedUser('u1', {
      subscription: { planId: 'titanio', status: 'active', createdAt: '2026-07-01T00:00:00.000Z' },
    });
    seedProject('p1', 'u1', { workersCount: 2 });
    seedWorker('p1', 'w1');
    seedWorker('p1', 'w2');
    seedProject('p2', 'u1', { workersCount: 0 });

    const snaps = await buildTenantSnapshots(H.db!);
    expect(snaps).toHaveLength(1);
    const s = snaps[0];
    expect(s.tenantId).toBe('u1');
    // hasPaidPlan desde subscription REAL activa
    expect(s.hasPaidPlan).toBe(true);
    // activeProjects desde proyectos REALES del tenant
    expect(s.activeProjects).toBe(2);
    // activeWorkers desde workersCount REAL (no inventado)
    expect(s.activeWorkers).toBe(2);
    // daysSinceSignup desde createdAt REAL
    expect(s.daysSinceSignup).toBeGreaterThan(30);
    expect(s.activeModules).toBeInstanceOf(Set);
    expect(s.activeModules.has('projects')).toBe(true);
  });

  it('tenants sin subscription pagan -> hasPaidPlan=false (sin inventar)', async () => {
    seedUser('u2', { createdAt: '2026-07-01T00:00:00.000Z' });
    seedProject('p3', 'u2');

    const snaps = await buildTenantSnapshots(H.db!);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].tenantId).toBe('u2');
    expect(snaps[0].hasPaidPlan).toBe(false);
  });

  it('no incluye tenants sin actividad ni subscription (ruido admin)', async () => {
    // u3 existe como user pero sin subscription y sin proyectos -> no es tenant activo
    seedUser('u3', { createdAt: '2026-07-01T00:00:00.000Z' });
    const snaps = await buildTenantSnapshots(H.db!);
    expect(snaps).toHaveLength(0);
  });
});
