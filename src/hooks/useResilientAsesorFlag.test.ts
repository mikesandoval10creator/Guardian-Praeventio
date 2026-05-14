// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResilientAsesorFlag } from './useResilientAsesorFlag';

const LEGACY_OPT_IN_KEY = 'praeventio:asesor:resilient:v1';
const LEGACY_OPT_OUT_KEY = 'praeventio:asesor:legacy-optout:v2';

describe('useResilientAsesorFlag — Sprint 55 default ON', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sin storage + sin env: enabled=true (nuevo default)', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
    expect(result.current.forcedByEnv).toBe(false);
  });

  it('opt-out explícito (legacy-optout=1): enabled=false', () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
  });

  it('opt-in legacy de Sprint 54 (resilient:v1=1): respetado como enabled=true (redundante con default)', () => {
    localStorage.setItem(LEGACY_OPT_IN_KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
  });

  it('opt-out > opt-in (si ambos están seteados, gana el opt-out)', () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    localStorage.setItem(LEGACY_OPT_IN_KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
  });

  it('setEnabled(false) → setea opt-out + estado actualizado', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    act(() => {
      result.current.setEnabled(false);
    });
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(LEGACY_OPT_OUT_KEY)).toBe('1');
  });

  it('setEnabled(true) limpia opt-out + estado a true', () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
    act(() => {
      result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(LEGACY_OPT_OUT_KEY)).toBeNull();
  });

  it('cross-tab storage event de opt-out actualiza estado', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
    act(() => {
      localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
      const event = new StorageEvent('storage', {
        key: LEGACY_OPT_OUT_KEY,
        newValue: '1',
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(false);
  });

  it('cross-tab storage event remove opt-out re-habilita', () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(false);
    act(() => {
      localStorage.removeItem(LEGACY_OPT_OUT_KEY);
      const event = new StorageEvent('storage', {
        key: LEGACY_OPT_OUT_KEY,
        newValue: null,
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(true);
  });

  it('storage event con key distinto NO afecta', () => {
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
    act(() => {
      const event = new StorageEvent('storage', {
        key: 'otra-key',
        newValue: '1',
      });
      window.dispatchEvent(event);
    });
    expect(result.current.enabled).toBe(true);
  });

  it('valor no-"1" en opt-out se trata como no presente (enabled=true)', () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, 'true');
    const { result } = renderHook(() => useResilientAsesorFlag());
    expect(result.current.enabled).toBe(true);
  });
});
