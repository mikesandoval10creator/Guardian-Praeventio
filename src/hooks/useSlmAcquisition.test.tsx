// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Mock the underlying slm services so the hook runs in isolation.
const mockGetAcquisitionStatus = vi.fn();
const mockRecordAccepted = vi.fn();
const mockRecordPostponed = vi.fn();
const mockRecordDeclined = vi.fn();
const mockDetectNetworkAdvisory = vi.fn(() => 'wifi');

vi.mock('../services/slm/slmAcquisitionService', () => ({
  detectNetworkAdvisory: () => mockDetectNetworkAdvisory(),
  getAcquisitionStatus: (...a: unknown[]) => mockGetAcquisitionStatus(...a),
  recordAccepted: (...a: unknown[]) => mockRecordAccepted(...a),
  recordPostponed: (...a: unknown[]) => mockRecordPostponed(...a),
  recordDeclined: (...a: unknown[]) => mockRecordDeclined(...a),
}));

const mockLoadModel = vi.fn();
const mockRelease = vi.fn();
vi.mock('../services/slm/slmRuntime', () => ({
  createSlmRuntime: () => ({
    loadModel: (...a: unknown[]) => mockLoadModel(...a),
    release: (...a: unknown[]) => mockRelease(...a),
  }),
}));

// Avoid real Capacitor wiring in tests.
vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    keepAwake: vi.fn(async () => {}),
    allowSleep: vi.fn(async () => {}),
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import {
  useSlmAcquisition,
  hasCellularConfirmation,
  recordCellularConfirmation,
  resetCellularConfirmation,
} from './useSlmAcquisition.js';

const READY_STATUS = {
  state: 'needs_prompt' as const,
  modelId: 'phi-3-mini',
  totalBytes: 1_000_000,
  totalMb: 1,
  isPrePackaged: false,
  cachedBytes: 0,
};

beforeEach(() => {
  mockGetAcquisitionStatus.mockResolvedValue({ ...READY_STATUS });
  mockLoadModel.mockReset();
  mockRelease.mockReset();
  mockRecordAccepted.mockReset();
  mockRecordPostponed.mockReset();
  mockRecordDeclined.mockReset();
  mockDetectNetworkAdvisory.mockReturnValue('wifi');
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSlmAcquisition (Sprint 56 extensions)', () => {
  it('expone pause/resume/retry/downloadPhase', async () => {
    const { result } = renderHook(() => useSlmAcquisition());
    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });
    expect(typeof result.current.pause).toBe('function');
    expect(typeof result.current.resume).toBe('function');
    expect(typeof result.current.retry).toBe('function');
    expect(result.current.downloadPhase).toBe('idle');
  });

  it('accept dispara loadModel y termina en phase=done', async () => {
    mockLoadModel.mockImplementation(async (_id, opts: { onProgress?: (e: unknown) => void }) => {
      opts.onProgress?.({
        loaded: 1_000_000,
        total: 1_000_000,
        filename: 'm.onnx',
        fileIndex: 0,
        fileCount: 1,
      });
      return { modelId: 'phi-3-mini' };
    });
    mockRelease.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSlmAcquisition());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.accept();
    });

    expect(mockLoadModel).toHaveBeenCalled();
    expect(mockRecordAccepted).toHaveBeenCalledWith('phi-3-mini');
    expect(result.current.downloadPhase).toBe('done');
    expect(result.current.downloadProgress).toBe(1);
  });

  it('pause aborta el download y marca phase=paused', async () => {
    let abortSignal: AbortSignal | undefined;
    mockLoadModel.mockImplementation(
      (_id, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal = opts.signal;
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const { result } = renderHook(() => useSlmAcquisition());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    // Fire accept (don't await — it will hang on the pending promise).
    let acceptPromise: Promise<void>;
    act(() => {
      acceptPromise = result.current.accept();
    });
    await waitFor(() => expect(result.current.downloadPhase).toBe('active'));

    act(() => {
      result.current.pause();
    });

    await act(async () => {
      await acceptPromise!;
    });

    expect(abortSignal?.aborted).toBe(true);
    expect(result.current.downloadPhase).toBe('paused');
  });

  it('error de red dispara retry automático con backoff (phase=retrying)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    mockLoadModel.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('NetworkError');
      }
      return { modelId: 'phi-3-mini' };
    });
    mockRelease.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSlmAcquisition({ maxAutoRetries: 2 }));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    const p = act(async () => {
      await result.current.accept();
    });

    // Avanzamos el reloj para que el backoff expire (cap 30s).
    await vi.advanceTimersByTimeAsync(35_000);
    await p;

    expect(calls).toBe(2);
    expect(result.current.downloadPhase).toBe('done');
    expect(result.current.retryAttempt).toBe(1);
  });

  it('cellular confirmation helpers persisten en localStorage', () => {
    expect(hasCellularConfirmation()).toBe(false);
    recordCellularConfirmation();
    expect(hasCellularConfirmation()).toBe(true);
    resetCellularConfirmation();
    expect(hasCellularConfirmation()).toBe(false);
  });
});
