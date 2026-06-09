import { describe, it, expect } from 'vitest';
import {
  buildResponderFeed,
  buildResponderFromRoster,
  deriveAvailability,
  brigadeRoleToResponderRoles,
  type LastKnownPosition,
} from './responderFeed';
import type { BrigadeMember } from '../emergencyBrigade/emergencyBrigadeService';

const NOW = new Date('2026-06-08T12:00:00.000Z');
const NOW_MS = NOW.getTime();

function member(over: Partial<BrigadeMember> = {}): BrigadeMember {
  return {
    workerUid: 'w1',
    role: 'first_aid',
    trainedAt: '2026-01-01T00:00:00.000Z',
    trainingValidYears: 2,
    active: true,
    ...over,
  };
}

describe('brigadeRoleToResponderRoles', () => {
  it('maps first_aid → first_aid_certified (real cert, not invented)', () => {
    expect(brigadeRoleToResponderRoles('first_aid')).toEqual([
      'first_aid_certified',
    ]);
  });
  it('maps fire_response → fire_brigade', () => {
    expect(brigadeRoleToResponderRoles('fire_response')).toEqual([
      'fire_brigade',
    ]);
  });
  it('never fabricates paramedic/site_doctor from a brigade role', () => {
    const all = (
      [
        'brigade_chief',
        'first_aid',
        'fire_response',
        'evacuation_coordinator',
        'communications',
      ] as const
    ).flatMap((r) => brigadeRoleToResponderRoles(r));
    expect(all).not.toContain('paramedic');
    expect(all).not.toContain('site_doctor');
  });
});

describe('deriveAvailability (honest, fail-closed)', () => {
  it('active + valid training → on_duty', () => {
    expect(deriveAvailability(member(), NOW_MS)).toBe('on_duty');
  });
  it('inactive → off_site', () => {
    expect(deriveAvailability(member({ active: false }), NOW_MS)).toBe(
      'off_site',
    );
  });
  it('expired training → unavailable (not a fabricated ready)', () => {
    expect(
      deriveAvailability(
        member({ trainedAt: '2000-01-01T00:00:00.000Z' }),
        NOW_MS,
      ),
    ).toBe('unavailable');
  });
  it('unparseable trainedAt → unavailable (fail-closed)', () => {
    expect(
      deriveAvailability(member({ trainedAt: 'not-a-date' }), NOW_MS),
    ).toBe('unavailable');
  });
});

describe('buildResponderFromRoster', () => {
  it('REAL ping → REAL currentPosition + lastSeenAt', () => {
    const pos: LastKnownPosition = {
      uid: 'w1',
      lat: -33.45,
      lng: -70.66,
      seenAt: '2026-06-08T11:59:00.000Z',
    };
    const r = buildResponderFromRoster(member(), 'Ana', pos, NOW_MS);
    expect(r.currentPosition).toEqual({ lat: -33.45, lng: -70.66 });
    expect(r.lastSeenAt).toBe('2026-06-08T11:59:00.000Z');
    expect(r.availability).toBe('on_duty');
  });
  it('NO ping → position OMITTED (engine will emit no_position_known)', () => {
    const r = buildResponderFromRoster(member(), 'Ana', undefined, NOW_MS);
    expect(r.currentPosition).toBeUndefined();
    expect(r.lastSeenAt).toBeUndefined();
  });
  it('preserves floor when the real ping carries one', () => {
    const pos: LastKnownPosition = {
      uid: 'w1',
      lat: -33.45,
      lng: -70.66,
      floor: 3,
      seenAt: NOW.toISOString(),
    };
    const r = buildResponderFromRoster(member(), 'Ana', pos, NOW_MS);
    expect(r.currentPosition?.floor).toBe(3);
  });
});

describe('buildResponderFeed', () => {
  it('falls back to uid when no displayName is known', () => {
    const out = buildResponderFeed([member({ workerUid: 'w9' })], {}, {}, NOW);
    expect(out[0].name).toBe('w9');
  });
  it('merges roles for a worker holding two brigade roles', () => {
    const out = buildResponderFeed(
      [
        member({ workerUid: 'w1', role: 'first_aid' }),
        member({ workerUid: 'w1', role: 'fire_response' }),
      ],
      { w1: 'Ana' },
      {},
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].roles.sort()).toEqual(['fire_brigade', 'first_aid_certified']);
  });
  it('maps a real position only to the worker who owns it', () => {
    const pos: LastKnownPosition = {
      uid: 'w1',
      lat: -33.4,
      lng: -70.6,
      seenAt: NOW.toISOString(),
    };
    const out = buildResponderFeed(
      [member({ workerUid: 'w1' }), member({ workerUid: 'w2' })],
      {},
      { w1: pos },
      NOW,
    );
    const w1 = out.find((r) => r.uid === 'w1');
    const w2 = out.find((r) => r.uid === 'w2');
    expect(w1?.currentPosition).toBeDefined();
    expect(w2?.currentPosition).toBeUndefined();
  });
});
