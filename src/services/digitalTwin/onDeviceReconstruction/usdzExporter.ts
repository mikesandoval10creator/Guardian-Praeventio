// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-23) USDZ exporter para iOS Quick Look.
//
// El pipeline `onDeviceReconstruction` produce un POINTS primitive (GLB)
// que three.js renderiza nativamente. iOS AR Quick Look NO soporta POINTS
// — exige Mesh (triángulos). Esta capa convierte el `PointCloud` en un
// mesh real:
//
//   Cada punto → un quad pequeño (2 triángulos) orientado a +Z, con el
//   color RGB del punto como vertexColors. El quadSize default 0.05 m
//   da una densidad visual similar al PointsMaterial size 0.05.
//
// Total triángulos = 2 × pointCount. Para 17k puntos → 34k tris, que
// está en el rango seguro para iOS Quick Look (límite práctico ~150k).
//
// Output: Blob model/vnd.usdz+zip, listo para subir a Storage y para que
// `<ArViewLink kind="usdz" ...>` lo abra en Quick Look del iPhone.
//
// Privacy: igual que glbExporter — el resultado es estructura/color
// derivada del video del usuario, NO la imagen original.

import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { PointCloud } from './pointCloudBuilder';

export interface ExportUsdzResult {
  blob: Blob;
  sizeBytes: number;
  vertexCount: number;
  triangleCount: number;
}

/**
 * Construye un `THREE.Mesh` representando el point cloud como quads
 * billboard. Cada punto se convierte en 4 vértices + 2 triángulos.
 *
 * Helper interno; el caller usa `exportPointCloudToUsdz`.
 */
/**
 * Aplica gamma correction a un componente de color [0,1]. Gamma < 1
 * "boostea" (claros más claros, oscuros se oscurecen menos); gamma > 1
 * oscurece globalmente. Default 1 = sin cambio. Plan §Fase D.2 — los
 * point clouds tienden a verse muted en iOS Quick Look porque su
 * default rendering aplica tone mapping; gamma 0.5-0.7 compensa.
 */
function gammaCorrect(channel: number, gamma: number): number {
  if (gamma === 1) return channel;
  // Evitamos NaN si channel < 0 (no debería pasar pero defensivo).
  return Math.max(0, Math.min(1, Math.pow(Math.max(0, channel), gamma)));
}

function buildQuadMeshFromPointCloud(
  cloud: PointCloud,
  quadSize: number = 0.05,
  colorGamma: number = 1,
): THREE.Mesh {
  const n = cloud.pointCount;
  const half = quadSize / 2;

  const positions = new Float32Array(n * 4 * 3); // 4 verts × xyz por quad
  const colors = new Float32Array(n * 4 * 3);
  const normals = new Float32Array(n * 4 * 3);
  const indices = new Uint32Array(n * 6); // 2 tris × 3 índices por quad

  for (let i = 0; i < n; i += 1) {
    const px = cloud.positions[i * 3];
    const py = cloud.positions[i * 3 + 1];
    const pz = cloud.positions[i * 3 + 2];
    // §Fase D.2: gamma correction opcional para compensar tone-map iOS QL.
    const r = gammaCorrect(cloud.colors[i * 3], colorGamma);
    const g = gammaCorrect(cloud.colors[i * 3 + 1], colorGamma);
    const b = gammaCorrect(cloud.colors[i * 3 + 2], colorGamma);

    // 4 vertices del quad — counter-clockwise mirando desde +Z.
    //  bl(0)──br(1)
    //   │     │
    //  tl(3)──tr(2)
    const base = i * 4;
    // bl
    positions[base * 3] = px - half;
    positions[base * 3 + 1] = py - half;
    positions[base * 3 + 2] = pz;
    // br
    positions[(base + 1) * 3] = px + half;
    positions[(base + 1) * 3 + 1] = py - half;
    positions[(base + 1) * 3 + 2] = pz;
    // tr
    positions[(base + 2) * 3] = px + half;
    positions[(base + 2) * 3 + 1] = py + half;
    positions[(base + 2) * 3 + 2] = pz;
    // tl
    positions[(base + 3) * 3] = px - half;
    positions[(base + 3) * 3 + 1] = py + half;
    positions[(base + 3) * 3 + 2] = pz;

    // Colors (4 copies del color del punto).
    for (let v = 0; v < 4; v += 1) {
      colors[(base + v) * 3] = r;
      colors[(base + v) * 3 + 1] = g;
      colors[(base + v) * 3 + 2] = b;
      // Normal +Z
      normals[(base + v) * 3] = 0;
      normals[(base + v) * 3 + 1] = 0;
      normals[(base + v) * 3 + 2] = 1;
    }

    // Indices — 2 triángulos (CCW: front-facing).
    //   Tri 1: bl(0) → br(1) → tr(2)
    //   Tri 2: bl(0) → tr(2) → tl(3)
    const idxBase = i * 6;
    indices[idxBase] = base;
    indices[idxBase + 1] = base + 1;
    indices[idxBase + 2] = base + 2;
    indices[idxBase + 3] = base;
    indices[idxBase + 4] = base + 2;
    indices[idxBase + 5] = base + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // MeshStandardMaterial con vertexColors=true. USDZExporter mapea esto
  // a un USDPreviewSurface — el iOS Quick Look lo respeta.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    metalness: 0,
    roughness: 0.85,
  });

  return new THREE.Mesh(geometry, material);
}

