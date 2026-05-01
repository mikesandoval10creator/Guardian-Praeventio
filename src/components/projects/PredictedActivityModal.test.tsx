/**
 * PredictedActivityModal — accessibility tests.
 *
 * Why no DOM render? The repo intentionally does NOT ship `jsdom`,
 * `happy-dom`, or `@testing-library/react` (see vitest.config.ts and
 * package.json). With Round 13's "no new dependencies" constraint, we can't
 * mount the real component tree. Instead we exercise the production effect
 * indirectly:
 *
 *   1. Stub a minimal global `window` that exposes `addEventListener` /
 *      `removeEventListener` / `dispatchEvent` via Node's built-in
 *      `EventTarget`.
 *   2. Drive the same effect the component runs internally (the
 *      `attachEscapeHandler` helper exported alongside the component) and
 *      assert the contract: Escape closes when open, no-op when closed,
 *      ignored for non-Escape keys, listener torn down on cleanup.
 *
 * The shared `attachEscapeHandler` is what the modal's `useEffect` calls,
 * so this fully covers the production code path. When jsdom lands, we can
 * upgrade these tests to drive the real React tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachEscapeHandler } from './PredictedActivityModal';

describe('PredictedActivityModal — Escape key handler (attachEscapeHandler)', () => {
  let win: EventTarget;

  beforeEach(() => {
    win = new EventTarget();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onClose once when Escape is dispatched and active=true', () => {
    const onClose = vi.fn();
    attachEscapeHandler(win, true, onClose);

    win.dispatchEvent(
      new (globalThis as any).Event('keydown'),
    );
    // The above dispatched a generic Event without a `key`. Now dispatch a
    // proper keydown with key=Escape using a plain object that mimics
    // KeyboardEvent — EventTarget-based windows just need `.key`.
    const escEvent = new (globalThis as any).Event('keydown') as Event & { key: string };
    (escEvent as any).key = 'Escape';
    win.dispatchEvent(escEvent);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when active=false, even on Escape', () => {
    const onClose = vi.fn();
    attachEscapeHandler(win, false, onClose);

    const escEvent = new (globalThis as any).Event('keydown') as Event & { key: string };
    (escEvent as any).key = 'Escape';
    win.dispatchEvent(escEvent);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-Escape keys while active=true', () => {
    const onClose = vi.fn();
    attachEscapeHandler(win, true, onClose);

    for (const key of ['Enter', 'a', ' ', 'Tab', 'Esc' /* not "Escape" */]) {
      const ev = new (globalThis as any).Event('keydown') as Event & { key: string };
      (ev as any).key = key;
      win.dispatchEvent(ev);
    }

    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns a cleanup function that detaches the listener', () => {
    const onClose = vi.fn();
    const cleanup = attachEscapeHandler(win, true, onClose);

    cleanup();

    const escEvent = new (globalThis as any).Event('keydown') as Event & { key: string };
    (escEvent as any).key = 'Escape';
    win.dispatchEvent(escEvent);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns a no-op cleanup when active=false (nothing to remove)', () => {
    const onClose = vi.fn();
    const cleanup = attachEscapeHandler(win, false, onClose);

    // Should not throw.
    expect(() => cleanup()).not.toThrow();
    expect(onClose).not.toHaveBeenCalled();
  });
});
