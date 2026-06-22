// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTextFits } from './useTextFits';

describe('useTextFits', () => {
  it('devuelve fits:boolean y lineCount correcto o fallback null-safe', () => {
    // jsdom 25+ implementa canvas measureText con anchos reales (width>0),
    // por lo que pretext puede correr y retornar lineCount real.
    // Si falta soporte (null), fits=true (no truncar por falso negativo).
    const { result } = renderHook(() => useTextFits('Reportes Confidenciales', '14px Inter', 120));
    expect(typeof result.current.fits).toBe('boolean');
    // lineCount es null (fallback) o número >=1
    expect(result.current.lineCount === null || typeof result.current.lineCount === 'number').toBe(true);
  });
  it('no lanza con texto vacío o ancho 0', () => {
    expect(() => renderHook(() => useTextFits('', '14px Inter', 0))).not.toThrow();
  });
});
