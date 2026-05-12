import { describe, it, expect } from 'vitest';
import {
  ConfidentialReportsAdapter,
  type ReportAuditEvent,
} from './confidentialReportsFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { ConfidentialReport } from './confidentialReportsService.js';

function report(over: Partial<ConfidentialReport> & { id: string }): ConfidentialReport {
  return {
    id: over.id,
    authorHash: 'hash',
    authorIdentified: false,
    kind: over.kind ?? 'harassment_workplace',
    description: 'd',
    involvedUids: ['v1'],
    submittedAt: over.submittedAt ?? '2026-05-11T10:00:00Z',
    status: over.status ?? 'submitted',
    handlerUid: over.handlerUid,
  };
}

function audit(at: string, kind: ReportAuditEvent['kind']): ReportAuditEvent {
  return { at, kind, actorUid: 'a1', actorRole: 'confidential_handler' };
}

describe('ConfidentialReportsAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'r1' }));
    expect((await a.getById('r1'))?.id).toBe('r1');
  });

  it('updateStatus + patch parcial', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'r1' }));
    await a.updateStatus('r1', 'acknowledged', { acknowledgedAt: '2026-05-11T11:00:00Z', handlerUid: 'h1' });
    const got = await a.getById('r1');
    expect(got?.status).toBe('acknowledged');
    expect(got?.handlerUid).toBe('h1');
  });

  it('listByKind filtra', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'a', kind: 'harassment_sexual' }));
    await a.save(report({ id: 'b', kind: 'violence' }));
    expect((await a.listByKind('harassment_sexual'))[0].id).toBe('a');
  });

  it('listPendingByHandler excluye resolved', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'open', handlerUid: 'h1', status: 'under_investigation' }));
    await a.save(report({ id: 'closed', handlerUid: 'h1', status: 'resolved_substantiated' }));
    const list = await a.listPendingByHandler('h1');
    expect(list.map((r) => r.id)).toEqual(['open']);
  });

  it('appendAudit + listAudit en subcollection', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'r1' }));
    await a.appendAudit('r1', audit('2026-05-11T10:00:00Z', 'read'));
    await a.appendAudit('r1', audit('2026-05-11T11:00:00Z', 'status_change'));
    const log = await a.listAudit('r1');
    expect(log).toHaveLength(2);
    expect(log[0].at).toBe('2026-05-11T11:00:00Z'); // desc
  });

  it('audit aislado por reportId', async () => {
    const db = createFakeFirestore();
    const a = new ConfidentialReportsAdapter(db, 't1', 'p1');
    await a.save(report({ id: 'r1' }));
    await a.save(report({ id: 'r2' }));
    await a.appendAudit('r1', audit('2026-05-11T10:00:00Z', 'read'));
    expect((await a.listAudit('r1'))).toHaveLength(1);
    expect((await a.listAudit('r2'))).toHaveLength(0);
  });
});
