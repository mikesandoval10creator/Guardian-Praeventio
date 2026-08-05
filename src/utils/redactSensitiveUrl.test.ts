// Praeventio Guard — [P0] redactSensitiveUrl tests.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { redactSensitiveUrl } from './redactSensitiveUrl';

describe('redactSensitiveUrl', () => {
  it('masks the secret in legacy /vault/share/{tokenId}/{secret} URLs', () => {
    const out = redactSensitiveUrl('/vault/share/tok123/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(out).toBe('/vault/share/tok123/[REDACTED]');
  });

  it('masks the secret in file-proxy URLs with a trailing file name', () => {
    const out = redactSensitiveUrl(
      '/vault/share/tok123/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/resultado.pdf',
    );
    expect(out).toBe('/vault/share/tok123/[REDACTED]');
  });

  it('masks ANY 32+ char URL-safe path segment (generic token heuristic)', () => {
    const out = redactSensitiveUrl('/api/health-vault/file/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(out).toBe('/api/health-vault/file/[REDACTED]');
  });

  it('leaves normal URLs untouched', () => {
    expect(redactSensitiveUrl('/api/health')).toBe('/api/health');
    expect(redactSensitiveUrl('/vault/share/tok123')).toBe('/vault/share/tok123');
  });

  it('does not mask query strings or fragments (they never reach the server anyway)', () => {
    // The fragment form is the FIX; it must not be touched if it somehow
    // appears in a logged URL.
    const out = redactSensitiveUrl('/vault/share/tok123#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(out).toBe('/vault/share/tok123#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  });
});
