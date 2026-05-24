// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 §Fase D.1 tests.
//
// Cobertura de los pure helpers de midasDepthEstimator. El factory
// `tryCreateMidasEstimator` y la inferencia ONNX real corren solo en
// browser con WASM + modelo cargado — para esos usamos el smoke test
// manual del DigitalTwinFaena page + el fallback heurístico cubre lo
// que la pipeline necesita en producción cuando el modelo no está.

import { describe, it, expect } from 'vitest';
import {
  preprocessFrame,
  normalizeDepth,
  resizeBilinear,
} from './midasDepthEstimator';

import type { ExtractedFrame } from './frameExtractor';

function makeFrame(width: number, height: number, fill: [number, number, number]): ExtractedFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return {
    index: 0,
    timestampS: 0,
    imageData: { data, width, height, colorSpace: 'srgb' } as unknown as ImageData,
    width,
    height,
  };
}

describe('midasDepthEstimator — pure helpers', () => {
  describe('preprocessFrame', () => {
    it('produce Float32Array de longitud 3 * size * size', () => {
      const frame = makeFrame(64, 48, [127, 127, 127]);
      const out = preprocessFrame(frame, 32);
      expect(out.length).toBe(3 * 32 * 32);
    });

    it('layout planar NCHW: 3 canales contiguous-per-channel', () => {
      // Frame puro rojo (255, 0, 0)
      const frame = makeFrame(16, 16, [255, 0, 0]);
      const out = preprocessFrame(frame, 8);
      const channelSize = 8 * 8;

      // Canal R (primer plano): valores deben ser positivos altos
      // tras normalización (raw 1.0 - 0.485) / 0.229 ≈ 2.249
      expect(out[0]).toBeCloseTo((1.0 - 0.485) / 0.229, 2);

      // Canal G (segundo plano): valores negativos (0 - 0.456) / 0.224
      expect(out[channelSize]).toBeCloseTo((0 - 0.456) / 0.224, 2);

      // Canal B (tercer plano): valores negativos
      expect(out[2 * channelSize]).toBeCloseTo((0 - 0.406) / 0.225, 2);
    });

    it('downsample con nearest-neighbor preserva color uniforme', () => {
      const frame = makeFrame(100, 75, [200, 100, 50]);
      const out = preprocessFrame(frame, 16);
      const channelSize = 16 * 16;
      // Todos los valores del canal R deben ser iguales (color uniforme).
      for (let i = 1; i < channelSize; i += 1) {
        expect(out[i]).toBeCloseTo(out[0], 5);
      }
    });
  });

  describe('normalizeDepth', () => {
    it('mapea min→0 y max→1', () => {
      const raw = new Float32Array([1, 2, 3, 4, 5]);
      const norm = normalizeDepth(raw);
      expect(norm[0]).toBe(0);
      expect(norm[4]).toBe(1);
      expect(norm[2]).toBe(0.5);
    });

    it('input constante → output todo 0.5 (degenerate)', () => {
      const raw = new Float32Array([3, 3, 3, 3]);
      const norm = normalizeDepth(raw);
      expect(Array.from(norm)).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it('respeta longitud de input', () => {
      const raw = new Float32Array(1000);
      for (let i = 0; i < raw.length; i += 1) raw[i] = Math.random();
      const norm = normalizeDepth(raw);
      expect(norm.length).toBe(raw.length);
    });

    it('output siempre en [0, 1]', () => {
      const raw = new Float32Array([-100, -50, 0, 50, 100]);
      const norm = normalizeDepth(raw);
      for (let i = 0; i < norm.length; i += 1) {
        expect(norm[i]).toBeGreaterThanOrEqual(0);
        expect(norm[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('resizeBilinear', () => {
    it('identity: srcW=dstW + srcH=dstH preserva valores (Float32 precision)', () => {
      const src = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const out = resizeBilinear(src, 2, 2, 2, 2);
      // toBeCloseTo porque Float32 vs Float64 difiere en el 7° dígito.
      expect(out[0]).toBeCloseTo(0.1, 5);
      expect(out[1]).toBeCloseTo(0.2, 5);
      expect(out[2]).toBeCloseTo(0.3, 5);
      expect(out[3]).toBeCloseTo(0.4, 5);
    });

    it('upscale 2×2 → 4×4 interpola suavemente', () => {
      const src = new Float32Array([0, 1, 1, 0]); // checkerboard
      const out = resizeBilinear(src, 2, 2, 4, 4);
      expect(out.length).toBe(16);
      // Esquinas deben estar cerca de los originales
      expect(out[0]).toBeCloseTo(0, 1);
      expect(out[3]).toBeCloseTo(1, 1);
    });

    it('downscale 4×4 → 2×2 mantiene gradiente', () => {
      // Gradiente lineal de 0 a 1.
      const src = new Float32Array(16);
      for (let i = 0; i < 16; i += 1) src[i] = i / 15;
      const out = resizeBilinear(src, 4, 4, 2, 2);
      expect(out.length).toBe(4);
      // El primer valor debe ser cercano al min, el último al max.
      expect(out[0]).toBeLessThan(out[3]);
    });

    it('output siempre tiene longitud dstW * dstH', () => {
      const src = new Float32Array(64); // 8×8
      const out = resizeBilinear(src, 8, 8, 100, 75);
      expect(out.length).toBe(100 * 75);
    });
  });
});
