// @vitest-environment jsdom
//
// The critical safety invariant: when `enabled={false}` the provider must be a
// PURE passthrough — it early-returns `<>{children}</>` BEFORE `SystemEngineInner`
// runs any context hook (useFirebase/useEmergency/useSubscription/…). This is
// what makes wiring it into AppProviders (off by default) behavior-neutral: the
// geofence→SOS / tier-reactivity automation never starts until ops opts in.
//
// The test proves it by mocking NOTHING. If the disabled path touched any of
// those context hooks, this bare render would throw "must be used within a
// Provider". A clean render = the passthrough holds.

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SystemEngineProvider } from './SystemEngineProvider';

describe('SystemEngineProvider', () => {
  it('is a pure passthrough when disabled — renders children, starts no engine, needs no providers', () => {
    render(
      <SystemEngineProvider tenantId="tenant-x" enabled={false}>
        <div data-testid="child">hello</div>
      </SystemEngineProvider>,
    );
    const child = screen.getByTestId('child');
    expect(child).toBeTruthy();
    expect(child.textContent).toBe('hello');
  });

  it('renders children inside a fragment (no wrapper DOM) when disabled', () => {
    const { container } = render(
      <SystemEngineProvider tenantId="t" enabled={false}>
        <span>x</span>
      </SystemEngineProvider>,
    );
    // Disabled path returns a fragment, so the span is a direct child of the
    // render container — no engine wrapper element is introduced.
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });
});
