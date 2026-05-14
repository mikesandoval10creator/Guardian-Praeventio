// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResilientAsesorFlag } from './useResilientAsesorFlag';

const KEY = 'praeventio:asesor:resilient:v1';

describe('useResilientAsesorFlag', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('default disabled (sin storage, sin env)', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
    expect(result.current.forcedByEnv).toBe(false);
  });

  it('setEnabled(true): persiste + estado actualizado', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    act(() => {
      result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('setEnabled(false) limpia storage', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
    act(() => {
      result.current.setEnabled(false);
    });
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('lee storage en el mount inicial', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
  });

  it('cross-tab storage event actualiza estado', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
    // Simular cambio en otra tab.
    act(() => {
      const event = new StorageEvent('storage', {
        key: KEY,
        newValue: '1',
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(true);
  });

  it('cross-tab storage event limpia estado', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
    act(() => {
      const event = new StorageEvent('storage', {
        key: KEY,
        newValue: null,
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(false);
  });

  it('storage event con key distinto NO afecta', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
    act(() => {
      const event = new StorageEvent('storage', {
        key: 'otra-key',
        newValue: '1',
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(false);
  });

  it('valor no-"1" en storage se trata como disabled', () => {
    localStorage.setItem(KEY, 'true'); // formato no canónico
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
  });
});
