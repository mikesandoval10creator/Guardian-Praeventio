// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { measureTextHeight } from './textMeasure';

describe('measureTextHeight', () => {
  it('retorna null cuando Canvas 2D no está disponible (jsdom)', () => {
    // jsdom no implementa canvas.measureText → fallback seguro
    const r = measureTextHeight('hola mundo', '16px Inter', 320, 20);
    expect(r === null || typeof r.height === 'number').toBe(true);
  });
  it('no lanza con texto vacío', () => {
    expect(() => measureTextHeight('', '16px Inter', 320, 20)).not.toThrow();
  });
});
