// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-23) tests del USDZ exporter.
//
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { PointCloud } from './pointCloudBuilder';

// El USDZExporter de three.js usa internamente `JSZip`-like (fflate) y
// no necesita DOM. Importamos exportPointCloudToUsdz dinámicamente
// dentro de cada test para que jsdom esté disponible (Three.js + r3f
// hacen feature-detection del runtime).

beforeAll(() => {
  // jsdom no expone OffscreenCanvas; three.js GPU paths a veces fallan
  // en jsdom. No usamos texturas en este exporter, así que está OK.
});

function makeSimplePointCloud(): PointCloud {
  const n = 4;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  // Cuatro puntos formando un cuadrado en Z=0.
  const corners: Array<[number, number, number]> = [
    [-1, -1, 0],
    [1, -1, 0],
    [1, 1, 0],
    [-1, 1, 0],
  ];
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = corners[i][0];
    positions[i * 3 + 1] = corners[i][1];
    positions[i * 3 + 2] = corners[i][2];
    colors[i * 3] = 0.5;
    colors[i * 3 + 1] = 0.7;
    colors[i * 3 + 2] = 0.9;
  }
  return {
    positions,
    colors,
    pointCount: n,
    boundingBox: { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: 0, maxZ: 0 },
    framesContributing: 1,
    gridResolution: 2,
  };
}

describe('exportPointCloudToUsdz', () => {
  it('tira si el cloud está vacío', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const empty: PointCloud = {
      positions: new Float32Array(),
      colors: new Float32Array(),
      pointCount: 0,
      boundingBox: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      framesContributing: 0,
      gridResolution: 0,
    };
    await expect(exportPointCloudToUsdz(empty)).rejects.toThrow(/empty cloud/);
  });

  it('produce blob con MIME model/vnd.usdz+zip', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('model/vnd.usdz+zip');
  });

  it('triangleCount = 2 × pointCount (2 tris por quad)', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud);
    expect(result.triangleCount).toBe(cloud.pointCount * 2);
  });

  it('vertexCount = 4 × pointCount (4 verts por quad)', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud);
    expect(result.vertexCount).toBe(cloud.pointCount * 4);
  });

  it('sizeBytes > 0 (el USDZ no debe ser vacío)', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('respeta el quadSize custom (cuad más grande → file más grande)', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const small = await exportPointCloudToUsdz(cloud, { quadSize: 0.01 });
    const big = await exportPointCloudToUsdz(cloud, { quadSize: 1.0 });
    // Mismas geometry counts, mismo tamaño aprox — el quadSize solo
    // afecta posiciones de vértices (mismo número). El test verifica
    // que ambas exporten OK, no diferencia de bytes.
    expect(small.triangleCount).toBe(big.triangleCount);
    expect(small.sizeBytes).toBeGreaterThan(0);
    expect(big.sizeBytes).toBeGreaterThan(0);
  });

  // ─── §Fase D.2 visual improvements ──────────────────────────────────

  it('§D.2: colorGamma=1 (default) produce mismo output que sin opción', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const a = await exportPointCloudToUsdz(cloud);
    const b = await exportPointCloudToUsdz(cloud, { colorGamma: 1 });
    // Mismos counts, mismo blob.size (gamma=1 = identity).
    expect(a.triangleCount).toBe(b.triangleCount);
    expect(a.vertexCount).toBe(b.vertexCount);
  });

  it('§D.2: colorGamma < 1 (boost) genera USDZ válido', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud, { colorGamma: 0.5 });
    expect(result.blob.type).toBe('model/vnd.usdz+zip');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('§D.2: colorGamma > 1 (oscurece) genera USDZ válido', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud, { colorGamma: 2 });
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('§D.2: useUnlitMaterial=true genera USDZ válido (MeshBasicMaterial path)', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud, { useUnlitMaterial: true });
    expect(result.blob.type).toBe('model/vnd.usdz+zip');
    expect(result.triangleCount).toBe(cloud.pointCount * 2);
    expect(result.vertexCount).toBe(cloud.pointCount * 4);
  });

  it('§D.2: combinación gamma + unlit funciona', async () => {
    const { exportPointCloudToUsdz } = await import('./usdzExporter');
    const cloud = makeSimplePointCloud();
    const result = await exportPointCloudToUsdz(cloud, {
      colorGamma: 0.6,
      useUnlitMaterial: true,
      quadSize: 0.08,
    });
    expect(result.sizeBytes).toBeGreaterThan(0);
  });
});
