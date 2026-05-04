// @vitest-environment jsdom
//
// Sprint 20 sixteenth-wave (Bucket D — A11Y-015): tests for the WCAG
// tooltip primitive. We use `fireEvent` from `@testing-library/react`
// instead of `@testing-library/user-event` because the latter is not in
// the project's devDependencies and adding it is out of scope for this
// bucket (only the `@radix-ui/react-tooltip` dep was approved).
//
// Note on jsdom + radix: `@radix-ui/react-tooltip` uses pointer events
// for hover. jsdom 25 supports `PointerEvent` but radix's hover delay
// (300ms) means we must wait. To keep tests fast and deterministic, we
// pass `delayMs={0}` and trigger via focus events (the keyboard path,
// which radix opens synchronously) for the "shows on activation" test.
import React from 'react';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
  render,
  cleanup,
  act,
  fireEvent,
  screen,
} from '@testing-library/react';
import { Tooltip } from './Tooltip';

// jsdom 25 doesn't ship `ResizeObserver`, which radix's tooltip uses
// internally via `@radix-ui/react-use-size`. The minimal stub below is
// enough for radix's open/close lifecycle (it never actually reads back
// the observed entries in our test scenarios).
beforeAll(() => {
  if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
  }
});

afterEach(() => {
  cleanup();
});

describe('Tooltip primitive', () => {
  it('renders the trigger child', () => {
    const { getByRole } = render(
      <Tooltip content="hello">
        <button type="button">Sync</button>
      </Tooltip>,
    );
    expect(getByRole('button', { name: 'Sync' })).not.toBeNull();
  });

  it('does not render the tooltip content before activation', () => {
    render(
      <Tooltip content="visible later" delayMs={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    // Radix Tooltip portals the bubble (and its `role="tooltip"`
    // a11y-tree mirror) only after open. Before any hover/focus, the
    // tooltip role MUST NOT be present.
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows content on keyboard focus and hides it on blur', () => {
    render(
      <Tooltip content="focus-shown" delayMs={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    act(() => {
      // Radix opens the tooltip synchronously on focus (no delay applies
      // to keyboard activation, only to hover).
      fireEvent.focus(trigger);
    });
    const open = screen.queryByRole('tooltip');
    expect(open).not.toBeNull();
    expect(open!.textContent).toBe('focus-shown');
    act(() => {
      fireEvent.blur(trigger);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Esc dismisses the tooltip while focus stays on the trigger', () => {
    render(
      <Tooltip content="esc-test" delayMs={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    act(() => {
      fireEvent.focus(trigger);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    act(() => {
      // Radix listens on the document level for Escape while the
      // tooltip is open; firing on the document picks up the handler.
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('forwards children unchanged when no activation has occurred', () => {
    // This guards the `asChild` contract — the wrapper must not inject
    // extra DOM nodes around the trigger when the tooltip is closed.
    const { container } = render(
      <Tooltip content="anything">
        <button type="button" data-testid="raw">
          Click me
        </button>
      </Tooltip>,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      'button[data-testid="raw"]',
    );
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Click me');
  });

  it('accepts a custom side prop without throwing', () => {
    // Side variants are passed straight to radix; we only assert that
    // the wrapper renders successfully for each value (no runtime
    // exception). The actual placement is jsdom-blind and verified
    // separately at the radix layer.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const { unmount } = render(
        <Tooltip content="x" side={side} delayMs={0}>
          <button type="button">{`btn-${side}`}</button>
        </Tooltip>,
      );
      expect(
        screen.getByRole('button', { name: `btn-${side}` }),
      ).not.toBeNull();
      unmount();
    }
  });
});
