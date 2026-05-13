import { describe, it, expect } from 'vitest';
import {
  linkNcToAction,
  evaluateNcCycleStage,
  bulkClassifyByPattern,
  type NonConformity,
  type CorrectiveActionRef,
} from './nonConformityEngine.js';

function nc(over: Partial<NonConformity> & { id: string }): NonConformity {
  return {
    id: over.id,
    source: over.source ?? 'audit',
    detectedAt: over.detectedAt ?? '2026-05-01T00:00:00Z',
    description: over.description ?? 'desc',
    severity: over.severity ?? 'minor',
    status: over.status ?? 'open',
    rootCauseKind: over.rootCauseKind,
    correctiveActionIds: over.correctiveActionIds,
    investigationStartedAt: over.investigationStartedAt,
    actionPlannedAt: over.actionPlannedAt,
    closedAt: over.closedAt,
    efficacyReviewedAt: over.efficacyReviewedAt,
  };
}

const action: CorrectiveActionRef = {
  id: 'act-1',
  ownerUid: 'u-1',
  createdAt: '2026-05-02T00:00:00Z',
};

describe('linkNcToAction', () => {
  it('appends action id and bumps status to action_planned', () => {
    const base = nc({ id: 'nc-1', status: 'open' });
    const { nc: updated, link } = linkNcToAction(base, action, '2026-05-02T10:00:00Z');
    expect(updated.correctiveActionIds).toEqual(['act-1']);
    expect(updated.status).toBe('action_planned');
    expect(updated.actionPlannedAt).toBe('2026-05-02T10:00:00Z');
    expect(link).toEqual({ ncId: 'nc-1', actionId: 'act-1', linkedAt: '2026-05-02T10:00:00Z' });
  });

  it('is idempotent when the same action is linked twice', () => {
    const base = nc({ id: 'nc-1', correctiveActionIds: ['act-1'], status: 'action_planned' });
    const { nc: updated } = linkNcToAction(base, action);
    expect(updated.correctiveActionIds).toEqual(['act-1']);
  });

  it('preserves closed/efficacy status (no regression to action_planned)', () => {
    const base = nc({ id: 'nc-1', status: 'closed', closedAt: '2026-05-03T00:00:00Z' });
    const { nc: updated } = linkNcToAction(base, action);
    expect(updated.status).toBe('closed');
  });
});

describe('evaluateNcCycleStage', () => {
  it('returns open by default', () => {
    expect(evaluateNcCycleStage(nc({ id: 'a' }))).toBe('open');
  });

  it('returns investigating when investigationStartedAt is set', () => {
    expect(
      evaluateNcCycleStage(nc({ id: 'a', investigationStartedAt: '2026-05-02T00:00:00Z' })),
    ).toBe('investigating');
  });

  it('returns action_planned when actions are linked', () => {
    expect(evaluateNcCycleStage(nc({ id: 'a', correctiveActionIds: ['x'] }))).toBe(
      'action_planned',
    );
  });

  it('returns closed and efficacy_reviewed with correct precedence', () => {
    expect(
      evaluateNcCycleStage(nc({ id: 'a', closedAt: '2026-05-05T00:00:00Z' })),
    ).toBe('closed');
    expect(
      evaluateNcCycleStage(
        nc({
          id: 'a',
          closedAt: '2026-05-05T00:00:00Z',
          efficacyReviewedAt: '2026-06-05T00:00:00Z',
        }),
      ),
    ).toBe('efficacy_reviewed');
  });
});

describe('bulkClassifyByPattern', () => {
  it('groups by rootCauseKind and orders by count desc then severity', () => {
    const result = bulkClassifyByPattern([
      nc({ id: '1', rootCauseKind: 'training_gap', severity: 'minor' }),
      nc({ id: '2', rootCauseKind: 'training_gap', severity: 'major' }),
      nc({ id: '3', rootCauseKind: 'equipment_failure', severity: 'critical' }),
      nc({ id: '4', rootCauseKind: 'training_gap', severity: 'critical' }),
    ]);
    expect(result[0].rootCauseKind).toBe('training_gap');
    expect(result[0].count).toBe(3);
    expect(result[1].rootCauseKind).toBe('equipment_failure');
    expect(result[1].severityIndex).toBe(3);
  });

  it('puts NCs without rootCauseKind under "unclassified"', () => {
    const result = bulkClassifyByPattern([nc({ id: '1' })]);
    expect(result[0].rootCauseKind).toBe('unclassified');
  });

  it('honors `top` option', () => {
    const result = bulkClassifyByPattern(
      [
        nc({ id: '1', rootCauseKind: 'a' }),
        nc({ id: '2', rootCauseKind: 'b' }),
        nc({ id: '3', rootCauseKind: 'c' }),
      ],
      { top: 2 },
    );
    expect(result).toHaveLength(2);
  });
});
