// @vitest-environment jsdom
//
// Sprint 20 — Bucket Lambda — T-1.5 — SLMStatusPanel tests.
//
// We mock `getCachedModelBytes` to keep the test independent of IndexedDB
// (the real cache module opens an `idb` connection on import; faking
// indexeddb works but is heavier than swapping the one async we depend on).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../services/slm/cache/modelCache', () => ({
  getCachedModelBytes: vi.fn(async (_id: string) => 0),
}));

import { SLMStatusPanel } from '../SLMStatusPanel';
import { getCachedModelBytes } from '../../../services/slm/cache/modelCache';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SLMStatusPanel', () => {
  it('renders the default model with idle status and proper aria role', async () => {
    (getCachedModelBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    render(<SLMStatusPanel />);

    // Region landmark with a Spanish aria-label is the contract.
    const region = screen.getByRole('region', { name: /estado del modelo slm offline/i });
    expect(region).toBeInTheDocument();

    // Default model is Phi-3 Mini per the registry order.
    expect(screen.getByText(/Phi-3 Mini/i)).toBeInTheDocument();

    // License badge surfaces the tag for auditability.
    expect(screen.getByTestId('slm-status-license')).toHaveTextContent('MIT');

    // Idle status badge label.
    expect(screen.getByTestId('slm-status-badge')).toHaveTextContent(/no descargado/i);
  });

  it('shows the downloading progress text and announces it to AT (aria-live)', () => {
    render(<SLMStatusPanel status={{ kind: 'downloading', pct: 42 }} />);
    const badge = screen.getByTestId('slm-status-badge');
    expect(badge).toHaveTextContent(/descargando 42%/i);
    expect(badge).toHaveAttribute('aria-live', 'polite');
    // Progress bar is a real progressbar.
    const bar = screen.getByRole('progressbar', { name: /progreso de descarga/i });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
  });

  it('fires onDownload when the primary action is pressed and the model is not cached', async () => {
    (getCachedModelBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    const onDownload = vi.fn();
    render(<SLMStatusPanel onDownload={onDownload} />);

    // Wait for storage probe to settle.
    await waitFor(() => {
      expect(screen.getByTestId('slm-status-storage')).toHaveTextContent(/0 b/i);
    });

    fireEvent.click(screen.getByTestId('slm-status-primary'));
    expect(onDownload).toHaveBeenCalledWith('phi-3-mini');
  });

  it('switches the primary action to "Cambiar modelo" when bytes are cached', async () => {
    (getCachedModelBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1900 * 1024 * 1024);
    const onChangeModel = vi.fn();
    const onDownload = vi.fn();
    render(
      <SLMStatusPanel
        status={{ kind: 'ready' }}
        onDownload={onDownload}
        onChangeModel={onChangeModel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('slm-status-primary')).toHaveTextContent(/cambiar modelo/i);
    });

    fireEvent.click(screen.getByTestId('slm-status-primary'));
    expect(onChangeModel).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
  });
});
