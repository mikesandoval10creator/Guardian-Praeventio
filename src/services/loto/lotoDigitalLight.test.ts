import { describe, it, expect } from 'vitest';
import {
  validateLotoApplication,
  validateRelease,
  applyFullRelease,
  type LotoApplication,
} from './lotoDigitalLight.js';

function app(over: Partial<LotoApplication> & { id: string }): LotoApplication {
  return {
    id: over.id,
    equipmentId: over.equipmentId ?? 'eq1',
    leaderUid: over.leaderUid ?? 'leader',
    authorizedWorkerUids: over.authorizedWorkerUids ?? ['w1', 'w2'],
    energiesIdentified: over.energiesIdentified ?? ['electric'],
    lockPoints: over.lockPoints ?? [
      {
        pointId: 'p1',
        description: 'breaker principal',
        energyType: 'electric',
        appliedByUid: 'leader',
        appliedAt: '2026-05-11T08:00:00Z',
        tagId: 'tag-001',
        zeroEnergyVerified: true,
      },
    ],
    appliedAt: over.appliedAt ?? '2026-05-11T08:00:00Z',
    workDescription: 'mantención',
    fullyReleasedAt: over.fullyReleasedAt,
  };
}

describe('validateLotoApplication', () => {
  it('todas las energías con lock point + zero verified → authorizesWork=true', () => {
    const r = validateLotoApplication(app({ id: 'a' }));
    expect(r.allEnergiesLocked).toBe(true);
    expect(r.allZeroEnergyVerified).toBe(true);
    expect(r.authorizesWork).toBe(true);
  });

  it('energía sin lock point → no autoriza', () => {
    const r = validateLotoApplication(
      app({
        id: 'a',
        energiesIdentified: ['electric', 'pressure'],
      }),
    );
    expect(r.allEnergiesLocked).toBe(false);
    expect(r.unlockedEnergies).toContain('pressure');
    expect(r.authorizesWork).toBe(false);
  });

  it('lock point sin zero verified → no autoriza', () => {
    const r = validateLotoApplication(
      app({
        id: 'a',
        lockPoints: [
          {
            pointId: 'p1',
            description: 'breaker',
            energyType: 'electric',
            appliedByUid: 'leader',
            appliedAt: '2026-05-11T08:00:00Z',
            tagId: 't1',
            zeroEnergyVerified: false,
          },
        ],
      }),
    );
    expect(r.allZeroEnergyVerified).toBe(false);
    expect(r.authorizesWork).toBe(false);
  });

  it('fullyReleased → no authorizesWork (aunque todo aplicado)', () => {
    const r = validateLotoApplication(app({ id: 'a', fullyReleasedAt: '2026-05-11T16:00:00Z' }));
    expect(r.authorizesWork).toBe(false);
  });
});

describe('validateRelease', () => {
  it('líder puede liberar', () => {
    const r = validateRelease(app({ id: 'a' }), {
      applicationId: 'a',
      releaserUid: 'leader',
      at: '2026-05-11T16:00:00Z',
    });
    expect(r.canRelease).toBe(true);
  });

  it('worker autorizado puede liberar', () => {
    const r = validateRelease(app({ id: 'a' }), {
      applicationId: 'a',
      releaserUid: 'w1',
      at: '2026-05-11T16:00:00Z',
    });
    expect(r.canRelease).toBe(true);
  });

  it('worker NO autorizado NO puede liberar', () => {
    const r = validateRelease(app({ id: 'a' }), {
      applicationId: 'a',
      releaserUid: 'rando',
      at: '2026-05-11T16:00:00Z',
    });
    expect(r.canRelease).toBe(false);
  });

  it('ya liberado → no puede liberar de nuevo', () => {
    const r = validateRelease(
      app({ id: 'a', fullyReleasedAt: '2026-05-11T15:00:00Z' }),
      { applicationId: 'a', releaserUid: 'leader', at: '2026-05-11T16:00:00Z' },
    );
    expect(r.canRelease).toBe(false);
  });
});

describe('applyFullRelease', () => {
  it('libera todos los lock points + setea fullyReleasedAt', () => {
    const updated = applyFullRelease(app({ id: 'a' }), 'leader', '2026-05-11T16:00:00Z');
    expect(updated.fullyReleasedAt).toBe('2026-05-11T16:00:00Z');
    expect(updated.lockPoints[0].releasedByUid).toBe('leader');
    expect(updated.lockPoints[0].releasedAt).toBe('2026-05-11T16:00:00Z');
  });

  it('NO muta el input original', () => {
    const original = app({ id: 'a' });
    const updated = applyFullRelease(original, 'leader', '2026-05-11T16:00:00Z');
    expect(original.fullyReleasedAt).toBeUndefined();
    expect(updated).not.toBe(original);
  });
});
