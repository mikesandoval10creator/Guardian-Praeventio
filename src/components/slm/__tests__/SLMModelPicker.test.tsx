// @vitest-environment jsdom
//
// Sprint 20 — Bucket Lambda — T-1.5 — SLMModelPicker tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SLMModelPicker } from '../SLMModelPicker';

afterEach(() => {
  cleanup();
});

describe('SLMModelPicker', () => {
  it('renders all three registry models as radio buttons inside a fieldset', () => {
    render(<SLMModelPicker onSelect={() => {}} />);

    // Fieldset + legend wiring — gives the screen reader the group label.
    expect(screen.getByText(/seleccionar modelo on-device/i)).toBeInTheDocument();

    // 3 cards = 3 radios.
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);

    // Each registry id maps to a card with our test-id contract.
    expect(screen.getByTestId('slm-model-card-phi-3-mini')).toBeInTheDocument();
    expect(screen.getByTestId('slm-model-card-qwen-2.5-0.5b')).toBeInTheDocument();
    expect(screen.getByTestId('slm-model-card-gemma-2-2b')).toBeInTheDocument();
  });

  it('marks the matching card as aria-checked when currentModelId is set', () => {
    render(<SLMModelPicker currentModelId="qwen-2.5-0.5b" onSelect={() => {}} />);
    const qwenCard = screen.getByTestId('slm-model-card-qwen-2.5-0.5b');
    const phiCard = screen.getByTestId('slm-model-card-phi-3-mini');
    expect(qwenCard).toHaveAttribute('aria-checked', 'true');
    expect(phiCard).toHaveAttribute('aria-checked', 'false');
  });

  it('fires onSelect with the registry id when a card is clicked', () => {
    const onSelect = vi.fn();
    render(<SLMModelPicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('slm-model-card-gemma-2-2b'));
    expect(onSelect).toHaveBeenCalledWith('gemma-2-2b');
  });

  it('renders license badges with the correct license tag per model', () => {
    render(<SLMModelPicker onSelect={() => {}} />);
    expect(screen.getByTestId('slm-model-license-phi-3-mini')).toHaveTextContent('MIT');
    expect(screen.getByTestId('slm-model-license-qwen-2.5-0.5b')).toHaveTextContent('Apache-2.0');
    expect(screen.getByTestId('slm-model-license-gemma-2-2b')).toHaveTextContent('Gemma');
  });
});
