// Unit tests for src/services/gamificationBackend.ts awardPoints (B6).
//
// The `reason` is interpolated into a Firestore field path
// (`completedChallenges.${reason}`), so a dotted/operator reason would be a
// field-path injection. awardPoints must reject any reason outside
// [A-Za-z0-9_]{1,64} before touching Firestore.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

import { awardPoints } from '../../services/gamificationBackend.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('awardPoints — field-path injection guard (B6)', () => {
  it('rejects a reason containing a dot (would nest into an arbitrary field path)', async () => {
    await expect(awardPoints('u1', 10, 'completedChallenges.admin')).rejects.toThrow(/field-path/);
    // Nothing was written.
    expect([...H.db!._store.keys()].length).toBe(0);
  });

  it('rejects reasons with path/operator characters and empty reason', async () => {
    for (const bad of ['a/b', 'a$b', 'a b', '', 'a.b']) {
      await expect(awardPoints('u1', 10, bad)).rejects.toThrow(/field-path/);
    }
  });

  it('rejects a non-finite amount and an empty uid', async () => {
    await expect(awardPoints('u1', Number.NaN, 'quiz_passed')).rejects.toThrow(/amount/);
    await expect(awardPoints('', 10, 'quiz_passed')).rejects.toThrow(/uid/);
  });

  it('accepts a safe whitelisted-style reason and records it', async () => {
    await awardPoints('u1', 25, 'training_completed');
    const stats = H.db!._store.get('user_stats/u1') as Record<string, unknown> | undefined;
    expect(stats).toBeDefined();
    expect(stats!.points).toBe(25);
    // The reason lands as a key under completedChallenges (no nesting).
    expect((stats!.completedChallenges as Record<string, unknown>).training_completed).toBeDefined();
  });
});
