/**
 * Tests for the Firestore writer wrapping REBA/RULA assessment persistence.
 *
 * The service is a thin Firestore + audit-log adapter — these tests pin down:
 *   1. write shape (collection name, doc id, payload fields, computed fields)
 *   2. metadata defaults (signedAt = null on create, signerUid set on sign)
 *   3. audit_log emission (action keys + payload subset)
 *   4. validation guards (rejects unknown type, missing computed score)
 *   5. signing semantics (one-shot — re-signing forbidden)
 *
 * Following the syncManager test convention: stub firebase/firestore + the
 * ./firebase singleton + the auditService BEFORE importing the SUT.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks — must be hoisted before SUT import.
type AnyMock = ReturnType<typeof vi.fn> & {
  mock: { calls: any[][] };
  mockResolvedValue: (v: unknown) => AnyMock;
  mockReset: () => void;
  mockClear: () => void;
};
const setDocMock = vi.fn() as unknown as AnyMock;
const updateDocMock = vi.fn() as unknown as AnyMock;
const getDocMock = vi.fn() as unknown as AnyMock;
const docMock = vi.fn() as unknown as AnyMock;
const collectionMock = vi.fn() as unknown as AnyMock;
// Default behaviours — overridden per-test where needed.
(setDocMock as any).mockImplementation((..._args: unknown[]) => undefined);
(updateDocMock as any).mockImplementation((..._args: unknown[]) => undefined);
(getDocMock as any).mockImplementation((..._args: unknown[]) => ({
  exists: () => false,
  data: () => undefined,
}));
(docMock as any).mockImplementation((..._args: unknown[]) => ({ __ref: true, args: _args }));
(collectionMock as any).mockImplementation((..._args: unknown[]) => ({ __col: true, args: _args }));

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  collection: collectionMock,
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  getDoc: getDocMock,
}));

vi.mock('../firebase', () => ({
  db: { __db: true },
}));

const logAuditActionMock = vi.fn() as unknown as AnyMock;
(logAuditActionMock as any).mockImplementation((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock('../auditService', () => ({
  logAuditAction: logAuditActionMock,
}));

const { recordErgonomicAssessment, signErgonomicAssessment } = await import(
  './ergonomicAssessments'
);

const baseRebaPayload = {
  workerId: 'worker-1',
  projectId: 'proj-1',
  type: 'REBA' as const,
  inputs: { trunk: { flexionDeg: 30 } }, // opaque — service doesn't parse
  score: 7,
  actionLevel: 'medium',
  computedAt: '2026-04-28T00:00:00.000Z',
  authorUid: 'user-1',
};

const baseRulaPayload = {
  ...baseRebaPayload,
  type: 'RULA' as const,
  score: 5,
  actionLevel: 3,
};

beforeEach(() => {
  setDocMock.mockClear();
  updateDocMock.mockClear();
  getDocMock.mockReset();
  getDocMock.mockResolvedValue({
    exists: () => false,
    data: () => undefined,
  });
  docMock.mockClear();
  collectionMock.mockClear();
  logAuditActionMock.mockClear();
});

describe('recordErgonomicAssessment', () => {
  it('writes to ergonomic_assessments with metadata.signedAt = null and returns the id', async () => {
    const result = await recordErgonomicAssessment(baseRebaPayload);

    expect(result.id).toBeTypeOf('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(setDocMock).toHaveBeenCalledTimes(1);

    const [, payload] = setDocMock.mock.calls[0];
    const written = payload as Record<string, unknown> & { metadata: any };
    expect(written.workerId).toBe('worker-1');
    expect(written.projectId).toBe('proj-1');
    expect(written.type).toBe('REBA');
    expect(written.score).toBe(7);
    expect(written.actionLevel).toBe('medium');
    expect(written.computedAt).toBe('2026-04-28T00:00:00.000Z');
    expect(written.metadata).toBeDefined();
    expect(written.metadata.signedAt).toBeNull();
    expect(written.metadata.author).toBe('user-1');
  });

  it('uses the ergonomic_assessments collection name in the doc reference', async () => {
    await recordErgonomicAssessment(baseRebaPayload);

    // doc(db, 'ergonomic_assessments', id) — second arg is the collection name
    const docCall = docMock.mock.calls[0];
    expect(docCall[1]).toBe('ergonomic_assessments');
    expect(typeof docCall[2]).toBe('string');
  });

  it('emits a safety.reba.completed audit log entry on REBA writes', async () => {
    await recordErgonomicAssessment(baseRebaPayload);

    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
    const [action, module, details, projectId] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.reba.completed');
    expect(module).toBe('safety');
    expect(details).toMatchObject({
      workerId: 'worker-1',
      score: 7,
      actionLevel: 'medium',
    });
    expect(projectId).toBe('proj-1');
  });

  it('emits safety.rula.completed for RULA assessments', async () => {
    await recordErgonomicAssessment(baseRulaPayload);

    const [action] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.rula.completed');
  });

  it('rejects payloads with unsupported assessment types', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        type: 'NIOSH' as unknown as 'REBA',
      }),
    ).rejects.toThrow(/type/i);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects payloads missing the computed score', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        score: undefined as unknown as number,
      }),
    ).rejects.toThrow(/score/i);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('signErgonomicAssessment', () => {
  it('sets metadata.signedAt + metadata.signedBy and emits a signed audit entry', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        workerId: 'w1',
        projectId: 'proj-1',
        type: 'REBA',
        metadata: { signedAt: null, author: 'user-1' },
      }),
    });

    await signErgonomicAssessment('asmt-123', 'gerente-uid');

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0];
    const update = patch as Record<string, unknown>;
    expect(update['metadata.signedBy']).toBe('gerente-uid');
    expect(update['metadata.signedAt']).toBeTypeOf('string');
    expect(() => new Date(update['metadata.signedAt'] as string).toISOString()).not.toThrow();

    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
    const [action, module, details, projectId] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.reba.signed');
    expect(module).toBe('safety');
    expect(details).toMatchObject({ assessmentId: 'asmt-123', signerUid: 'gerente-uid' });
    expect(projectId).toBe('proj-1');
  });

  it('refuses to sign an assessment that is already signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        workerId: 'w1',
        projectId: 'proj-1',
        type: 'REBA',
        metadata: { signedAt: '2026-04-27T10:00:00.000Z', signedBy: 'old-signer' },
      }),
    });

    await expect(
      signErgonomicAssessment('asmt-123', 'gerente-uid'),
    ).rejects.toThrow(/already signed/i);
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });

  it('refuses to sign an assessment that does not exist', async () => {
    getDocMock.mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    });

    await expect(
      signErgonomicAssessment('missing-id', 'gerente-uid'),
    ).rejects.toThrow(/not found/i);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
