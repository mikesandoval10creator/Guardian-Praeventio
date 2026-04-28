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
});
