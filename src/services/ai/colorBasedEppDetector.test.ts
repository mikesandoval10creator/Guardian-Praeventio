// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.18 (2026-05-22) tests del detector EPP on-device
// basado en color (real, no mock).

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { ColorBasedEppDetector } from './colorBasedEppDetector';

/**
 * Helper: construye un `ImageData` sintético con la dimensión + fill
 * function que el caller pase. El detector acepta `ImageData` por
 * fast-path (ver `colorBasedEppDetector.ts:isImageDataLike`).
 *
 * 2026-05-24: migrado de `makeBlob` (canvas.toBlob → createImageBitmap)
 * porque jsdom no implementa `createImageBitmap` y `canvas.toBlob` emite
 * blobs que el navegador real podría decodificar pero que el bitmap
 * loader de jsdom no maneja. Pasar `ImageData` directo es el camino
 * limpio: el unit-test del detector ya no depende de browser image APIs.
 *
 * En producción el caller construye `ImageBitmap` desde el `<video>` o
 * el `<canvas>` real — ese path NO está afectado por este cambio.
 */
function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = fill(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  // jsdom 25.x no expone el constructor global `ImageData` (es opcional
  // en la spec WHATWG canvas). Construimos una shape-compat manualmente.
  // `isImageDataLike` en el detector solo chequea data + width + height,
  // no `instanceof ImageData`, así que esto satisface el contract sin
  // necesitar polyfill ni dependencia nativa `canvas` npm package.
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('ColorBasedEppDetector', () => {
  it('reporta modelVersion estable', () => {
    const det = new ColorBasedEppDetector();
    expect(det.modelVersion).toBe('color-heuristic-v1');
  });

  it('detecta casco cuando la parte superior es amarilla fuerte', async () => {
    // Top 30% = amarillo fuerte (R=255, G=220, B=0), resto gris.
    const img = makeImageData(64, 64, (_, y) => {
      if (y < 64 * 0.3) return [255, 220, 0];
      return [100, 100, 100];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    const casco = detections.find((d) => d.class === 'casco');
    expect(casco).toBeDefined();
    expect(casco!.confidence).toBeGreaterThan(0.3);
  });

  it('detecta chaleco_reflectivo en torso con naranja fluo', async () => {
    // Banda central (Y 25-70%) = naranja fluo (R=255, G=120, B=0).
    const img = makeImageData(64, 64, (_, y) => {
      if (y > 64 * 0.25 && y < 64 * 0.7) return [255, 120, 0];
      return [50, 50, 50];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    const chaleco = detections.find((d) => d.class === 'chaleco_reflectivo');
    expect(chaleco).toBeDefined();
    expect(chaleco!.confidence).toBeGreaterThan(0.3);
  });

  it('detecta botas en bottom 25% con color oscuro', async () => {
    // Top 75% = blanco, bottom 25% = negro/marrón muy oscuro.
    const img = makeImageData(64, 64, (_, y) => {
      if (y > 64 * 0.75) return [30, 25, 20]; // cuero oscuro
      return [240, 240, 240];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    const botas = detections.find((d) => d.class === 'botas');
    expect(botas).toBeDefined();
    expect(botas!.confidence).toBeGreaterThan(0.2);
  });

  it('NO detecta casco si la parte superior es del color piel', async () => {
    // Top 30% color piel típico (R=210, G=170, B=140) — NO debería matchear casco.
    const img = makeImageData(64, 64, (_, y) => {
      if (y < 64 * 0.3) return [210, 170, 140];
      return [100, 100, 100];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    const casco = detections.find((d) => d.class === 'casco');
    expect(casco).toBeUndefined();
  });

  it('imagen completamente uniforme gris no genera detecciones fuertes', async () => {
    const img = makeImageData(64, 64, () => [128, 128, 128]);
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    // Algunas heurísticas débiles (arnés, gafas) podrían sobre-disparar
    // en gris uniforme. Verificamos que NINGUNA detección pase de un
    // ceiling pragmático razonable.
    detections.forEach((d) => {
      expect(d.confidence).toBeLessThanOrEqual(0.6);
    });
  });

  it('todas las detecciones reportan bbox válido [0..1]', async () => {
    const img = makeImageData(64, 64, (_x, y) => {
      // Mosaico: casco arriba amarillo, chaleco centro naranja, botas abajo negro.
      if (y < 64 * 0.3) return [255, 220, 0];
      if (y > 64 * 0.75) return [30, 25, 20];
      return [255, 120, 0];
    });
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
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
    const img = makeImageData(32, 32, () => [255, 0, 0]);
    const det = new ColorBasedEppDetector();
    const detections = await det.detect(img);
    detections.forEach((d) => {
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    });
  });
});
