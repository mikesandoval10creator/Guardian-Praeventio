// @vitest-environment jsdom
//
// Sprint 20 — Bucket Nu — SLMProvider tests.
//
// We mock the SLM service modules to keep the tests independent of
// IndexedDB and the Comlink worker. The provider only depends on three
// surfaces from those modules:
//   • `slmAdapter.ensureSlmReady`     — bootstraps the worker
//   • `slmAdapter.getActiveModelId`   — read of the cached active id
//   • `offlineQueue.listPending`      — count of unsynced sessions

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act, waitFor } from '@testing-library/react';

vi.mock('../../../services/slm/slmAdapter', () => ({
  ensureSlmReady: vi.fn(async () => ({ modelId: 'phi-3-mini' })),
  getActiveModelId: vi.fn(() => null),
}));

vi.mock('../../../services/slm/offlineQueue', () => ({
  listPending: vi.fn(async () => []),
}));

import {
  SLMProvider,
  SLM_ENQUEUED_EVENT,
  useSLM,
} from '../SLMProvider';
import { ensureSlmReady, getActiveModelId } from '../../../services/slm/slmAdapter';
import { listPending } from '../../../services/slm/offlineQueue';

/** Tiny consumer that surfaces the context state to the DOM for assertion. */
function Probe() {
  const { isOnline, pendingCount, activeModelId, ensureReady } = useSLM();
  return (
    <div>
      <span data-testid="online">{String(isOnline)}</span>
      <span data-testid="pending">{pendingCount}</span>
      <span data-testid="model">{activeModelId ?? 'none'}</span>
      <button data-testid="ensure" onClick={() => void ensureReady()}>
        ensure
      </button>
    </div>
  );
}

const ensureSlmReadyMock = ensureSlmReady as unknown as ReturnType<typeof vi.fn>;
const getActiveModelIdMock = getActiveModelId as unknown as ReturnType<typeof vi.fn>;
const listPendingMock = listPending as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // navigator.onLine defaults to `true` in jsdom; reset to true so each
  // test starts from a known baseline.
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => true,
  });
  listPendingMock.mockResolvedValue([]);
  getActiveModelIdMock.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe('SLMProvider', () => {
  it('reflects navigator.onLine on initial mount', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    render(
      <SLMProvider>
        <Probe />
      </SLMProvider>,
    );

    expect(screen.getByTestId('online').textContent).toBe('false');
  });

  it('updates isOnline when window online/offline events fire', async () => {
    render(
      <SLMProvider>
        <Probe />
      </SLMProvider>,
    );

    expect(screen.getByTestId('online').textContent).toBe('true');

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('online').textContent).toBe('false');

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByTestId('online').textContent).toBe('true');
  });

  it('refreshes pendingCount when gp-slm-enqueued fires', async () => {
    listPendingMock.mockResolvedValueOnce([]); // initial mount read
    listPendingMock.mockResolvedValueOnce([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);

    render(
      <SLMProvider>
        <Probe />
      </SLMProvider>,
    );

    // Wait for the initial read to settle to 0.
    await waitFor(() => {
      expect(screen.getByTestId('pending').textContent).toBe('0');
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SLM_ENQUEUED_EVENT));
    });

    await waitFor(() => {
      expect(screen.getByTestId('pending').textContent).toBe('3');
    });
  });

  it('ensureReady delegates to slmAdapter and refreshes active model id', async () => {
    // Sprint 54 perf — SLMProvider initial state is unconditionally null
    // (no eager `getActiveModelId()` call); `ensureReady` does the first
    // read after the dynamic import resolves. Mock returns the loaded
    // id consistently.
    getActiveModelIdMock.mockReturnValue('phi-3-mini');

    render(
      <SLMProvider>
        <Probe />
      </SLMProvider>,
    );

    expect(screen.getByTestId('model').textContent).toBe('none');

    await act(async () => {
      screen.getByTestId('ensure').click();
    });

    expect(ensureSlmReadyMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('model').textContent).toBe('phi-3-mini');
    });
  });
});
