// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useResilienceHealth } from './useResilienceHealth';
import type { ResilienceCheckers } from '../services/observability/resilienceHealthMonitor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => fallback ?? _k,
  }),
}));

function injectedCheckers(): ResilienceCheckers {
  return {
    slm: async () => ({ id: 'slm', status: 'healthy', detail: 'OK' }),
    zettelkasten: async () => ({
      id: 'zettelkasten',
      status: 'healthy',
      detail: 'OK',
    }),
    firestore: async () => ({
      id: 'firestore',
      status: 'healthy',
      detail: 'OK',
    }),
    device_kek: async () => ({
      id: 'device_kek',
      status: 'healthy',
      detail: 'OK',
    }),
    encrypted_kv: async () => ({
      id: 'encrypted_kv',
      status: 'healthy',
      detail: 'OK',
    }),
    network: async () => ({
      id: 'network',
      status: 'healthy',
      detail: 'OK',
    }),
    gemini: async () => ({
      id: 'gemini',
      status: 'healthy',
      detail: 'OK',
    }),
  };
}

describe('useResilienceHealth', () => {
  it('skipInitial=true: no corre el primer check', async () => {
    const { result } = renderHook(() =>
      useResilienceHealth({
        checkers: injectedCheckers(),
        refreshIntervalMs: 0,
        skipInitial: true,
      }),
    );
    expect(result.current.report).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('skipInitial=false (default): corre el check + report disponible', async () => {
    const { result } = renderHook(() =>
      useResilienceHealth({
        checkers: injectedCheckers(),
        refreshIntervalMs: 0,
      }),
    );
    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });
    expect(result.current.report?.overallStatus).toBe('healthy');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('refresh() corre el monitor de nuevo', async () => {
    let invocationCount = 0;
    const trackingCheckers: ResilienceCheckers = {
      ...injectedCheckers(),
      slm: async () => {
        invocationCount++;
        return {
          id: 'slm',
          status: 'healthy',
          detail: `invocation ${invocationCount}`,
        };
      },
    };
    const { result } = renderHook(() =>
      useResilienceHealth({
        checkers: trackingCheckers,
        refreshIntervalMs: 0,
      }),
    );
    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });
    const firstInvocations = invocationCount;
    await act(async () => {
      await result.current.refresh();
    });
    expect(invocationCount).toBeGreaterThan(firstInvocations);
  });

  it('error en checker: error state poblado pero hook no crashea', async () => {
    const brokenCheckers: ResilienceCheckers = {
      ...injectedCheckers(),
      slm: async () => {
        throw new Error('SLM module not loaded');
      },
    };
    const { result } = renderHook(() =>
      useResilienceHealth({
        checkers: brokenCheckers,
        refreshIntervalMs: 0,
      }),
    );
    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });
    // El monitor agrega el error en `subsystems[].error`, no en el hook
    // error state — porque el monitor NUNCA lanza (atrapa por checker).
    const slmReport = result.current.report?.subsystems.find(
      (s) => s.id === 'slm',
    );
    expect(slmReport?.status).toBe('unknown');
    expect(slmReport?.error).toMatch(/SLM module not loaded/);
  });

  it('report contiene 7 subsistemas + recommendations + generatedAt', async () => {
    const { result } = renderHook(() =>
      useResilienceHealth({
        checkers: injectedCheckers(),
        refreshIntervalMs: 0,
      }),
    );
    await waitFor(() => expect(result.current.report).not.toBeNull());
    const r = result.current.report!;
    expect(r.subsystems).toHaveLength(7);
    expect(r.recommendations).toBeDefined();
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
