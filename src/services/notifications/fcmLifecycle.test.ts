// Praeventio Guard \u2014 tests for the FCM device-token lifecycle helper.

import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import { clearUserFcmTokens } from '../../services/notifications/fcmLifecycle.js';

let H: { db: ReturnType<typeof createFakeFirestore> | null } = { db: null };

beforeEach(() => {
  H.db = createFakeFirestore();
});

// We mock firebase-admin the same way the other notification tests do so the
// helper picks up our in-memory firestore.
import { vi } from 'vitest';
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

describe('clearUserFcmTokens', () => {
  it('returns 0 when the user doc does not exist (idempotent, not an error)', async () => {
    const result = await clearUserFcmTokens('uid-missing');
    expect(result).toEqual({ removed: 0 });
  });

  it('returns 0 when the user doc has no fcmTokens field', async () => {
    H.db!._seed('users/uid-no-tokens', { displayName: 'no-tokens' });
    const result = await clearUserFcmTokens('uid-no-tokens');
    expect(result).toEqual({ removed: 0 });
  });

  it('removes every token and stamps lastTokenUnregisteredAt', async () => {
    H.db!._seed('users/uid-multi', {
      fcmTokens: ['tok-android', 'tok-web', 'tok-tablet'],
    });
    const result = await clearUserFcmTokens('uid-multi');
    expect(result.removed).toBe(3);

    const after = H.db!._dump()['users/uid-multi'] as Record<string, unknown>;
    expect(after.fcmTokens).toBeUndefined();
    expect(after.lastTokenUnregisteredAt).toBeTruthy();
  });

  it('rejects on a non-string uid', async () => {
    await expect(clearUserFcmTokens('')).rejects.toThrow(/non-empty uid/);
  });

  it('ignores malformed entries in fcmTokens and only counts valid strings', async () => {
    H.db!._seed('users/uid-dirty', {
      fcmTokens: ['tok-valid', '', 42, null, 'tok-also-valid', undefined],
    });
    const result = await clearUserFcmTokens('uid-dirty');
    expect(result.removed).toBe(2);
    const after = H.db!._dump()['users/uid-dirty'] as Record<string, unknown>;
    expect(after.fcmTokens).toBeUndefined();
  });
});
