// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) tests del point cloud builder.

import { describe, it, expect } from 'vitest';
import { buildPointCloudFromFrames } from './pointCloudBuilder';
import type { ExtractedFrame } from './frameExtractor';

/**
 * Helper: construye un ExtractedFrame sintético con pixel data conocido.
 * Cada pixel = mismo color (uniform) para tests determinísticos.
 */
function makeFrame(
  index: number,
  width: number,
  height: number,
  rgb: [number, number, number],
): ExtractedFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  // En vitest+jsdom ImageData puede no existir; usamos un cast tipado.
  const imageData = { data, width, height } as unknown as ImageData;
  return {
    index,
    timestampS: index * 0.1,
    imageData,
    width,
    height,
  };
}

describe('buildPointCloudFromFrames', () => {
  it('tira si no hay frames', () => {
    expect(() => buildPointCloudFromFrames([])).toThrow(/no frames/);
  });

  it('produce gridResolution × gridResolution puntos por frame', () => {
    const frames = [
      makeFrame(0, 64, 64, [128, 128, 128]),
      makeFrame(1, 64, 64, [128, 128, 128]),
    ];
    const cloud = buildPointCloudFromFrames(frames, { gridResolution: 16 });
    // 16×16 = 256 puntos por frame × 2 frames = 512 puntos totales.
    expect(cloud.pointCount).toBe(256 * 2);
    expect(cloud.positions.length).toBe(256 * 2 * 3);
    expect(cloud.colors.length).toBe(256 * 2 * 3);
    expect(cloud.gridResolution).toBe(16);
  });

  it('respeta gridResolution mínimo (4) y máximo (128)', () => {
    const frames = [makeFrame(0, 32, 32, [255, 255, 255])];
    const tooSmall = buildPointCloudFromFrames(frames, { gridResolution: 2 });
    expect(tooSmall.gridResolution).toBe(4);
    const tooBig = buildPointCloudFromFrames(frames, { gridResolution: 256 });
    expect(tooBig.gridResolution).toBe(128);
  });

  it('preserva colores RGB del pixel en el array de colores', () => {
    // Frame totalmente rojo.
    const frames = [makeFrame(0, 16, 16, [255, 0, 0])];
    const cloud = buildPointCloudFromFrames(frames, { gridResolution: 8 });
    // El primer punto debe tener color rojo puro (1, 0, 0) normalizado.
    expect(cloud.colors[0]).toBeCloseTo(1, 2);
    expect(cloud.colors[1]).toBeCloseTo(0, 2);
    expect(cloud.colors[2]).toBeCloseTo(0, 2);
  });

  it('frames sucesivos se posicionan más lejos en Z (eje de barrido)', () => {
    const frames = [
      makeFrame(0, 16, 16, [128, 128, 128]),
      makeFrame(1, 16, 16, [128, 128, 128]),
      makeFrame(2, 16, 16, [128, 128, 128]),
    ];
    const cloud = buildPointCloudFromFrames(frames, {
      gridResolution: 4,
      frameZStep: 1.0,
      depthAmplitude: 0, // anula la heurística depth para test puro
    });
    // 4×4 = 16 puntos por frame. El primer Z del frame 0 debe ser ≈ 0,
    // del frame 1 ≈ -1, del frame 2 ≈ -2.
    const z0 = cloud.positions[2];
    const z1 = cloud.positions[16 * 3 + 2];
    const z2 = cloud.positions[32 * 3 + 2];
    expect(z0).toBeCloseTo(0, 2);
    expect(z1).toBeCloseTo(-1, 2);
    expect(z2).toBeCloseTo(-2, 2);
  });

  it('bounding box es válido y refleja el rango de puntos', () => {
    const frames = [makeFrame(0, 32, 32, [100, 200, 50])];
    const cloud = buildPointCloudFromFrames(frames, {
      gridResolution: 8,
      xyScale: 4,
      depthAmplitude: 0,
    });
    expect(cloud.boundingBox.maxX).toBeGreaterThan(cloud.boundingBox.minX);
    expect(cloud.boundingBox.maxY).toBeGreaterThan(cloud.boundingBox.minY);
    // Con depthAmplitude=0 y un solo frame, minZ === maxZ.
    expect(cloud.boundingBox.maxZ).toBeCloseTo(cloud.boundingBox.minZ, 2);
  });

  it('aspect ratio del frame se preserva en XY (frame 16:9 → bbox 16:9)', () => {
    // Frame 32×18 (16:9-ish).
    const frames = [makeFrame(0, 32, 18, [128, 128, 128])];
    const cloud = buildPointCloudFromFrames(frames, {
      gridResolution: 8,
      xyScale: 10,
      depthAmplitude: 0,
    });
    const xRange = cloud.boundingBox.maxX - cloud.boundingBox.minX;
    const yRange = cloud.boundingBox.maxY - cloud.boundingBox.minY;
    const aspect = xRange / yRange;
    // 32/18 ≈ 1.78
    expect(aspect).toBeCloseTo(32 / 18, 1);
  });

  it('framesContributing refleja la cantidad de frames pasados', () => {
    const frames = [
      makeFrame(0, 16, 16, [100, 100, 100]),
      makeFrame(1, 16, 16, [150, 150, 150]),
      makeFrame(2, 16, 16, [200, 200, 200]),
    ];
    const cloud = buildPointCloudFromFrames(frames, { gridResolution: 4 });
    expect(cloud.framesContributing).toBe(3);
  });

  it('invoca onProgress por cada frame procesado', () => {
    const frames = [
      makeFrame(0, 16, 16, [100, 100, 100]),
      makeFrame(1, 16, 16, [150, 150, 150]),
    ];
    const progressCalls: number[] = [];
    buildPointCloudFromFrames(frames, {
      gridResolution: 4,
      onProgress: (r) => progressCalls.push(r),
    });
    expect(progressCalls).toEqual([0.5, 1]);
  });
});
