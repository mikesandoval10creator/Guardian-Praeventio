// @vitest-environment jsdom
//
// useBluetoothMesh — sensorBus wiring tests (TODO.md §16.2.1).
//
// The mesh scan already detects peers (or their absence); these tests pin that
// it now publishes that signal to the central sensor bus so the man-down
// correlation can use "BLE disconnected" as escalation evidence:
//   peer seen          → 'ble_proximity' severity 'info'    (connected OK)
//   scan ends empty    → 'ble_proximity' severity 'warning' (isolated)
// No new hardware listeners — only the existing scan callbacks are reused.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  requestLEScan: vi.fn(async (_opts: unknown, _cb: (r: unknown) => void) => undefined),
  stopLEScan: vi.fn(async () => undefined),
  isNativePlatform: vi.fn(() => true),
  saveBreadcrumb: vi.fn(async () => undefined),
  getBreadcrumbs: vi.fn(async () => []),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: h.initialize,
    requestLEScan: h.requestLEScan,
    stopLEScan: h.stopLEScan,
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: h.isNativePlatform },
}));
vi.mock('../utils/offlineStorage', () => ({
  saveBreadcrumb: h.saveBreadcrumb,
  getBreadcrumbs: h.getBreadcrumbs,
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useBluetoothMesh } from './useBluetoothMesh';
import { useSensorBus } from '../services/sensorBus/sensorBus';
import { LOCAL_DEVICE_UID } from '../services/sensorBus/manDownCorrelation';

function busReading(kind: 'ble_proximity') {
  return useSensorBus.getState().readings.get(`${LOCAL_DEVICE_UID}::${kind}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requestLEScan.mockReset().mockResolvedValue(undefined);
  h.stopLEScan.mockReset().mockResolvedValue(undefined);
  h.isNativePlatform.mockReturnValue(true);
  vi.useFakeTimers();
  useSensorBus.getState().reset();
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderReadyHook() {
  const rendered = renderHook(() => useBluetoothMesh());
  // Flush BleClient.initialize() → isSupported true.
  await act(async () => {});
  expect(rendered.result.current.isSupported).toBe(true);
  return rendered;
}

describe('useBluetoothMesh — sensorBus wiring', () => {
  it('stops its native scan on unmount without publishing isolation', async () => {
    h.requestLEScan.mockResolvedValue(undefined);
    const { result, unmount } = await renderReadyHook();
    await act(async () => { await result.current.startScanning(); });
    unmount();
    await act(async () => {});
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    expect(busReading('ble_proximity')).toBeUndefined();
  });
  it('cancels before a queued native start without touching the radio', async () => {
    const { result } = await renderReadyHook();
    await act(async () => {
      const start = result.current.startScanning();
      const stop = result.current.stopScanning();
      await Promise.all([start, stop]);
    });
    expect(h.requestLEScan).not.toHaveBeenCalled();
    expect(h.stopLEScan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(busReading('ble_proximity')).toBeUndefined();
  });

  it('waits for a pending native start before teardown, then ignores late results', async () => {
    let resolveStart!: () => void;
    const pending = new Promise<undefined>(resolve => { resolveStart = () => resolve(undefined); });
    h.requestLEScan.mockReturnValueOnce(pending);
    const { result, unmount } = await renderReadyHook();
    let start!: Promise<void>;
    await act(async () => { start = result.current.startScanning(); });
    expect(h.requestLEScan).toHaveBeenCalledTimes(1);
    const callback = h.requestLEScan.mock.calls[0][1];
    unmount();
    await act(async () => {});
    expect(h.stopLEScan).not.toHaveBeenCalled();
    await act(async () => { resolveStart(); await start; });
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    act(() => { callback({ device: { deviceId: 'late-peer', name: 'Late' } }); });
    expect(h.saveBreadcrumb).not.toHaveBeenCalled();
    expect(busReading('ble_proximity')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not scan twice on double-start and cancellation is idempotent', async () => {
    const { result } = await renderReadyHook();
    await act(async () => {
      await Promise.all([result.current.startScanning(), result.current.startScanning()]);
    });
    expect(h.requestLEScan).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.all([result.current.stopScanning(), result.current.stopScanning()]);
    });
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    expect(result.current.isScanning).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(busReading('ble_proximity')).toBeUndefined();
  });

  it('serializes stop/restart so old callbacks and timeout cannot touch the new scan', async () => {
    const { result } = await renderReadyHook();
    await act(async () => { await result.current.startScanning(); });
    const oldCallback = h.requestLEScan.mock.calls[0][1];
    await act(async () => {
      const stopped = result.current.stopScanning();
      const started = result.current.startScanning();
      await Promise.all([stopped, started]);
    });
    expect(h.requestLEScan).toHaveBeenCalledTimes(2);
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    expect(h.stopLEScan.mock.invocationCallOrder[0]).toBeLessThan(h.requestLEScan.mock.invocationCallOrder[1]);
    act(() => { oldCallback({ device: { deviceId: 'stale', name: 'Old' } }); });
    expect(result.current.nearbyDevices).toEqual([]);
    expect(busReading('ble_proximity')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(h.stopLEScan).toHaveBeenCalledTimes(2);
    expect(busReading('ble_proximity')?.meta).toMatchObject({ reason: 'scan_empty' });
  });

  it('does not let another hook stop or replace an owned scan', async () => {
    const first = await renderReadyHook();
    const second = await renderReadyHook();
    await act(async () => { await first.result.current.startScanning(); });
    await act(async () => { await second.result.current.startScanning(); });
    second.unmount();
    await act(async () => {});
    expect(h.requestLEScan).toHaveBeenCalledTimes(1);
    expect(h.stopLEScan).not.toHaveBeenCalled();
    expect(first.result.current.isScanning).toBe(true);
    expect(second.result.current.error).not.toBeNull();
    expect(busReading('ble_proximity')).toBeUndefined();
    first.unmount();
    await act(async () => {});
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
  });

  it('retries failed native cleanup before starting again', async () => {
    const { result } = await renderReadyHook();
    await act(async () => { await result.current.startScanning(); });
    h.stopLEScan.mockRejectedValueOnce(new Error('temporary stop failure'));
    await act(async () => { await result.current.stopScanning(); });
    expect(result.current.error).not.toBeNull();
    await act(async () => { await result.current.startScanning(); });
    expect(h.stopLEScan).toHaveBeenCalledTimes(2);
    expect(h.requestLEScan).toHaveBeenCalledTimes(2);
    expect(result.current.isScanning).toBe(true);
    expect(busReading('ble_proximity')).toBeUndefined();
  });

  it('does not stop native BLE or publish peers from a cancelled web picker', async () => {
    h.isNativePlatform.mockReturnValue(false);
    let resolvePicker!: (device: { id: string; name: string }) => void;
    const picker = new Promise<{ id: string; name: string }>(resolve => { resolvePicker = resolve; });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn(() => picker) } });
    const { result, unmount } = await renderReadyHook();
    let start!: Promise<void>;
    await act(async () => { start = result.current.startScanning(); });
    unmount();
    await act(async () => { resolvePicker({ id: 'late-web', name: 'Late' }); await start; });
    expect(h.stopLEScan).not.toHaveBeenCalled();
    expect(h.saveBreadcrumb).not.toHaveBeenCalled();
    expect(busReading('ble_proximity')).toBeUndefined();
  });

  it('ignores a late native rejection after cancellation without an unhandled rejection', async () => {
    let rejectStart!: (error: Error) => void;
    h.requestLEScan.mockReturnValueOnce(new Promise<undefined>((_resolve, reject) => { rejectStart = reject; }));
    const { result, unmount } = await renderReadyHook();
    let start!: Promise<void>;
    await act(async () => { start = result.current.startScanning(); });
    unmount();
    await act(async () => { rejectStart(new Error('permission denied late')); await start; });
    expect(h.stopLEScan).toHaveBeenCalledTimes(1);
    expect(busReading('ble_proximity')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes 'ble_proximity' info when a peer is discovered (native scan)", async () => {
    let scanCb: ((r: unknown) => void) | null = null;
    h.requestLEScan.mockImplementation(async (_opts: unknown, cb: (r: unknown) => void) => {
      scanCb = cb;
    });

    const { result } = await renderReadyHook();
    await act(async () => {
      await result.current.startScanning();
    });
    expect(scanCb).not.toBeNull();

    act(() => {
      scanCb!({ device: { deviceId: 'peer-1', name: 'Casco A' } });
    });

    const r = busReading('ble_proximity');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('info');
    expect(r?.meta).toMatchObject({ deviceId: 'peer-1' });
  });

  it("publishes 'ble_proximity' warning when the native scan window ends with ZERO peers", async () => {
    h.requestLEScan.mockImplementation(async () => undefined);

    const { result } = await renderReadyHook();
    await act(async () => {
      await result.current.startScanning();
    });
    expect(busReading('ble_proximity')).toBeUndefined();

    // The scan auto-stops after 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const r = busReading('ble_proximity');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('warning');
    expect(r?.meta).toMatchObject({ reason: 'scan_empty' });
  });

  it('does NOT downgrade to warning when the scan found at least one peer', async () => {
    let scanCb: ((r: unknown) => void) | null = null;
    h.requestLEScan.mockImplementation(async (_opts: unknown, cb: (r: unknown) => void) => {
      scanCb = cb;
    });

    const { result } = await renderReadyHook();
    await act(async () => {
      await result.current.startScanning();
    });
    act(() => {
      scanCb!({ device: { deviceId: 'peer-1', name: 'Casco A' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(busReading('ble_proximity')?.severity).toBe('info');
  });

  it("publishes 'ble_proximity' warning when the scan fails outright", async () => {
    h.requestLEScan.mockImplementation(async () => {
      throw new Error('BLE adapter off');
    });

    const { result } = await renderReadyHook();
    await act(async () => {
      await result.current.startScanning();
    });

    const r = busReading('ble_proximity');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('warning');
    expect(r?.meta).toMatchObject({ reason: 'scan_error' });
  });
});
