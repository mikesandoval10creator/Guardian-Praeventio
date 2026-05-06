// Sprint 32 wire W4 — verifica que recordErgonomicAssessment invoca
// awardXp con reason 'ergonomic_assessment_completed' fire-and-forget.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const awardXpMock: AnyMock = vi.fn();
vi.mock('../gamification/positiveXp', () => ({
  awardXp: (...args: unknown[]) => (awardXpMock as (...a: unknown[]) => unknown)(...args),
}));

const { recordErgonomicAssessment } = await import('./ergonomicAssessments');

const basePayload = {
  workerId: 'worker-1',
  projectId: 'proj-1',
  inputs: {},
  computedAt: '2026-05-05T00:00:00.000Z',
  authorUid: 'uid-prev-1',
};

beforeEach(() => {
  awardXpMock.mockReset();
  setDocMock.mockClear();
  logAuditActionMock.mockClear();
});

describe('recordErgonomicAssessment — XP hook', () => {
  it('awards ergonomic_assessment_completed after successful save', async () => {
    await recordErgonomicAssessment({
      ...basePayload,
      type: 'REBA',
      score: 5,
      actionLevel: 'low',
    });

    const calls = awardXpMock.mock.calls.filter(
      (c) => c[0] === 'ergonomic_assessment_completed',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({
      workerId: 'worker-1',
      authorUid: 'uid-prev-1',
      type: 'REBA',
      score: 5,
    });
  });

  it('does not break the save when awardXp throws', async () => {
    awardXpMock.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      recordErgonomicAssessment({
        ...basePayload,
        type: 'RULA',
        score: 3,
        actionLevel: 1,
      }),
    ).resolves.toBeDefined();
    expect(setDocMock).toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
