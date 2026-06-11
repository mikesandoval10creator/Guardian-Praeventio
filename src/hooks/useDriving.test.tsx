// @vitest-environment jsdom
//
// Praeventio Guard — Fase 5 D2 slice 1 (2026-06-11).
//
// `useDriving.ts` shipped three telemetry mutators with ZERO importers
// (orphan). This suite pins the new `useBrakeTelemetry` hook — the
// cheapest REAL consumer path: `Driving.tsx` already runs
// `useSpeedMonitor` (GPS), so the hook derives the longitudinal
// acceleration from consecutive GPS speed fixes (a = Δv/Δt — a genuine
// physical estimate, NOT fabricated IMU data), gates on the local pure
// detector `detectAggressiveBrake`, and only then fires
// `detectAggressiveBrakeRemote` fire-and-forget. Network failures are
// swallowed: driving UX must never break (offline tolerated).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBrakeTelemetry } from './useDriving';
import type { SpeedSample } from '../services/driving/speedTrigger';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mkSample(speedMs: number, timestampMs: number, isStale = false): SpeedSample {
  return {
    speedMs,
    speedKmh: speedMs * 3.6,
    gpsAccuracyM: 5,
    timestampMs,
    isStale,
  };
}

/** Drives the hook through a sequence of GPS speed samples. */
function renderTelemetry(
  projectId: string | null,
  first: SpeedSample,
  enabled = true,
) {
  return renderHook(
    ({ s, pid, en }: { s: SpeedSample; pid: string | null; en: boolean }) =>
      useBrakeTelemetry(pid, s, en),
    { initialProps: { s: first, pid: projectId, en: enabled } },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse({ triggerAt: 2000 }));
});

describe('useBrakeTelemetry — D2 slice 1', () => {
  it('reports a sustained hard deceleration to the remote endpoint exactly once', async () => {
    // 25 → 19 → 13 m/s at 1Hz ⇒ a = -6 m/s² sustained ≥ 200ms (≥ 0.5g).
    const { rerender } = renderTelemetry('proj-1', mkSample(25, 1000));
    rerender({ s: mkSample(19, 2000), pid: 'proj-1', en: true });
    rerender({ s: mkSample(13, 3000), pid: 'proj-1', en: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sprint-k/proj-1/driving/detect-aggressive-brake');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as {
      samples: { longitudinalMs2: number; timestampMs: number }[];
    };
    expect(body.samples.length).toBeGreaterThanOrEqual(2);
    for (const s of body.samples) {
      expect(s.longitudinalMs2).toBeCloseTo(-6, 5);
    }

    // Same braking window keeps extending — must NOT re-report (de-dupe).
    rerender({ s: mkSample(7, 4000), pid: 'proj-1', en: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the endpoint for gentle deceleration', async () => {
    // -1 m/s² — far below the 0.5g (≈4.9 m/s²) threshold.
    const { rerender } = renderTelemetry('proj-1', mkSample(25, 1000));
    rerender({ s: mkSample(24, 2000), pid: 'proj-1', en: true });
    rerender({ s: mkSample(23, 3000), pid: 'proj-1', en: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing without a projectId or when disabled', async () => {
    const { rerender } = renderTelemetry(null, mkSample(25, 1000));
    rerender({ s: mkSample(19, 2000), pid: null, en: true });
    rerender({ s: mkSample(13, 3000), pid: null, en: true });

    const disabled = renderTelemetry('proj-1', mkSample(25, 1000), false);
    disabled.rerender({ s: mkSample(19, 2000), pid: 'proj-1', en: false });
    disabled.rerender({ s: mkSample(13, 3000), pid: 'proj-1', en: false });

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores stale GPS samples (no derived acceleration from stale fixes)', async () => {
    const { rerender } = renderTelemetry('proj-1', mkSample(25, 1000));
    rerender({ s: mkSample(19, 2000, true), pid: 'proj-1', en: true });
    rerender({ s: mkSample(13, 3000, true), pid: 'proj-1', en: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows network failures — driving UX never breaks (offline tolerated)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const { rerender } = renderTelemetry('proj-1', mkSample(25, 1000));
    expect(() => {
      rerender({ s: mkSample(19, 2000), pid: 'proj-1', en: true });
      rerender({ s: mkSample(13, 3000), pid: 'proj-1', en: true });
    }).not.toThrow();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Flush the rejected promise chain — must not surface as unhandled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('re-arms after the braking window clears (new event reported again)', async () => {
    const { rerender } = renderTelemetry('proj-1', mkSample(25, 1000));
    rerender({ s: mkSample(19, 2000), pid: 'proj-1', en: true });
    rerender({ s: mkSample(13, 3000), pid: 'proj-1', en: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Cruise (no deceleration) clears the window…
    rerender({ s: mkSample(13, 9000), pid: 'proj-1', en: true });
    rerender({ s: mkSample(13, 10000), pid: 'proj-1', en: true });
    // …then a second hard-brake event fires a second report.
    rerender({ s: mkSample(7, 11000), pid: 'proj-1', en: true });
    rerender({ s: mkSample(1, 12000), pid: 'proj-1', en: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
