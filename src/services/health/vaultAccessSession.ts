import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface VaultAccessSession {
  id: string;
  grantId: string;
  professionalUid: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export class VaultAccessSessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_session'
      | 'session_expired'
      | 'session_revoked'
      | 'session_scope_mismatch',
  ) {
    super(message);
    this.name = 'VaultAccessSessionError';
  }
}

function secureEqualSecret(secret: string, expectedHash: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const computed = createHash('sha256').update(secret, 'utf8').digest();
  const expected = Buffer.from(expectedHash, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function createVaultAccessSession(input: {
  grantId: string;
  professionalUid: string;
  ttlMinutes?: number;
  now?: () => number;
}): { record: VaultAccessSession; secret: string } {
  if (!input.grantId || !input.professionalUid) {
    throw new VaultAccessSessionError('Session scope is required', 'session_scope_mismatch');
  }
  const ttlMinutes = input.ttlMinutes ?? 10;
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 30) {
    throw new VaultAccessSessionError('Session TTL is invalid', 'invalid_session');
  }
  const at = (input.now ?? Date.now)();
  const secret = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(secret, 'utf8').digest('hex');
  return {
    secret,
    record: {
      id: `hvs_${randomBytes(12).toString('base64url')}`,
      grantId: input.grantId,
      professionalUid: input.professionalUid,
      tokenHash,
      createdAt: at,
      expiresAt: at + ttlMinutes * 60_000,
      revokedAt: null,
    },
  };
}

export function validateVaultAccessSession(
  session: VaultAccessSession,
  secret: string,
  scope: {
    grantId: string;
    professionalUid: string;
    now?: () => number;
  },
): void {
  if (session.grantId !== scope.grantId || session.professionalUid !== scope.professionalUid) {
    throw new VaultAccessSessionError('Session scope mismatch', 'session_scope_mismatch');
  }
  if (session.revokedAt !== null) {
    throw new VaultAccessSessionError('Session revoked', 'session_revoked');
  }
  if ((scope.now ?? Date.now)() > session.expiresAt) {
    throw new VaultAccessSessionError('Session expired', 'session_expired');
  }
  if (!secureEqualSecret(secret, session.tokenHash)) {
    throw new VaultAccessSessionError('Invalid session', 'invalid_session');
  }
}

export function revokeVaultAccessSession(
  session: VaultAccessSession,
  options: { now?: () => number } = {},
): VaultAccessSession {
  if (session.revokedAt !== null) return session;
  return { ...session, revokedAt: (options.now ?? Date.now)() };
}
