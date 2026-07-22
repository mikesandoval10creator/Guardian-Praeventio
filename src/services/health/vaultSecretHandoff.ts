const HANDOFF_TTL_MS = 10 * 60 * 1000;

type VaultSecretHandoff = { secret: string; expiresAt: number };

// Intentionally process-memory only. A clinical QR secret must not enter a URL,
// history.state, localStorage or sessionStorage while the SPA sends the user
// through its login route.
const handoffs = new Map<string, VaultSecretHandoff>();

function nonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createVaultSecretHandoff(
  secret: string,
  now: () => number = Date.now,
): string {
  if (!secret) throw new Error('vault_secret_required');
  const id = nonce();
  handoffs.set(id, { secret, expiresAt: now() + HANDOFF_TTL_MS });
  return id;
}

export function consumeVaultSecretHandoff(
  id: string | undefined,
  now: () => number = Date.now,
): string {
  if (!id) return '';
  const handoff = handoffs.get(id);
  handoffs.delete(id);
  if (!handoff || handoff.expiresAt < now()) return '';
  return handoff.secret;
}
