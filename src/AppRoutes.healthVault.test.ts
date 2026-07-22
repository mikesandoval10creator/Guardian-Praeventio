import { describe, expect, it } from 'vitest';

import {
  safeVaultReturnTo,
  shouldRequireCompanyOnboarding,
} from './routes/healthVaultRoutePolicy';

describe('Health Vault routing isolation', () => {
  it('does not force a new external professional into company onboarding', () => {
    expect(
      shouldRequireCompanyOnboarding({
        hasUser: true,
        onboarded: false,
        pathname: '/vault/share/grant-1',
      }),
    ).toBe(false);
  });

  it('keeps company onboarding for ordinary application routes', () => {
    expect(
      shouldRequireCompanyOnboarding({
        hasUser: true,
        onboarded: false,
        pathname: '/projects',
      }),
    ).toBe(true);
  });

  it('accepts only an internal Health Vault login return path', () => {
    expect(safeVaultReturnTo('/vault/share/grant-1')).toBe('/vault/share/grant-1');
    expect(safeVaultReturnTo('https://attacker.example/vault/share/grant-1')).toBe('/');
    expect(safeVaultReturnTo('//attacker.example/vault/share/grant-1')).toBe('/');
    expect(safeVaultReturnTo('/projects')).toBe('/');
  });
});
