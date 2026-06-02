// Pins the server-side ZK writer's tri-write against the canonical endpoint
// (zettelkasten.ts POST /nodes): legacy doc + best-effort canonical doc +
// audit row, with `nodeIdFor` idempotent ids. Guards against schema drift —
// server-flow nodes must match client-written ones.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RiskNodePayload } from '../../services/zettelkasten/types';

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { serverWriteNodes, makeServerWriteNodes } from './serverZkNodeWriter';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const NODE = {
  title: 'Inspección EPP — casco vencido',
  description: 'Casco fuera de fecha en cuadrilla A',
  type: 'epp_inspection',
  severity: 'high',
  metadata: { item: 'casco', area: 'soldadura' },
  connections: [],
  references: ['DS 594'],
} as unknown as RiskNodePayload;

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('serverWriteNodes', () => {
  it('no-ops (ok, empty ids) for an empty batch', async () => {
    const r = await serverWriteNodes([], { projectId: 'p1' }, { createdBy: 'u1' });
    expect(r).toEqual({ ok: true, ids: [] });
  });

  it('writes legacy + canonical + audit per node (tenant resolved)', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1' });

    const r = await serverWriteNodes(
      [NODE],
      { projectId: 'p1' },
      { createdBy: 'u1', createdByEmail: 'u1@praeventio.test' },
    );
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(1);
    const id = r.ids![0];

    // 1. legacy `zettelkasten_nodes/{id}` — source of truth
    const legacy = (
      await H.db!.collection('zettelkasten_nodes').doc(id).get()
    ).data() as Record<string, unknown>;
    expect(legacy.title).toBe(NODE.title);
    expect(legacy.projectId).toBe('p1');
    expect(legacy.createdBy).toBe('u1');
    expect(legacy.createdByEmail).toBe('u1@praeventio.test');
    expect(legacy.idempotencyKey).toBe(id);

    // 2. canonical `nodes/t1_p1_{id}` (tenant-scoped)
    const canonical = (await H.db!.doc(`nodes/t1_p1_${id}`).get()).data();
    expect(canonical).toBeDefined();

    // 3. audit_logs row stamped with the server-side actor
    const dump = H.db!._dump();
    const auditKey = Object.keys(dump).find((k) => k.startsWith('audit_logs/'));
    expect(auditKey).toBeDefined();
    const audit = dump[auditKey!];
    expect(audit.action).toBe('zettelkasten.node.write');
    expect(audit.userId).toBe('u1');
    expect((audit.details as Record<string, unknown>).source).toBe('server-flow');
  });

  it('falls back to the no-tenant canonical path for legacy projects', async () => {
    H.db!._seed('projects/p1', {}); // no tenantId
    const r = await serverWriteNodes([NODE], { projectId: 'p1' }, { createdBy: 'u1' });
    const id = r.ids![0];
    expect((await H.db!.doc(`nodes/p1_${id}`).get()).data()).toBeDefined();
  });

  it('is idempotent — identical content yields the same id regardless of actor', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1' });
    const r1 = await serverWriteNodes([NODE], { projectId: 'p1' }, { createdBy: 'u1' });
    const r2 = await serverWriteNodes([NODE], { projectId: 'p1' }, { createdBy: 'u2' });
    expect(r1.ids![0]).toBe(r2.ids![0]);
  });

  it('makeServerWriteNodes binds the actor onto the writeNodes signature', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1' });
    const fn = makeServerWriteNodes({ createdBy: 'bound-user' });
    const r = await fn([NODE], { projectId: 'p1' });
    const legacy = (
      await H.db!.collection('zettelkasten_nodes').doc(r.ids![0]).get()
    ).data() as Record<string, unknown>;
    expect(legacy.createdBy).toBe('bound-user');
  });
});
