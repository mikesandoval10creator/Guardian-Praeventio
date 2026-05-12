import { describe, it, expect, vi } from 'vitest';
import { deactivateUser } from './userLifecycle.js';

function buildAuthAdmin(opts: {
  revokeImpl?: (uid: string) => Promise<void>;
  setClaimsImpl?: (uid: string, claims: any) => Promise<void>;
} = {}) {
  const revoke = vi.fn(opts.revokeImpl ?? (async () => undefined));
  const setClaims = vi.fn(opts.setClaimsImpl ?? (async () => undefined));
  const inner = {
    revokeRefreshTokens: revoke,
    setCustomUserClaims: setClaims,
  };
  // The helper accepts `typeof admin.auth` — a function that returns the
  // Auth instance. We mock that shape with a thunk.
  const adminAuth = () => inner as any;
  return { adminAuth: adminAuth as any, revoke, setClaims };
}

describe('deactivateUser', () => {
  it('revokes refresh tokens AND sets inactive claim with revokedAt', async () => {
    const { adminAuth, revoke, setClaims } = buildAuthAdmin();

    const before = Date.now();
    const result = await deactivateUser(adminAuth, 'uid-123');
    const after = Date.now();

    expect(result.uid).toBe('uid-123');
    expect(result.applied).toBe(true);
    expect(result.revokedAt).toBeGreaterThanOrEqual(before);
    expect(result.revokedAt).toBeLessThanOrEqual(after);

    expect(revoke).toHaveBeenCalledExactlyOnceWith('uid-123');
    expect(setClaims).toHaveBeenCalledOnce();
    const [claimUid, claims] = setClaims.mock.calls[0];
    expect(claimUid).toBe('uid-123');
    expect(claims).toMatchObject({ role: 'inactive' });
    expect(claims.revokedAt).toBe(result.revokedAt);
  });

  it('throws TypeError when uid is missing', async () => {
    const { adminAuth } = buildAuthAdmin();
    await expect(deactivateUser(adminAuth, '')).rejects.toBeInstanceOf(TypeError);
    await expect(deactivateUser(adminAuth, undefined as any)).rejects.toBeInstanceOf(TypeError);
  });

  it('propagates revokeRefreshTokens errors (Firebase Auth offline / unknown uid)', async () => {
    const { adminAuth } = buildAuthAdmin({
      revokeImpl: async () => {
        const err: any = new Error('user not found');
        err.code = 'auth/user-not-found';
        throw err;
      },
    });
    await expect(deactivateUser(adminAuth, 'uid-missing')).rejects.toThrow(
      /user not found/,
    );
  });

  it('does NOT set claims if revoke fails (atomic intent)', async () => {
    const { adminAuth, setClaims } = buildAuthAdmin({
      revokeImpl: async () => {
        throw new Error('revoke transient failure');
      },
    });
    await expect(deactivateUser(adminAuth, 'uid-9')).rejects.toThrow();
    expect(setClaims).not.toHaveBeenCalled();
  });
});
