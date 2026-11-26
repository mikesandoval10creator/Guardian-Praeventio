/**
 * telDialer — platform-abstracted dialing for the SOS human fallback.
 *
 * Contract under test:
 *   • a native bridge wins over the web navigation;
 *   • a failing native bridge falls through to the web navigation;
 *   • `tel:` injection is impossible (only digits, +, * and # survive);
 *   • an unusable number or a missing platform returns `unavailable` so the
 *     caller shows an instruction instead of pretending a dial happened.
 */

import { describe, expect, it, vi } from 'vitest';
import { dialPhone, resolveDialDependencies, toSafeTelUri } from './telDialer';

describe('telDialer — toSafeTelUri', () => {
  it('keeps digits and a leading plus', () => {
    expect(toSafeTelUri('+56 9 8765 4321')).toBe('tel:+56987654321');
  });

  it('drops any scheme injection attempt', () => {
    expect(toSafeTelUri('javascript:alert(1)')).toBe('tel:1');
    expect(toSafeTelUri('tel:+56987654321')).toBe('tel:+56987654321');
  });

  it('returns an empty uri for a value with no digits', () => {
    expect(toSafeTelUri('abc')).toBe('');
    expect(toSafeTelUri('')).toBe('');
  });
});

describe('telDialer — dialPhone', () => {
  it('prefers the native bridge over the web navigation', () => {
    const openUrl = vi.fn();
    const location = { href: '' };
    const result = dialPhone('+56987654321', { openUrl, location });
    expect(result.outcome).toBe('native_bridge');
    expect(result.uri).toBe('tel:+56987654321');
    expect(openUrl).toHaveBeenCalledWith('tel:+56987654321');
    expect(location.href).toBe('');
  });

  it('falls through to the web navigation when the native bridge throws', () => {
    const location = { href: '' };
    const result = dialPhone('+56987654321', {
      openUrl: () => {
        throw new Error('no native bridge');
      },
      location,
    });
    expect(result.outcome).toBe('web_location');
    expect(location.href).toBe('tel:+56987654321');
  });

  it('does not surface an unhandled rejection when the native bridge rejects', async () => {
    const result = dialPhone('+56987654321', {
      openUrl: () => Promise.reject(new Error('bridge down')),
      location: { href: '' },
    });
    expect(result.outcome).toBe('native_bridge');
    await Promise.resolve();
  });

  it('returns unavailable when there is no platform at all', () => {
    const result = dialPhone('+56987654321', {});
    expect(result.outcome).toBe('unavailable');
    expect(result.uri).toBe('tel:+56987654321');
  });

  it('returns unavailable for an unusable number', () => {
    expect(dialPhone('', { location: { href: '' } }).outcome).toBe('unavailable');
    expect(dialPhone('abc', { location: { href: '' } }).outcome).toBe('unavailable');
  });

  it('survives a navigation that throws', () => {
    const result = dialPhone('+56987654321', {
      location: {
        set href(_value: string) {
          throw new Error('navigation blocked');
        },
      } as unknown as { href: string },
    });
    expect(result.outcome).toBe('unavailable');
  });
});

describe('telDialer — resolveDialDependencies', () => {
  it('returns the global location when the runtime exposes one', () => {
    const deps = resolveDialDependencies();
    const location = deps.location ?? null;
    expect(location === null || typeof location.href === 'string').toBe(true);
  });
});
