import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { pruneFcmTokens } from './pruneFcmTokens';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('pruneFcmTokens', () => {
  it('removes each dead token from every user that carries it, leaving live tokens', async () => {
    H.db!._seed('users/u1', { fcmTokens: ['live1', 'dead1', 'live2'] });
    H.db!._seed('users/u2', { fcmTokens: ['dead1', 'live3'] }); // dead1 on two users
    H.db!._seed('users/u3', { fcmTokens: ['live4'] });

    const removed = await pruneFcmTokens(H.db! as never, ['dead1', 'ghost-absent']);

    // dead1 removed from u1 and u2 → 2 removals; ghost-absent matches nobody.
    expect(removed).toBe(2);
    expect(H.db!._dump()['users/u1'].fcmTokens).toEqual(['live1', 'live2']);
    expect(H.db!._dump()['users/u2'].fcmTokens).toEqual(['live3']);
    expect(H.db!._dump()['users/u3'].fcmTokens).toEqual(['live4']);
  });

  it('is a no-op for an empty / non-array input (no queries)', async () => {
    expect(await pruneFcmTokens(H.db! as never, [])).toBe(0);
    expect(await pruneFcmTokens(H.db! as never, undefined as never)).toBe(0);
  });
});
