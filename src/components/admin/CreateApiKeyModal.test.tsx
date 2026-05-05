// @vitest-environment jsdom
/**
 * Praeventio Guard — Bucket CC tests for `CreateApiKeyModal.tsx`.
 *
 *   1. Modal renders the form when `open` is true and customer-id field
 *      is required.
 *   2. Tier change updates the available scopes.
 *   3. Successful submit shows the raw key once + blocks close until
 *      acknowledgement.
 *   4. Submit error is rendered as a visible error message.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { CreateApiKeyModal } from './CreateApiKeyModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof CreateApiKeyModal>> = {}) {
  const onClose = vi.fn();
  const onSubmit = overrides.onSubmit
    ?? vi.fn(async () => ({ id: 'k1', rawKey: 'pvk_live_xxx', maskedKey: 'pvk_l…xxxx' }));
  render(<CreateApiKeyModal open={true} onClose={onClose} onSubmit={onSubmit} {...overrides} />);
  return { onClose, onSubmit };
}

describe('CreateApiKeyModal', () => {
  it('renders the form heading and required customer-id input when open', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Crear nueva API key B2D/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/Customer ID/i) as HTMLInputElement;
    expect(input).toBeRequired();
  });

  it('updates the available scopes when the tier changes', () => {
    renderModal();
    // Default tier is climate-base → climate scopes shown.
    expect(screen.getByLabelText('climate.read')).toBeInTheDocument();
    // Switch to hazmat-pro.
    fireEvent.change(screen.getByLabelText(/Tier/i), { target: { value: 'hazmat-pro' } });
    expect(screen.getByLabelText('hazmat.calculate')).toBeInTheDocument();
    expect(screen.queryByLabelText('climate.read')).not.toBeInTheDocument();
  });

  it('shows the raw key once and blocks close until acknowledged', async () => {
    const onSubmit = vi.fn(async () => ({
      id: 'k_42',
      rawKey: 'pvk_live_real_secret_42',
      maskedKey: 'pvk_l…t_42',
    }));
    const { onClose } = renderModal({ onSubmit });

    fireEvent.change(screen.getByLabelText(/Customer ID/i), { target: { value: 'cust_x' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear API key/i }));

    await waitFor(() => {
      expect(screen.getByText('pvk_live_real_secret_42')).toBeInTheDocument();
    });

    // Closing without acknowledgement is blocked.
    fireEvent.click(screen.getByRole('button', { name: /Cerrar$/i }));
    expect(onClose).not.toHaveBeenCalled();

    // Acknowledge then close.
    fireEvent.click(screen.getByLabelText(/Confirmo que copié/i));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders submit errors visibly', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    renderModal({ onSubmit });

    fireEvent.change(screen.getByLabelText(/Customer ID/i), { target: { value: 'cust_y' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear API key/i }));

    await waitFor(() => {
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument();
    });
  });
});
