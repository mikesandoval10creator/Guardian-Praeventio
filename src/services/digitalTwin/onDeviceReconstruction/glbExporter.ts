// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction.
//
// Exporta un PointCloud (de pointCloudBuilder.ts) a formato GLB usando
// three.js GLTFExporter. El GLB resultante:
//   - Carga en cualquier visor three.js / model-viewer / Quick Look-iOS.
//   - Preserva los colores RGB por vertex.
//   - Es ~20 bytes/punto + overhead → 1000 puntos ≈ 20 KB, 5000 ≈ 100 KB.
//
// Three.js GLTFExporter soporta primitives `POINTS` desde r140+. Lo
// usamos con `binary: true` para obtener un único Blob comprimido.
//
// Privacy: el GLB se construye en RAM y se DEVUELVE al caller. Decide
// el caller si lo persiste local (IndexedDB), lo sube a Storage, o lo
// descarta.

import * as THREE from 'three';
// `three/examples/jsm/exporters/GLTFExporter` viene en `examples/jsm`
// (Vite + tree-shake friendly). El paquete `three` instalado ya
// incluye estos exporters en su dist.
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { PointCloud } from './pointCloudBuilder';

export interface ExportGlbResult {
  /** Blob del GLB binario listo para upload o save. */
  blob: Blob;
  /** Tamaño en bytes (cómodo para mostrar al usuario). */
  sizeBytes: number;
  /** Cantidad de vértices en el GLB. */
  vertexCount: number;
}

/**
 * Convierte un PointCloud a Blob GLB.
 *
 * Lanza si:
 *   - El PointCloud está vacío (pointCount === 0).
 *   - GLTFExporter devuelve un tipo inesperado (no debería pasar con
 *     binary: true, pero defendemos).
 */
export async function exportPointCloudToGlb(cloud: PointCloud): Promise<ExportGlbResult> {
  if (cloud.pointCount === 0) {
    throw new Error('exportPointCloudToGlb: empty cloud.');
  }

  // BufferGeometry con position + color attributes.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3));
  geometry.computeBoundingBox();

  // PointsMaterial con vertexColors=true para preservar el color por punto.
  const material = new THREE.PointsMaterial({
    size: 0.05,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'praeventio-on-device-reconstruction';

  // Scene wrapper — GLTFExporter exige un Object3D root.
  const scene = new THREE.Scene();
  scene.add(points);

  const exporter = new GLTFExporter();

  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error('GLTFExporter returned non-binary (expected ArrayBuffer)'));
        }
      },
      (err) => {
        reject(new Error(`GLTFExporter failed: ${String(err)}`));
      },
      {
        binary: true,
      },
    );
  });

  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });

  // Dispose de THREE objects (libera la GPU memory si geometry se subió).
  geometry.dispose();
  material.dispose();

  return {
    blob,
    sizeBytes: blob.size,
    vertexCount: cloud.pointCount,
  };
}
