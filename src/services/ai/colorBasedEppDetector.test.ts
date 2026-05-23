// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.18 (2026-05-22) tests del detector EPP on-device
// basado en color (real, no mock).

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { ColorBasedEppDetector } from './colorBasedEppDetector';

/**
 * Helper: crea un Blob a partir de un Uint8ClampedArray RGBA + dimensiones
 * usando un canvas. El detector consume Blob/ImageBitmap/HTMLImageElement
 * — Blob es el más portable en tests.
 */
async function makeBlob(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = fill(x, y);
      data.data[idx] = r;
      data.data[idx + 1] = g;
      data.data[idx + 2] = b;
      data.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}

describe('ColorBasedEppDetector', () => {
  it('reporta modelVersion estable', () => {
    const det = new ColorBasedEppDetector();
    expect(det.modelVersion).toBe('color-heuristic-v1');
  });

  it('detecta casco cuando la parte superior es amarilla fuerte', async () => {
    // Top 30% = amarillo fuerte (R=255, G=220, B=0), resto gris.
    const blob = await makeBlob(64, 64, (_, y) => {
      if (y < 64 * 0.3) return [255, 220, 0];
      return [100, 100, 100];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    const casco = detections.find((d) => d.class === 'casco');
    expect(casco).toBeDefined();
    expect(casco!.confidence).toBeGreaterThan(0.3);
  });

  it('detecta chaleco_reflectivo en torso con naranja fluo', async () => {
    // Banda central (Y 25-70%) = naranja fluo (R=255, G=120, B=0).
    const blob = await makeBlob(64, 64, (_, y) => {
      if (y > 64 * 0.25 && y < 64 * 0.7) return [255, 120, 0];
      return [50, 50, 50];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    const chaleco = detections.find((d) => d.class === 'chaleco_reflectivo');
    expect(chaleco).toBeDefined();
    expect(chaleco!.confidence).toBeGreaterThan(0.3);
  });

  it('detecta botas en bottom 25% con color oscuro', async () => {
    // Top 75% = blanco, bottom 25% = negro/marrón muy oscuro.
    const blob = await makeBlob(64, 64, (_, y) => {
      if (y > 64 * 0.75) return [30, 25, 20]; // cuero oscuro
      return [240, 240, 240];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    const botas = detections.find((d) => d.class === 'botas');
    expect(botas).toBeDefined();
    expect(botas!.confidence).toBeGreaterThan(0.2);
  });

  it('NO detecta casco si la parte superior es del color piel', async () => {
    // Top 30% color piel típico (R=210, G=170, B=140) — NO debería matchear casco.
    const blob = await makeBlob(64, 64, (_, y) => {
      if (y < 64 * 0.3) return [210, 170, 140];
      return [100, 100, 100];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    const casco = detections.find((d) => d.class === 'casco');
    expect(casco).toBeUndefined();
  });

  it('imagen completamente uniforme gris no genera detecciones fuertes', async () => {
    const blob = await makeBlob(64, 64, () => [128, 128, 128]);
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    // Algunas heurísticas débiles (arnés, gafas) podrían sobre-disparar
    // en gris uniforme. Verificamos que NINGUNA detección pase de un
    // ceiling pragmático razonable.
    detections.forEach((d) => {
      expect(d.confidence).toBeLessThanOrEqual(0.6);
    });
  });

  it('todas las detecciones reportan bbox válido [0..1]', async () => {
    const blob = await makeBlob(64, 64, (_x, y) => {
      // Mosaico: casco arriba amarillo, chaleco centro naranja, botas abajo negro.
      if (y < 64 * 0.3) return [255, 220, 0];
      if (y > 64 * 0.75) return [30, 25, 20];
      return [255, 120, 0];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    expect(detections.length).toBeGreaterThan(0);
    detections.forEach((d) => {
      expect(d.bbox).toBeDefined();
      expect(d.bbox!.x).toBeGreaterThanOrEqual(0);
      expect(d.bbox!.y).toBeGreaterThanOrEqual(0);
      expect(d.bbox!.width).toBeGreaterThan(0);
      expect(d.bbox!.height).toBeGreaterThan(0);
      expect(d.bbox!.x + d.bbox!.width).toBeLessThanOrEqual(1.001); // tolerancia floating
      expect(d.bbox!.y + d.bbox!.height).toBeLessThanOrEqual(1.001);
    });
  });

  it('confidence está en [0..1]', async () => {
    const blob = await makeBlob(32, 32, () => [255, 0, 0]);
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(blob);
    detections.forEach((d) => {
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    });
  });
});
