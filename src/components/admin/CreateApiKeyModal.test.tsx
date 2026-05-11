// @vitest-environment jsdom
/**
 * Praeventio Guard — Bucket CC tests for `CreateApiKeyModal.tsx`.
 *
 * Sprint 39 P0.3 follow-up: the original Sprint 24 test author skipped
 * the tier→scopes reset, form submit, and submit error tests with TODOs
 * blaming "jsdom + form" quirks. Root cause was using `fireEvent` for
 * interactions that need real user-event sequencing (select change +
 * form submit). Migrated to `@testing-library/user-event` v14 which
 * correctly simulates the focus/blur/submit lifecycle.
 *
 *   1. Modal renders the form when `open` is true and customer-id field
 *      is required.
 *   2. Tier change updates the available scopes (was skipped — fixed).
 *   3. Successful submit shows the raw key once + blocks close until
 *      acknowledgement (was skipped — fixed).
 *   4. Submit error is rendered as a visible error message (was skipped
 *      — fixed).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CreateApiKeyModal } from './CreateApiKeyModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof CreateApiKeyModal>> = {}) {
  const onClose = vi.fn();
  const onSubmit = overrides.onSubmit
    ?? vi.fn(async () => ({ id: 'k1', rawKey: 'pvk_live_xxx', maskedKey: 'pvk_l…xxxx' }));
  const utils = render(
    <CreateApiKeyModal open={true} onClose={onClose} onSubmit={onSubmit} {...overrides} />,
  );
  // userEvent.setup() pre-configures a session that handles async correctly.
  const user = userEvent.setup();
  return { onClose, onSubmit, user, ...utils };
}

describe('CreateApiKeyModal', () => {
  it('renders the form heading and required customer-id input when open', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Crear nueva API key B2D/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/Customer ID/i) as HTMLInputElement;
    expect(input).toBeRequired();
  });

  it('updates the available scopes when the tier changes', async () => {
    const { user } = renderModal();

    // Default tier is climate-base → climate scopes shown.
    expect(screen.getAllByLabelText('climate.read').length).toBeGreaterThan(0);

    // Switch to hazmat-pro via real selectOptions (correct way for
    // <select> elements in user-event v14).
    await user.selectOptions(screen.getByLabelText(/Tier/i), 'hazmat-pro');

    // After re-render the hazmat scope appears.
    expect(screen.getAllByLabelText('hazmat.calculate').length).toBeGreaterThan(0);
    // And the climate scope is gone.
    expect(screen.queryAllByLabelText('climate.read')).toHaveLength(0);
  });

  it('shows the raw key once and blocks close until acknowledged', async () => {
    const onSubmit = vi.fn(async () => ({
      id: 'k_42',
      rawKey: 'pvk_live_real_secret_42',
      maskedKey: 'pvk_l…t_42',
    }));
    const { user, onClose } = renderModal({ onSubmit });

    await user.type(screen.getByLabelText(/Customer ID/i), 'cust_x');

    // Click the submit button — type=submit triggers the form submit
    // handler with userEvent's real event sequence (mousedown/up/click
    // + form submission), unlike fireEvent.click which omits the form
    // submission step.
    const submitBtn = screen.getAllByRole('button', { name: /Crear API key/i })
      .find(b => (b as HTMLButtonElement).type === 'submit')!;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    // The raw key is now shown.
    await waitFor(() => {
      expect(screen.getByText('pvk_live_real_secret_42')).toBeInTheDocument();
    });

    // Closing without acknowledgement is blocked. The footer "Cerrar"
    // button is `disabled={!acknowledged}`, so userEvent v14 won't even
    // dispatch the click. We exercise the gate via the ✕ header button
    // (which is always enabled — it routes through handleClose() which
    // sets the warning error and returns early).
    const headerCloseX = screen.getAllByRole('button', { name: /^Cerrar$/i })
      .find((b) => (b as HTMLButtonElement).textContent?.trim() === '✕')!;
    await user.click(headerCloseX);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirma que copiaste la API key/i)).toBeInTheDocument();

    // Acknowledge then close (footer button becomes enabled).
    await user.click(screen.getByLabelText(/Confirmo que copié/i));
    const footerClose = screen.getAllByRole('button', { name: /^Cerrar$/i })
      .find((b) => (b as HTMLButtonElement).textContent?.trim() === 'Cerrar')!;
    await user.click(footerClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders submit errors visibly', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const { user } = renderModal({ onSubmit });

    await user.type(screen.getByLabelText(/Customer ID/i), 'cust_y');
    const submitBtn = screen.getAllByRole('button', { name: /Crear API key/i })
      .find(b => (b as HTMLButtonElement).type === 'submit')!;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument();
    });
  });
});
