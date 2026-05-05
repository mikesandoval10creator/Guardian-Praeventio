/**
 * Tests for the DS-594 art. 110 legal-threshold trigger wired into
 * `recordErgonomicAssessment`.
 *
 * WHY: REBA>=11 / RULA>=7 son umbrales legales (no estilisticos). El save
 * tecnico debe (a) persistir SIEMPRE, (b) disparar folio DIEP + nodo
 * Zettelkasten + audit log SOLO si se cruza el umbral, y (c) NUNCA
 * romper el save por errores en el side-effect.
 */
import { describe, it, expect, vi } from 'vitest';

type AnyMock = ReturnType<typeof vi.fn>;
const setDocMock: AnyMock = vi.fn();
const docMock: AnyMock = vi.fn(() => ({ __ref: true }));
const getDocMock: AnyMock = vi.fn(() => ({ exists: () => false }));
const updateDocMock: AnyMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  collection: vi.fn(),
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  getDoc: getDocMock,
}));

vi.mock('../firebase', () => ({ db: { __db: true } }));

const logAuditActionMock: AnyMock = vi.fn(async () => undefined);
vi.mock('../auditService', () => ({ logAuditAction: logAuditActionMock }));

const captureExceptionMock: AnyMock = vi.fn();
vi.mock('../observability', () => ({
  getErrorTracker: () => ({ captureException: captureExceptionMock }),
}));

const nextFolioMock: AnyMock = vi.fn(
  async (_store: unknown, _tenant: string, kind: 'DIAT' | 'DIEP') =>
    `${kind}-2026-praevent-000042`,
);
vi.mock('../suseso/folioGenerator', () => ({
  nextFolio: nextFolioMock,
}));

const { recordErgonomicAssessment } = await import('./ergonomicAssessments');

import type { MinimalFolioStore, MinimalTx } from '../suseso/folioGenerator';
const folioStoreStub: MinimalFolioStore = {
  runTransaction: async <T>(fn: (tx: MinimalTx) => Promise<T>): Promise<T> =>
    fn({
      get: async () => ({ exists: false }),
      set: () => undefined,
    }),
};

const basePayload = {
  workerId: 'worker-1',
  projectId: 'proj-1',
  tenantId: 'praeventio',
  inputs: {},
  computedAt: '2026-05-05T00:00:00.000Z',
  authorUid: 'uid-prev-1',
};

function reset() {
  setDocMock.mockClear();
  logAuditActionMock.mockClear();
  nextFolioMock.mockClear();
  captureExceptionMock.mockClear();
}

describe('recordErgonomicAssessment — legal threshold trigger', () => {
  it('REBA score 12 (>=11) triggers folio + node + audit', async () => {
    reset();
    const result = await recordErgonomicAssessment(
      { ...basePayload, type: 'REBA', score: 12, actionLevel: 'very_high' },
      { folioStore: folioStoreStub },
    );
    expect(result.legalTrigger).toBeDefined();
    const trig = await result.legalTrigger!;
    expect(trig.triggered).toBe(true);
    expect(trig.diepFolio).toMatch(/^DIEP-/);
    expect(trig.nodeSpec?.id).toMatch(/riesgo-ergonomico-reba-/);
    expect(trig.nodeSpec?.source).toBe('DS-594');
    expect(nextFolioMock).toHaveBeenCalledTimes(1);
    expect(nextFolioMock.mock.calls[0][2]).toBe('DIEP');
    // 1 audit for safety.reba.completed + 1 for legal_threshold_crossed
    const actions = logAuditActionMock.mock.calls.map((c) => c[0]);
    expect(actions).toContain('ergonomic.legal_threshold_crossed');
    expect(actions).toContain('safety.reba.completed');
  });

  it('REBA score 8 (<11) does NOT trigger folio/node/audit (only normal save)', async () => {
    reset();
    const result = await recordErgonomicAssessment(
      { ...basePayload, type: 'REBA', score: 8, actionLevel: 'high' },
      { folioStore: folioStoreStub },
    );
    const trig = await result.legalTrigger!;
    expect(trig.triggered).toBe(false);
    expect(trig.diepFolio).toBeUndefined();
    expect(nextFolioMock).not.toHaveBeenCalled();
    const actions = logAuditActionMock.mock.calls.map((c) => c[0]);
    expect(actions).not.toContain('ergonomic.legal_threshold_crossed');
    expect(actions).toContain('safety.reba.completed');
  });

  it('RULA score 7 (>=7) triggers folio + node + audit', async () => {
    reset();
    const result = await recordErgonomicAssessment(
      { ...basePayload, type: 'RULA', score: 7, actionLevel: 4 },
      { folioStore: folioStoreStub },
    );
    const trig = await result.legalTrigger!;
    expect(trig.triggered).toBe(true);
    expect(trig.diepFolio).toMatch(/^DIEP-/);
    expect(trig.nodeSpec?.id).toMatch(/riesgo-ergonomico-rula-/);
    expect(nextFolioMock).toHaveBeenCalledTimes(1);
    const actions = logAuditActionMock.mock.calls.map((c) => c[0]);
    expect(actions).toContain('ergonomic.legal_threshold_crossed');
  });

  it('RULA score 5 (<7) does NOT trigger', async () => {
    reset();
    const result = await recordErgonomicAssessment(
      { ...basePayload, type: 'RULA', score: 5, actionLevel: 3 },
      { folioStore: folioStoreStub },
    );
    const trig = await result.legalTrigger!;
    expect(trig.triggered).toBe(false);
    expect(nextFolioMock).not.toHaveBeenCalled();
    const actions = logAuditActionMock.mock.calls.map((c) => c[0]);
    expect(actions).not.toContain('ergonomic.legal_threshold_crossed');
  });

  it('folio generation throwing does NOT break the save; error logged', async () => {
    reset();
    nextFolioMock.mockRejectedValueOnce(new Error('SUSESO down'));
    const result = await recordErgonomicAssessment(
      { ...basePayload, type: 'REBA', score: 13, actionLevel: 'very_high' },
      { folioStore: folioStoreStub },
    );
    // Save MUST have succeeded.
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(result.id).toBeTruthy();
    const trig = await result.legalTrigger!;
    // Trigger fired, folio is undefined, error captured by Sentry.
    expect(trig.triggered).toBe(true);
    expect(trig.diepFolio).toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalled();
    // Audit log STILL emitted (paper trail must exist even if folio fails).
    const actions = logAuditActionMock.mock.calls.map((c) => c[0]);
    expect(actions).toContain('ergonomic.legal_threshold_crossed');
  });

  it('without folioStore dep, legalTrigger is skipped entirely (legacy path)', async () => {
    reset();
    const result = await recordErgonomicAssessment({
      ...basePayload,
      type: 'REBA',
      score: 14,
      actionLevel: 'very_high',
    });
    expect(result.legalTrigger).toBeUndefined();
    expect(nextFolioMock).not.toHaveBeenCalled();
  });
});
