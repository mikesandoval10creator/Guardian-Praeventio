// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// useWebXRSupport — tests L.5 (Sprint 21 Ola 4 Bucket L).
//
// Cubrimos las 4 ramas del hook:
//   1. navigator.xr undefined → available=false, loading=false
//   2. navigator.xr presente, isSessionSupported('immersive-ar') → false
//   3. navigator.xr presente, isSessionSupported('immersive-ar') → true
//   4. estado inicial loading=true mientras la promesa pending
//
// Mockeamos navigator.xr con vi.stubGlobal en cada test y limpiamos en
// afterEach para evitar leak entre cases. React 19 + jsdom + RTL.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWebXRSupport } from './useWebXRSupport';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.unstubAllGlobals();
  // Restaurar el navigator real (jsdom). vi.stubGlobal ya lo hace via
  // unstubAllGlobals, pero defendemos contra mutaciones manuales.
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

describe('useWebXRSupport', () => {
  it('reporta no disponible cuando navigator.xr no existe', async () => {
    // jsdom default: navigator no tiene xr → camino UNSUPPORTED.
    const { result } = renderHook(() => useWebXRSupport());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(false);
    expect(result.current.immersiveAr).toBe(false);
    expect(result.current.hitTest).toBe(false);
    expect(result.current.anchors).toBe(false);
    expect(result.current.domOverlay).toBe(false);
  });

  it('reporta available=true pero immersiveAr=false cuando isSessionSupported retorna false', async () => {
    const isSessionSupported = vi.fn().mockResolvedValue(false);
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: { isSessionSupported },
      configurable: true,
    });

    const { result } = renderHook(() => useWebXRSupport());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.immersiveAr).toBe(false);
    expect(result.current.hitTest).toBe(false);
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-ar');
  });

  it('reporta todas las features true cuando immersive-ar está soportado', async () => {
    const isSessionSupported = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: { isSessionSupported },
      configurable: true,
    });

    const { result } = renderHook(() => useWebXRSupport());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.immersiveAr).toBe(true);
    expect(result.current.hitTest).toBe(true);
    expect(result.current.anchors).toBe(true);
    expect(result.current.domOverlay).toBe(true);
  });

  it('arranca con loading=true mientras la detección está pending', async () => {
    let resolveSupport: (v: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveSupport = resolve;
    });
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: { isSessionSupported: vi.fn().mockReturnValue(pending) },
      configurable: true,
    });

    const { result } = renderHook(() => useWebXRSupport());

    // Inicialmente loading=true (snapshot del primer render).
    expect(result.current.loading).toBe(true);

    resolveSupport(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.immersiveAr).toBe(true);
  });

  it('cuando isSessionSupported lanza, reporta available=true e immersiveAr=false', async () => {
    const isSessionSupported = vi
      .fn()
      .mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: { isSessionSupported },
      configurable: true,
    });

    const { result } = renderHook(() => useWebXRSupport());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.immersiveAr).toBe(false);
  });
});
