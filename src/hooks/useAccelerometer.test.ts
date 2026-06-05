// @vitest-environment jsdom
//
// B1 — useAccelerometer drives FALL DETECTION (life-safety). Before this fix the
// motion handler was recreated whenever the parent passed a new onFallDetected
// closure, so the listener was added with one function reference but removed
// with a different one — the old `devicemotion` listener leaked and the cleanup
// silently detached nothing. This pins: ONE stable listener, latest callback
// fires, and unmount removes the SAME reference.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/motion', () => ({
  Motion: { addListener: vi.fn(), removeAllListeners: vi.fn() },
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useAccelerometer } from './useAccelerometer';

beforeEach(() => {
  // Define DeviceMotionEvent WITHOUT requestPermission so the web path grants.
  (globalThis as unknown as { DeviceMotionEvent: unknown }).DeviceMotionEvent = function () {};
  (window as unknown as { DeviceMotionEvent: unknown }).DeviceMotionEvent =
    (globalThis as unknown as { DeviceMotionEvent: unknown }).DeviceMotionEvent;
});
afterEach(() => vi.restoreAllMocks());

describe('useAccelerometer — stable listener (B1 leak fix)', () => {
  it('keeps one devicemotion listener across callback changes and fires the latest', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const cbA = vi.fn();
    let cb: () => void = cbA;
    const { result, rerender, unmount } = renderHook(() =>
      useAccelerometer({ threshold: 25, onFallDetected: cb }),
    );

    await act(async () => { await result.current.start(); });

    const motionAdds = () => add.mock.calls.filter((c) => (c[0] as string) === 'devicemotion');
    expect(motionAdds()).toHaveLength(1);
    const handler = motionAdds()[0][1] as EventListener;

    // Parent passes a new closure + rerenders: the listener must stay stable.
    const cbB = vi.fn();
    cb = cbB;
    rerender();
    expect(motionAdds()).toHaveLength(1);

    // A fall fires the LATEST callback (cbB), not the stale one.
    const ev = new Event('devicemotion') as Event & { accelerationIncludingGravity?: object };
    ev.accelerationIncludingGravity = { x: 0, y: 0, z: 30 };
    act(() => { (handler as (e: Event) => void)(ev); });
    expect(cbB).toHaveBeenCalled();
    expect(cbA).not.toHaveBeenCalled();

    // Cleanup removes the SAME reference — no leak.
    unmount();
    const removedSame = remove.mock.calls.some(
      (c) => (c[0] as string) === 'devicemotion' && c[1] === handler,
    );
    expect(removedSame).toBe(true);
  });
});
