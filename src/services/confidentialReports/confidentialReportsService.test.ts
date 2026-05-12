import { describe, it, expect } from 'vitest';
import {
  hashAuthor,
  computeLegalDeadlines,
  detectRetaliation,
  canAccessReport,
  type ConfidentialReport,
  type WorkerStateChange,
} from './confidentialReportsService.js';

function report(over: Partial<ConfidentialReport> & { id: string }): ConfidentialReport {
  return {
    id: over.id,
    authorHash: over.authorHash ?? 'hash',
    authorIdentified: over.authorIdentified ?? false,
    authorUid: over.authorUid,
    kind: over.kind ?? 'harassment_workplace',
    description: 'd',
    involvedUids: over.involvedUids ?? ['victim1', 'witness1'],
    submittedAt: over.submittedAt ?? '2026-05-11T10:00:00Z',
    status: over.status ?? 'submitted',
    handlerUid: over.handlerUid,
    acknowledgedAt: over.acknowledgedAt,
    investigationStartedAt: over.investigationStartedAt,
    resolvedAt: over.resolvedAt,
  };
}

describe('hashAuthor', () => {
  it('mismo uid + salt → mismo hash', () => {
    const SALT = 'this_is_a_long_salt_value';
    expect(hashAuthor('uid1', SALT)).toBe(hashAuthor('uid1', SALT));
  });

  it('diferentes uids → diferentes hashes', () => {
    const SALT = 'this_is_a_long_salt_value';
    expect(hashAuthor('uid1', SALT)).not.toBe(hashAuthor('uid2', SALT));
  });

  it('rechaza salt corto', () => {
    expect(() => hashAuthor('uid1', 'short')).toThrow(/salt/);
  });
});

describe('computeLegalDeadlines', () => {
  it('reporte recién enviado → on_track', () => {
    const r = computeLegalDeadlines(
      report({ id: 'r1', submittedAt: '2026-05-11T10:00:00Z' }),
      '2026-05-11T11:00:00Z',
    );
    expect(r.slaStatus).toBe('on_track');
  });

  it('submitted >24h sin acknowledge → breached', () => {
    const r = computeLegalDeadlines(
      report({ id: 'r1', submittedAt: '2026-05-10T00:00:00Z', status: 'submitted' }),
      '2026-05-11T11:00:00Z',
    );
    expect(r.slaStatus).toBe('breached');
  });

  it('investigación no iniciada >3d → breached', () => {
    const r = computeLegalDeadlines(
      report({
        id: 'r1',
        submittedAt: '2026-05-01T00:00:00Z',
        status: 'acknowledged',
      }),
      '2026-05-08T00:00:00Z',
    );
    expect(r.slaStatus).toBe('breached');
  });

  it('80%+ del plazo sin resolver → at_risk', () => {
    const r = computeLegalDeadlines(
      report({
        id: 'r1',
        submittedAt: '2026-05-01T00:00:00Z',
        status: 'under_investigation',
        investigationStartedAt: '2026-05-02T00:00:00Z',
      }),
      '2026-05-26T00:00:00Z', // 25d / 30d = 83%
    );
    expect(r.slaStatus).toBe('at_risk');
  });
});

describe('detectRetaliation', () => {
  function change(over: Partial<WorkerStateChange> & { workerUid: string }): WorkerStateChange {
    return {
      workerUid: over.workerUid,
      changedAt: over.changedAt ?? '2026-05-20T10:00:00Z',
      changeKind: over.changeKind ?? 'termination',
      changedByUid: 'manager1',
    };
  }

  it('cambio adverso post-reporte dentro de 90d → flag', () => {
    const flags = detectRetaliation(
      [report({ id: 'r1', authorIdentified: true, authorUid: 'victim1' })],
      [change({ workerUid: 'victim1', changedAt: '2026-05-25T10:00:00Z' })],
      '2026-06-01T00:00:00Z',
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('critical'); // termination
  });

  it('cambio antes del reporte → NO es represalia', () => {
    const flags = detectRetaliation(
      [report({ id: 'r1', authorIdentified: true, authorUid: 'v1' })],
      [change({ workerUid: 'v1', changedAt: '2026-05-01T00:00:00Z' })],
      '2026-06-01T00:00:00Z',
    );
    expect(flags).toHaveLength(0);
  });

  it('cambio >90d después → fuera de ventana', () => {
    const flags = detectRetaliation(
      [report({ id: 'r1', authorIdentified: true, authorUid: 'v1' })],
      [change({ workerUid: 'v1', changedAt: '2026-09-01T00:00:00Z' })],
      '2026-10-01T00:00:00Z',
    );
    expect(flags).toHaveLength(0);
  });

  it('shift_change → severity high (no critical)', () => {
    const flags = detectRetaliation(
      [report({ id: 'r1', authorIdentified: true, authorUid: 'v1' })],
      [
        change({
          workerUid: 'v1',
          changedAt: '2026-05-15T10:00:00Z',
          changeKind: 'shift_change',
        }),
      ],
      '2026-06-01T00:00:00Z',
    );
    expect(flags[0].severity).toBe('high');
  });
});

describe('canAccessReport', () => {
  it('handler asignado puede leer', () => {
    const r = canAccessReport(
      { reportId: 'r1', requesterUid: 'handler1', requesterRole: 'supervisor' },
      report({ id: 'r1', handlerUid: 'handler1' }),
    );
    expect(r.allowed).toBe(true);
  });

  it('rol authorized puede leer', () => {
    const r = canAccessReport(
      { reportId: 'r1', requesterUid: 'lawyer', requesterRole: 'legal_counsel' },
      report({ id: 'r1' }),
    );
    expect(r.allowed).toBe(true);
  });

  it('autor identificado puede ver su reporte', () => {
    const r = canAccessReport(
      { reportId: 'r1', requesterUid: 'me', requesterRole: 'worker' },
      report({ id: 'r1', authorIdentified: true, authorUid: 'me' }),
    );
    expect(r.allowed).toBe(true);
  });

  it('worker sin rol autorizado → no puede', () => {
    const r = canAccessReport(
      { reportId: 'r1', requesterUid: 'curious', requesterRole: 'worker' },
      report({ id: 'r1' }),
    );
    expect(r.allowed).toBe(false);
  });
});
