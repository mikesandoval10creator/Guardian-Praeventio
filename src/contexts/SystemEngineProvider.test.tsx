// @vitest-environment jsdom
//
// The critical safety invariant: when `enabled={false}` the provider must be a
// PURE passthrough — it early-returns `<>{children}</>` BEFORE `SystemEngineInner`
// runs any context hook (useFirebase/useEmergency/useSubscription/…). This is
// what makes wiring it into AppProviders (off by default) behavior-neutral: the
// geofence→SOS / tier-reactivity automation never starts until ops opts in.
//
// Firebase is mocked only to prevent eager auth initialisation from asking
// jsdom for document.cookie during module evaluation. The test still provides
// no React context providers; if the disabled path touched any of those
// context hooks, this bare render would throw "must be used within a Provider".

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../services/firebase', () => ({ auth: {}, db: {} }));

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
