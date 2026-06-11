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
import { renderHook, act } from '@testing-library/react';

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
  vi.useFakeTimers();
  useSensorBus.getState().reset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function renderReadyHook() {
  const rendered = renderHook(() => useBluetoothMesh());
  // Flush BleClient.initialize() → isSupported true.
  await act(async () => {});
  expect(rendered.result.current.isSupported).toBe(true);
  return rendered;
}

describe('useBluetoothMesh — sensorBus wiring', () => {
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
