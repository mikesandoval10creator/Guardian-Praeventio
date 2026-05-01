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

  it('rejects null payloads with the canonical "payload required" message', async () => {
    await expect(
      recordErgonomicAssessment(null as unknown as typeof baseRebaPayload),
    ).rejects.toThrow(/ergonomic_assessments: payload required/);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });

  it('rejects non-object payloads (string)', async () => {
    await expect(
      recordErgonomicAssessment('not-an-object' as unknown as typeof baseRebaPayload),
    ).rejects.toThrow(/payload required/);
  });

  it('mentions the offending type in the unsupported-type error message', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        type: 'NIOSH' as unknown as 'REBA',
      }),
    ).rejects.toThrow(/NIOSH/);
  });

  it('rejects non-finite scores (NaN)', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        score: Number.NaN,
      }),
    ).rejects.toThrow(/score must be a finite number/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-finite scores (Infinity)', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        score: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/score must be a finite number/);
  });

  it('rejects payloads where actionLevel is neither string nor number', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        actionLevel: { bad: true } as unknown as string,
      }),
    ).rejects.toThrow(/actionLevel must be string\|number/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects empty workerId (string of length 0)', async () => {
    await expect(
      recordErgonomicAssessment({ ...baseRebaPayload, workerId: '' }),
    ).rejects.toThrow(/workerId required/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects missing workerId (non-string)', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        workerId: undefined as unknown as string,
      }),
    ).rejects.toThrow(/workerId required/);
  });

  it('rejects empty projectId', async () => {
    await expect(
      recordErgonomicAssessment({ ...baseRebaPayload, projectId: '' }),
    ).rejects.toThrow(/projectId required/);
  });

  it('rejects missing projectId (non-string)', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        projectId: 42 as unknown as string,
      }),
    ).rejects.toThrow(/projectId required/);
  });

  it('rejects empty computedAt', async () => {
    await expect(
      recordErgonomicAssessment({ ...baseRebaPayload, computedAt: '' }),
    ).rejects.toThrow(/computedAt required/);
  });

  it('rejects missing computedAt', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        computedAt: undefined as unknown as string,
      }),
    ).rejects.toThrow(/computedAt required/);
  });

  it('rejects empty authorUid', async () => {
    await expect(
      recordErgonomicAssessment({ ...baseRebaPayload, authorUid: '' }),
    ).rejects.toThrow(/authorUid required/);
  });

  it('rejects missing authorUid', async () => {
    await expect(
      recordErgonomicAssessment({
        ...baseRebaPayload,
        authorUid: null as unknown as string,
      }),
    ).rejects.toThrow(/authorUid required/);
  });

  it('forwards durationMin into audit details when finite and positive', async () => {
    await recordErgonomicAssessment({ ...baseRebaPayload, durationMin: 12 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { durationMin?: number }).durationMin).toBe(12);
  });

  it('omits durationMin from audit details when zero', async () => {
    await recordErgonomicAssessment({ ...baseRebaPayload, durationMin: 0 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('omits durationMin from audit details when negative', async () => {
    await recordErgonomicAssessment({ ...baseRebaPayload, durationMin: -5 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('omits durationMin from audit details when NaN', async () => {
    await recordErgonomicAssessment({ ...baseRebaPayload, durationMin: Number.NaN });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('omits durationMin from audit details when omitted entirely', async () => {
    await recordErgonomicAssessment(baseRebaPayload);
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('audit details include assessmentId matching the returned id', async () => {
    const result = await recordErgonomicAssessment(baseRebaPayload);
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { assessmentId: string }).assessmentId).toBe(result.id);
  });

  it('audit details include the type ("REBA") and full score', async () => {
    await recordErgonomicAssessment(baseRebaPayload);
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { type: string }).type).toBe('REBA');
    expect((details as { score: number }).score).toBe(7);
  });

  it('passes an explicit projectId (not undefined) to logAuditAction', async () => {
    await recordErgonomicAssessment(baseRebaPayload);
    const call = logAuditActionMock.mock.calls[0];
    expect(call[3]).toBe('proj-1');
    expect(call.length).toBe(4);
  });

  it('writes setDoc before invoking logAuditAction (Firestore-first ordering)', async () => {
    const order: string[] = [];
    setDocMock.mockImplementation(() => {
      order.push('setDoc');
      return Promise.resolve(undefined);
    });
    logAuditActionMock.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve(undefined);
    });
    await recordErgonomicAssessment(baseRebaPayload);
    expect(order).toEqual(['setDoc', 'audit']);
  });

  it('does not emit an audit log when setDoc rejects', async () => {
    setDocMock.mockImplementation(() => Promise.reject(new Error('firestore offline')));
    await expect(recordErgonomicAssessment(baseRebaPayload)).rejects.toThrow(/firestore offline/);
    expect(logAuditActionMock).not.toHaveBeenCalled();
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

  it('rejects empty id', async () => {
    await expect(signErgonomicAssessment('', 'gerente-uid')).rejects.toThrow(/id required/);
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-string id', async () => {
    await expect(
      signErgonomicAssessment(undefined as unknown as string, 'gerente-uid'),
    ).rejects.toThrow(/id required/);
  });

  it('rejects empty signerUid', async () => {
    await expect(signErgonomicAssessment('asmt-1', '')).rejects.toThrow(/signerUid required/);
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-string signerUid', async () => {
    await expect(
      signErgonomicAssessment('asmt-1', null as unknown as string),
    ).rejects.toThrow(/signerUid required/);
  });

  it('quotes the offending id in the not-found error', async () => {
    getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(
      signErgonomicAssessment('asmt-xyz', 'gerente-uid'),
    ).rejects.toThrow(/asmt-xyz/);
  });

  it('quotes the offending id in the already-signed error', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        type: 'REBA',
        projectId: 'proj-1',
        metadata: { signedAt: '2026-04-27T10:00:00.000Z' },
      }),
    });
    await expect(
      signErgonomicAssessment('asmt-already', 'gerente-uid'),
    ).rejects.toThrow(/asmt-already/);
  });

  it('uses the stored type to compose the audit action key (RULA)', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        type: 'RULA',
        projectId: 'proj-2',
        metadata: { signedAt: null },
      }),
    });
    await signErgonomicAssessment('asmt-rula', 'gerente-uid');
    const [action] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.rula.signed');
  });

  it('falls back to "reba" when the stored type is missing', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-3', metadata: { signedAt: null } }),
    });
    await signErgonomicAssessment('asmt-untyped', 'gerente-uid');
    const [action] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.reba.signed');
  });

  it('treats a missing metadata block as not-yet-signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ type: 'REBA', projectId: 'proj-1' }),
    });
    await signErgonomicAssessment('asmt-no-meta', 'gerente-uid');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
  });

  it('treats metadata.signedAt === null as not-yet-signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ type: 'REBA', projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    await signErgonomicAssessment('asmt-null-signed', 'gerente-uid');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });

  it('audit details include the freshly-set signedAt ISO string', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ type: 'REBA', projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    await signErgonomicAssessment('asmt-iso', 'gerente-uid');
    const [, patch] = updateDocMock.mock.calls[0];
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { signedAt: string }).signedAt).toBe(
      (patch as Record<string, string>)['metadata.signedAt'],
    );
  });

  it('does not emit an audit log when updateDoc rejects', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ type: 'REBA', projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    updateDocMock.mockImplementation(() => Promise.reject(new Error('write denied')));
    await expect(
      signErgonomicAssessment('asmt-fail', 'gerente-uid'),
    ).rejects.toThrow(/write denied/);
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });
});
