import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLookupKeyring } = require('../../../scripts/health-professional-lookup-keyring.cjs') as {
  validateLookupKeyring(value: unknown, options?: { minimumEntries?: number }): boolean;
};

describe('health professional lookup keyring validation', () => {
  it('accepts ordered strong versioned keys', () => {
    expect(validateLookupKeyring({
      '2026-07': 'n'.repeat(64),
      '2026-01': 'o'.repeat(64),
    }, { minimumEntries: 2 })).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { 'bad version': 'n'.repeat(64) },
    { '2026-07': 'short' },
  ])('rejects malformed or weak keyrings: %j', (value) => {
    expect(validateLookupKeyring(value)).toBe(false);
  });
});
