// @vitest-environment jsdom
//
// Sprint K §139-145 — smoke tests for AccessibilityContext.
//
// Covers:
//   1. Defaults: every flag is `false`.
//   2. Toggling each flag flips the documentElement class.
//   3. Preferences round-trip through localStorage under the
//      `accessibility-prefs-v1` key.
//   4. `lowConnectivity` flips dispatch the
//      `praeventio-low-connectivity-changed` event.
//   5. Reset clears everything (state + classes + storage).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  AccessibilityProvider,
  useAccessibility,
  ACCESSIBILITY_STORAGE_KEY,
  LOW_CONNECTIVITY_EVENT,
  __clearAccessibilityStorageForTests,
} from './AccessibilityContext';

beforeEach(() => {
  __clearAccessibilityStorageForTests();
});

interface HarnessHandle {
  toggle: (flag: 'easyReading' | 'highContrast' | 'glovesMode' | 'lowConnectivity', v: boolean) => void;
  reset: () => void;
}

function Harness({ handle }: { handle: HarnessHandle }) {
  const ctx = useAccessibility();
  // Expose the setters via the closure so tests can drive them
  // imperatively without re-rendering custom buttons.
  handle.toggle = (flag, v) => {
    if (flag === 'easyReading') ctx.setEasyReading(v);
    else if (flag === 'highContrast') ctx.setHighContrast(v);
    else if (flag === 'glovesMode') ctx.setGlovesMode(v);
    else ctx.setLowConnectivity(v);
  };
  handle.reset = ctx.reset;
  return (
    <ul data-testid="state">
      <li data-testid="easyReading">{String(ctx.easyReading)}</li>
      <li data-testid="highContrast">{String(ctx.highContrast)}</li>
      <li data-testid="glovesMode">{String(ctx.glovesMode)}</li>
      <li data-testid="lowConnectivity">{String(ctx.lowConnectivity)}</li>
    </ul>
  );
}

function mountHarness() {
  const handle: HarnessHandle = { toggle: () => {}, reset: () => {} };
  const utils = render(
    <AccessibilityProvider>
      <Harness handle={handle} />
    </AccessibilityProvider>,
  );
  return { handle, ...utils };
}

describe('AccessibilityContext', () => {
  it('starts with every flag disabled by default', () => {
    mountHarness();
    expect(screen.getByTestId('easyReading').textContent).toBe('false');
    expect(screen.getByTestId('highContrast').textContent).toBe('false');
    expect(screen.getByTestId('glovesMode').textContent).toBe('false');
    expect(screen.getByTestId('lowConnectivity').textContent).toBe('false');
  });

  it('applies CSS classes on <html> when each flag is enabled', () => {
    const { handle } = mountHarness();
    act(() => handle.toggle('glovesMode', true));
    expect(document.documentElement.classList.contains('glove-friendly')).toBe(true);

    act(() => handle.toggle('highContrast', true));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    act(() => handle.toggle('easyReading', true));
    expect(document.documentElement.classList.contains('easy-reading')).toBe(true);

    act(() => handle.toggle('lowConnectivity', true));
    expect(document.documentElement.classList.contains('low-connectivity')).toBe(true);
  });

  it('removes CSS classes when flags are disabled again', () => {
    const { handle } = mountHarness();
    act(() => handle.toggle('glovesMode', true));
    expect(document.documentElement.classList.contains('glove-friendly')).toBe(true);
    act(() => handle.toggle('glovesMode', false));
    expect(document.documentElement.classList.contains('glove-friendly')).toBe(false);
  });

  it('persists preferences to localStorage under the versioned key', () => {
    const { handle } = mountHarness();
    act(() => handle.toggle('easyReading', true));
    act(() => handle.toggle('glovesMode', true));

    const raw = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, boolean>;
    expect(parsed.easyReading).toBe(true);
    expect(parsed.glovesMode).toBe(true);
    expect(parsed.highContrast).toBe(false);
    expect(parsed.lowConnectivity).toBe(false);
  });

  it('rehydrates previous preferences from localStorage on mount', () => {
    window.localStorage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({
        easyReading: true,
        highContrast: false,
        glovesMode: true,
        lowConnectivity: false,
      }),
    );
    mountHarness();
    expect(screen.getByTestId('easyReading').textContent).toBe('true');
    expect(screen.getByTestId('glovesMode').textContent).toBe('true');
    expect(screen.getByTestId('highContrast').textContent).toBe('false');
    expect(screen.getByTestId('lowConnectivity').textContent).toBe('false');
  });

  it('dispatches the praeventio-low-connectivity-changed event when toggled', () => {
    const listener = vi.fn();
    window.addEventListener(LOW_CONNECTIVITY_EVENT, listener);
    try {
      const { handle } = mountHarness();
      // The initial effect fires once at mount with `false`.
      const baselineCalls = listener.mock.calls.length;
      act(() => handle.toggle('lowConnectivity', true));
      expect(listener.mock.calls.length).toBeGreaterThan(baselineCalls);
      const lastEvent = listener.mock.calls.at(-1)?.[0] as CustomEvent<{ lowConnectivity: boolean }>;
      expect(lastEvent.detail.lowConnectivity).toBe(true);
    } finally {
      window.removeEventListener(LOW_CONNECTIVITY_EVENT, listener);
    }
  });

  it('reset() clears every flag, the storage entry, and the html classes', () => {
    const { handle } = mountHarness();
    act(() => handle.toggle('easyReading', true));
    act(() => handle.toggle('highContrast', true));
    act(() => handle.toggle('glovesMode', true));
    act(() => handle.toggle('lowConnectivity', true));

    act(() => handle.reset());

    expect(screen.getByTestId('easyReading').textContent).toBe('false');
    expect(screen.getByTestId('highContrast').textContent).toBe('false');
    expect(screen.getByTestId('glovesMode').textContent).toBe('false');
    expect(screen.getByTestId('lowConnectivity').textContent).toBe('false');
    expect(document.documentElement.classList.contains('easy-reading')).toBe(false);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
    expect(document.documentElement.classList.contains('glove-friendly')).toBe(false);
    expect(document.documentElement.classList.contains('low-connectivity')).toBe(false);

    const raw = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
    expect(parsed?.easyReading ?? false).toBe(false);
    expect(parsed?.highContrast ?? false).toBe(false);
    expect(parsed?.glovesMode ?? false).toBe(false);
    expect(parsed?.lowConnectivity ?? false).toBe(false);
  });

  it('useAccessibility outside the provider throws a clear error', () => {
    const Bad = () => {
      useAccessibility();
      return null;
    };
    // Silence the React error logging for this expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Bad />)).toThrow(/AccessibilityProvider/);
    } finally {
      spy.mockRestore();
    }
  });

  it('children can read updated values via the hook (re-renders propagate)', () => {
    const reads: boolean[] = [];
    function Reader() {
      const { glovesMode } = useAccessibility();
      useEffect(() => {
        reads.push(glovesMode);
      }, [glovesMode]);
      return null;
    }
    const handle: HarnessHandle = { toggle: () => {}, reset: () => {} };
    render(
      <AccessibilityProvider>
        <Harness handle={handle} />
        <Reader />
      </AccessibilityProvider>,
    );
    act(() => handle.toggle('glovesMode', true));
    expect(reads).toContain(true);
  });
});
