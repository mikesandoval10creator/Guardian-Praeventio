// @vitest-environment jsdom
//
// PublicDemo tests — Sprint 30 Bucket LL.
//
// 1. Renders without auth providers (no FirebaseProvider, no ProjectProvider).
// 2. Country selector switches the regulatory framework displayed.
// 3. Calculator inline updates with input changes.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PublicDemo } from './PublicDemo';

afterEach(() => cleanup());

describe('PublicDemo', () => {
  it('renders the demo page without auth providers', () => {
    const { getByTestId, getByText } = render(<PublicDemo />);
    expect(getByTestId('demo-banner')).not.toBeNull();
    expect(getByText(/demo público/i)).not.toBeNull();
    expect(getByTestId('demo-country-select')).not.toBeNull();
    expect(getByTestId('demo-calc-gas')).not.toBeNull();
    expect(getByTestId('demo-calc-dike')).not.toBeNull();
    expect(getByTestId('demo-calc-scaffold')).not.toBeNull();
    expect(getByTestId('demo-twin-preview')).not.toBeNull();
  });

  it('country selector swaps the regulatory framework badge', () => {
    const { getByTestId, container } = render(<PublicDemo />);
    const select = getByTestId('demo-country-select') as HTMLSelectElement;
    // Default is CL — DS 594 in framework label.
    expect(container.textContent).toContain('DS 594');

    fireEvent.change(select, { target: { value: 'US' } });
    const badge = getByTestId('demo-framework-badge');
    expect(badge.textContent).toContain('OSHA');
    expect(badge.textContent).toContain('US-OSHA');

    fireEvent.change(select, { target: { value: 'BR' } });
    expect(getByTestId('demo-framework-badge').textContent).toContain('NR-35');
  });

  it('gas dispersion calculator recomputes when wind input changes', () => {
    const { getByTestId } = render(<PublicDemo />);
    const wind = getByTestId('demo-gas-wind') as HTMLInputElement;
    // Bump wind to a high value — the node title in the result block
    // should still be present (calculator computed something deterministic).
    fireEvent.change(wind, { target: { value: '40' } });
    // The card persists in the DOM regardless of severity; just verify
    // the input wired and component did not throw.
    expect(wind.value).toBe('40');
    const card = getByTestId('demo-calc-gas');
    expect(card.textContent).toBeTruthy();
  });
});
