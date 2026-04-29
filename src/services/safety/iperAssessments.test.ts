/**
 * Tests for the Firestore writer wrapping IPER matrix assessment persistence.
 *
 * Same shape as ergonomicAssessments — the IPER service writes to its own
 * collection (`iper_assessments`) and emits a distinct audit-log action
 * (`safety.iper.matrix.classified`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const { recordIperAssessment, signIperAssessment } = await import('./iperAssessments');

const basePayload = {
  description: 'Trabajos en altura sobre 1.8m',
  projectId: 'proj-1',
  inputs: {
    probability: 4 as const,
    severity: 3 as const,
    controlEffectiveness: 'medium' as const,
  },
  level: 'moderado',
  rawScore: 12,
  recommendation: 'Implementar controles dentro de 30 días',
  suggestedControls: ['Arnés con doble cabo', 'Línea de vida'],
  computedAt: '2026-04-28T00:00:00.000Z',
  authorUid: 'user-1',
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

describe('recordIperAssessment', () => {
  it('writes to iper_assessments with metadata.signedAt = null and returns the id', async () => {
    const result = await recordIperAssessment(basePayload);

    expect(result.id).toBeTypeOf('string');
    expect(setDocMock).toHaveBeenCalledTimes(1);

    const [ref, payload] = setDocMock.mock.calls[0];
    expect(ref).toBeDefined();
    const written = payload as Record<string, unknown> & { metadata: any };
    expect(written.projectId).toBe('proj-1');
    expect(written.level).toBe('moderado');
    expect(written.rawScore).toBe(12);
    expect(written.suggestedControls).toEqual(['Arnés con doble cabo', 'Línea de vida']);
    expect(written.metadata.signedAt).toBeNull();
    expect(written.metadata.author).toBe('user-1');
  });

  it('uses the iper_assessments collection name in the doc reference', async () => {
    await recordIperAssessment(basePayload);

    const docCall = docMock.mock.calls[0];
    expect(docCall[1]).toBe('iper_assessments');
    expect(typeof docCall[2]).toBe('string');
  });

  it('emits a safety.iper.matrix.classified audit log entry', async () => {
    await recordIperAssessment(basePayload);

    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
    const [action, module, details, projectId] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.iper.matrix.classified');
    expect(module).toBe('safety');
    expect(details).toMatchObject({
      level: 'moderado',
      rawScore: 12,
      probability: 4,
      severity: 3,
    });
    expect(projectId).toBe('proj-1');
  });

  it('rejects payloads missing the computed level', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        level: undefined as unknown as string,
      }),
    ).rejects.toThrow(/level/i);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects payloads with out-of-range probability or severity', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 9, severity: 3 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/probability/i);

    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 3, severity: 0 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/severity/i);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects null payloads with the canonical "payload required" message', async () => {
    await expect(
      recordIperAssessment(null as unknown as typeof basePayload),
    ).rejects.toThrow(/iper_assessments: payload required/);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });

  it('rejects non-object payloads (number)', async () => {
    await expect(
      recordIperAssessment(7 as unknown as typeof basePayload),
    ).rejects.toThrow(/payload required/);
  });

  it('rejects empty level (string of length 0)', async () => {
    await expect(
      recordIperAssessment({ ...basePayload, level: '' }),
    ).rejects.toThrow(/level required/);
  });

  it('rejects non-finite rawScore (NaN)', async () => {
    await expect(
      recordIperAssessment({ ...basePayload, rawScore: Number.NaN }),
    ).rejects.toThrow(/rawScore must be a finite number/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-finite rawScore (-Infinity)', async () => {
    await expect(
      recordIperAssessment({ ...basePayload, rawScore: Number.NEGATIVE_INFINITY }),
    ).rejects.toThrow(/rawScore must be a finite number/);
  });

  it('rejects non-numeric rawScore', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        rawScore: '12' as unknown as number,
      }),
    ).rejects.toThrow(/rawScore must be a finite number/);
  });

  it('rejects empty projectId', async () => {
    await expect(
      recordIperAssessment({ ...basePayload, projectId: '' }),
    ).rejects.toThrow(/projectId required/);
  });

  it('rejects missing projectId', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        projectId: undefined as unknown as string,
      }),
    ).rejects.toThrow(/projectId required/);
  });

  it('rejects empty authorUid', async () => {
    await expect(
      recordIperAssessment({ ...basePayload, authorUid: '' }),
    ).rejects.toThrow(/authorUid required/);
  });

  it('rejects missing authorUid', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        authorUid: 0 as unknown as string,
      }),
    ).rejects.toThrow(/authorUid required/);
  });

  it('rejects missing inputs object', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: undefined as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/inputs required/);
  });

  it('rejects non-integer probability (3.5)', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 3.5, severity: 3 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/probability/);
  });

  it('rejects probability = 0 (below range)', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 0, severity: 3 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/probability must be 1\.\.5/);
  });

  it('rejects probability = 6 (above range)', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 6, severity: 3 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/probability must be 1\.\.5/);
  });

  it('rejects severity = 6 (above range)', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 3, severity: 6 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/severity must be 1\.\.5/);
  });

  it('rejects non-integer severity (2.7)', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        inputs: { probability: 3, severity: 2.7 } as unknown as typeof basePayload.inputs,
      }),
    ).rejects.toThrow(/severity must be 1\.\.5/);
  });

  it('accepts probability=1, severity=1 (lower boundary)', async () => {
    const r = await recordIperAssessment({
      ...basePayload,
      inputs: { probability: 1, severity: 1 },
      rawScore: 1,
    });
    expect(r.id).toBeTypeOf('string');
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('accepts probability=5, severity=5 (upper boundary)', async () => {
    const r = await recordIperAssessment({
      ...basePayload,
      inputs: { probability: 5, severity: 5 },
      rawScore: 25,
    });
    expect(r.id).toBeTypeOf('string');
  });

  it('rejects non-array suggestedControls', async () => {
    await expect(
      recordIperAssessment({
        ...basePayload,
        suggestedControls: 'just a string' as unknown as string[],
      }),
    ).rejects.toThrow(/suggestedControls must be an array/);
  });

  it('forwards durationMin into audit details when finite and positive', async () => {
    await recordIperAssessment({ ...basePayload, durationMin: 7.5 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { durationMin?: number }).durationMin).toBe(7.5);
  });

  it('omits durationMin when zero', async () => {
    await recordIperAssessment({ ...basePayload, durationMin: 0 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('omits durationMin when negative', async () => {
    await recordIperAssessment({ ...basePayload, durationMin: -1 });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('omits durationMin when Infinity', async () => {
    await recordIperAssessment({ ...basePayload, durationMin: Number.POSITIVE_INFINITY });
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as Record<string, unknown>)).not.toHaveProperty('durationMin');
  });

  it('audit details include assessmentId matching the returned id', async () => {
    const result = await recordIperAssessment(basePayload);
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { assessmentId: string }).assessmentId).toBe(result.id);
  });

  it('passes the projectId as the 4th arg to logAuditAction', async () => {
    await recordIperAssessment(basePayload);
    const call = logAuditActionMock.mock.calls[0];
    expect(call[3]).toBe('proj-1');
  });

  it('writes setDoc before invoking logAuditAction', async () => {
    const order: string[] = [];
    setDocMock.mockImplementation(() => {
      order.push('setDoc');
      return Promise.resolve(undefined);
    });
    logAuditActionMock.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve(undefined);
    });
    await recordIperAssessment(basePayload);
    expect(order).toEqual(['setDoc', 'audit']);
  });

  it('does not emit an audit log when setDoc rejects', async () => {
    setDocMock.mockImplementation(() => Promise.reject(new Error('rules denied')));
    await expect(recordIperAssessment(basePayload)).rejects.toThrow(/rules denied/);
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });
});

describe('signIperAssessment', () => {
  it('sets metadata.signedAt + metadata.signedBy and emits the signed audit entry', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        projectId: 'proj-1',
        level: 'moderado',
        metadata: { signedAt: null, author: 'user-1' },
      }),
    });

    await signIperAssessment('iper-1', 'gerente-uid');

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0];
    const update = patch as Record<string, unknown>;
    expect(update['metadata.signedBy']).toBe('gerente-uid');
    expect(update['metadata.signedAt']).toBeTypeOf('string');

    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
    const [action] = logAuditActionMock.mock.calls[0];
    expect(action).toBe('safety.iper.matrix.signed');
  });

  it('refuses to sign when already signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        projectId: 'proj-1',
        level: 'moderado',
        metadata: { signedAt: '2026-04-27T10:00:00.000Z' },
      }),
    });

    await expect(signIperAssessment('iper-1', 'gerente-uid')).rejects.toThrow(/already signed/i);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('refuses to sign a missing assessment', async () => {
    getDocMock.mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    });

    await expect(signIperAssessment('missing', 'gerente-uid')).rejects.toThrow(/not found/i);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('rejects empty id', async () => {
    await expect(signIperAssessment('', 'gerente-uid')).rejects.toThrow(/id required/);
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-string id', async () => {
    await expect(
      signIperAssessment(undefined as unknown as string, 'gerente-uid'),
    ).rejects.toThrow(/id required/);
  });

  it('rejects empty signerUid', async () => {
    await expect(signIperAssessment('iper-1', '')).rejects.toThrow(/signerUid required/);
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('rejects non-string signerUid', async () => {
    await expect(
      signIperAssessment('iper-1', 42 as unknown as string),
    ).rejects.toThrow(/signerUid required/);
  });

  it('quotes the missing id in the not-found error', async () => {
    getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(signIperAssessment('iper-xyz', 'gerente-uid')).rejects.toThrow(/iper-xyz/);
  });

  it('quotes the id in the already-signed error', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        projectId: 'proj-1',
        metadata: { signedAt: '2026-04-27T10:00:00.000Z' },
      }),
    });
    await expect(
      signIperAssessment('iper-already', 'gerente-uid'),
    ).rejects.toThrow(/iper-already/);
  });

  it('treats missing metadata block as not-yet-signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-1' }),
    });
    await signIperAssessment('iper-no-meta', 'gerente-uid');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(logAuditActionMock).toHaveBeenCalledTimes(1);
  });

  it('treats metadata.signedAt === null as not-yet-signed', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    await signIperAssessment('iper-null', 'gerente-uid');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });

  it('audit details include the same signedAt the patch wrote', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    await signIperAssessment('iper-iso', 'gerente-uid');
    const [, patch] = updateDocMock.mock.calls[0];
    const [, , details] = logAuditActionMock.mock.calls[0];
    expect((details as { signedAt: string }).signedAt).toBe(
      (patch as Record<string, string>)['metadata.signedAt'],
    );
    expect((details as { signerUid: string }).signerUid).toBe('gerente-uid');
    expect((details as { assessmentId: string }).assessmentId).toBe('iper-iso');
  });

  it('passes the stored projectId as the 4th arg to logAuditAction', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-77', metadata: { signedAt: null } }),
    });
    await signIperAssessment('iper-proj', 'gerente-uid');
    const call = logAuditActionMock.mock.calls[0];
    expect(call[3]).toBe('proj-77');
  });

  it('does not emit an audit log when updateDoc rejects', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ projectId: 'proj-1', metadata: { signedAt: null } }),
    });
    updateDocMock.mockImplementation(() => Promise.reject(new Error('write blocked')));
    await expect(
      signIperAssessment('iper-fail', 'gerente-uid'),
    ).rejects.toThrow(/write blocked/);
    expect(logAuditActionMock).not.toHaveBeenCalled();
  });
});
