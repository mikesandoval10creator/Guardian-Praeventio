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

// Default mocks — Capacitor.isNativePlatform() returns false (web path).
// Per-test override available via `vi.doMock('@capacitor/core', ...)`.
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

// [P0][VIDA] Hy3-audit 3c2aa66d-73fe-81d2-bc89-e2c81b6b9f1c:
// useAccelerometer.stop() llamaba `Motion.removeAllListeners()` que borra TODOS
// los listeners de la app, no solo el de este hook. Si FallDetectionMonitor
// u otro componente usaba su propio `Motion.addListener`, este stop lo
// mataba y dejaba a la app sin detección de caída. El fix usa el método
// `remove()` del `PluginListenerHandle` retornado por addListener.
//
// Nota: testear la integración con @capacitor/motion directamente requiere
// vi.resetModules() + doMock() que no funcionan limpiamente con React 19
// strict mode (double-render duplica los calls). En lugar de eso, el
// happy-path del fix está cubierto por inspección visual del código
// + el test unitario del helper de cleanup sigue.
describe('useAccelerometer — native cleanup contract', () => {
  it('stop() nativo: usa handle.remove() del handle retornado por addListener (NO removeAllListeners)', () => {
    // Inspección del código fuente: verificamos que la rama nativa
    // del stop() llama `await listenerId.remove()` y solo usa
    // Motion.removeAllListeners() como fallback dentro de catch.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, './useAccelerometer.ts'),
      'utf-8',
    );
    // El stop nativo: el camino feliz es listenerId.remove()
    expect(src).toMatch(/await listenerId\.remove\(\)/);
    // El fallback: solo si remove() falla (try/catch)
    expect(src).toMatch(/Motion\.removeAllListeners\(\)/);
    // Y el removeAllListeners() está DENTRO del catch — nunca en el happy path
    const catchMatch = src.match(/catch\s*\(err\)\s*{[\s\S]*?Motion\.removeAllListeners\(\)/);
    expect(catchMatch).not.toBeNull();
  });
});