/**
 * Versión "unlit" del mesh — usa MeshBasicMaterial (sin lighting). Plan
 * §Fase D.2: cuando el usuario quiere ver el point cloud con colores
 * fieles al video original (sin que el lighting de iOS Quick Look los
 * oscurezca), este material es mejor. USDZExporter mapea MeshBasicMaterial
 * a un USDPreviewSurface con emissive color → bypassa el tone mapping.
 */
function buildUnlitQuadMeshFromPointCloud(
  cloud: PointCloud,
  quadSize: number = 0.05,
  colorGamma: number = 1,
): THREE.Mesh {
  const mesh = buildQuadMeshFromPointCloud(cloud, quadSize, colorGamma);
  // Swap material — el geometry queda igual.
  (mesh.material as THREE.Material).dispose();
  mesh.material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  return mesh;
}

/**
 * Exporta un PointCloud a Blob USDZ listo para iOS AR Quick Look.
 *
 * Lanza si:
 *  - El cloud está vacío.
 *  - USDZExporter falla (typically: textura > maxTextureSize que no
 *    aplica acá porque no usamos texturas — solo vertexColors).
 *
 * `quickLookCompatible: true` activa el modo más restrictivo, que
 * garantiza compatibilidad con iOS 13+. El observador podrá rotar +
 * "pegar" el mesh a un plano horizontal en AR.
 */
export interface ExportUsdzOptions {
  /** Tamaño del quad por punto en metros. Default 0.05. */
  quadSize?: number;
  /**
   * §Fase D.2 (2026-05-23) — Gamma correction sobre vertex colors antes
   * de exportar. Default 1 (sin cambio). Valores 0.5-0.7 compensan el
   * tone mapping que iOS Quick Look aplica por defecto y hace los colores
   * "pop" más vívidos. > 1 oscurece globalmente. Rango sano: [0.4, 2].
   */
  colorGamma?: number;
  /**
   * §Fase D.2 (2026-05-23) — Si true, usa MeshBasicMaterial (unlit) en
   * vez de MeshStandardMaterial. Default false. Unlit produce colores
   * más vívidos en iOS Quick Look porque NO interactúa con el ambient
   * lighting del Quick Look (los puntos se ven como en el video original
   * en vez de "sombreados"). Trade-off: pierde sensación 3D (ningún
   * vértice se oscurece según el ángulo) — útil para visualización
   * indicativa, no para inspección estructural.
   */
  useUnlitMaterial?: boolean;
}

export async function exportPointCloudToUsdz(
  cloud: PointCloud,
  options: ExportUsdzOptions = {},
): Promise<ExportUsdzResult> {
  if (cloud.pointCount === 0) {
    throw new Error('exportPointCloudToUsdz: empty cloud.');
  }

  const quadSize = options.quadSize ?? 0.05;
  const colorGamma = options.colorGamma ?? 1;
  const useUnlit = options.useUnlitMaterial ?? false;

  const mesh = useUnlit
    ? buildUnlitQuadMeshFromPointCloud(cloud, quadSize, colorGamma)
    : buildQuadMeshFromPointCloud(cloud, quadSize, colorGamma);
  mesh.name = 'praeventio-on-device-reconstruction-ios';
  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new USDZExporter();
  const buffer = await exporter.parseAsync(scene, {
    quickLookCompatible: true,
    // No usamos texturas (solo vertexColors) → maxTextureSize irrelevante.
    maxTextureSize: 1024,
    includeAnchoringProperties: true,
    ar: {
      anchoring: { type: 'plane' },
      planeAnchoring: { alignment: 'horizontal' },
    },
  });

  const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : (buffer as Uint8Array).buffer;
  const blob = new Blob([arrayBuffer], { type: 'model/vnd.usdz+zip' });

  // Dispose THREE resources.
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();

  return {
    blob,
    sizeBytes: blob.size,
    vertexCount: cloud.pointCount * 4,
    triangleCount: cloud.pointCount * 2,
  };
}
