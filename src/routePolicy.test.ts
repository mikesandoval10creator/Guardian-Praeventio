import { describe, expect, it } from 'vitest';
import { shouldSkipLanding } from './routePolicy';

describe('shouldSkipLanding', () => {
  it('bypasses the anonymous landing for a cold emergency deep link', () => {
    expect(shouldSkipLanding('/emergency', '')).toBe(true);
    expect(shouldSkipLanding('/emergencia-avanzada', '')).toBe(true);
    expect(shouldSkipLanding('/hub/emergencies', '')).toBe(true);
  });

  it('bypasses the landing for other critical native destinations', () => {
    expect(shouldSkipLanding('/lone-worker', '')).toBe(true);
    expect(shouldSkipLanding('/worker-readiness', '')).toBe(true);
    expect(shouldSkipLanding('/notifications', '')).toBe(true);
    expect(shouldSkipLanding('/dashboard', '')).toBe(true);
  });

  it('keeps the real landing as the default root route', () => {
    expect(shouldSkipLanding('/', '')).toBe(false);
  });

  it('preserves existing public and push deep-link bypasses', () => {
    expect(shouldSkipLanding('/demo', '')).toBe(true);
    expect(shouldSkipLanding('/pricing', '')).toBe(true);
    expect(shouldSkipLanding('/anything', '?source=push')).toBe(true);
  });
});
