import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  __resetNativeManDownStateForTests,
  isNativeManDownActive,
  setNativeManDownActive,
  subscribeNativeManDownActive,
} from './nativeManDownState';

beforeEach(() => {
  __resetNativeManDownStateForTests();
});

describe('nativeManDownState', () => {
  it('starts inactive', () => {
    expect(isNativeManDownActive()).toBe(false);
  });

  it('notifies subscribers only on real transitions', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNativeManDownActive(listener);

    setNativeManDownActive(true);
    setNativeManDownActive(true); // idempotent — no duplicate notification
    setNativeManDownActive(false);

    expect(listener.mock.calls).toEqual([[true], [false]]);
    unsubscribe();
  });

  it('keeps other subscribers alive when one throws', () => {
    const bad = vi.fn(() => {
      throw new Error('subscriber exploded');
    });
    const good = vi.fn();
    subscribeNativeManDownActive(bad);
    subscribeNativeManDownActive(good);

    expect(() => setNativeManDownActive(true)).not.toThrow();
    expect(good).toHaveBeenCalledWith(true);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNativeManDownActive(listener);
    unsubscribe();

    setNativeManDownActive(true);

    expect(listener).not.toHaveBeenCalled();
  });
});
