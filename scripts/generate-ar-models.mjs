#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// generate-ar-models.mjs — Sprint 21 Ola 4 Bucket M.1.
//
// Genera assets `.glb` placeholder simples (cilindros coloreados) para los
// 17 PlacedObjectKind. Estos GLBs son la fuente para la conversión
// .glb → .usdz documentada en `docs/ar-assets.md` (Bucket M.2).
//
// Por qué cilindros y no meshes detallados: los markers de PlacedObjectsLayer
// son cilindros (cylinderGeometry) y reproducimos esa estética en AR para
// coherencia visual. La mejora estética (modelos detallados de extintor,
// señalética, etc.) está documentada para sprints futuros con
// frontend-design / Blender MCP.
//
// Uso:
//   node scripts/generate-ar-models.mjs
//
// Output:
//   public/models/ar/{kind}.glb   (uno por cada PlacedObjectKind)

import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs/promises';
import path from 'node:path';

// 17 PlacedObjectKind — fuente única en src/services/digitalTwin/photogrammetry/types.ts
const KINDS = [
  'extinguisher_pqs',
  'extinguisher_co2',
  'extinguisher_water',
  'hydrant',
  'sign_evacuation',
  'sign_warning',
  'sign_mandatory',
  'sign_prohibition',
  'aed',
  'first_aid_kit',
  'emergency_shower',
  'eye_wash_station',
  'gas_detector',
  'spill_kit',
  'safety_shower',
  'assembly_point',
  'evacuation_route',
];

// RGB normalizados [0..1] — espejo del KIND_COLOR de PlacedObjectsLayer.tsx.
// Si cambia el mapping allí, regenerar los GLBs.
const COLORS = {
  extinguisher_pqs: [0.86, 0.15, 0.15], // #dc2626 rojo
  extinguisher_co2: [0.12, 0.12, 0.12], // #1f1f1f negro
  extinguisher_water: [0.15, 0.39, 0.92], // #2563eb azul
  hydrant: [0.96, 0.62, 0.04], // #f59e0b amarillo
  sign_evacuation: [0.06, 0.72, 0.51], // #10b981 verde
  sign_warning: [0.96, 0.62, 0.04],
  sign_mandatory: [0.15, 0.39, 0.92],
  sign_prohibition: [0.86, 0.15, 0.15],
  aed: [0.09, 0.64, 0.29], // #16a34a verde
  first_aid_kit: [0.94, 0.27, 0.27], // #ef4444
  emergency_shower: [0.02, 0.71, 0.83], // #06b6d4
  eye_wash_station: [0.13, 0.83, 0.94], // #22d3ee
  gas_detector: [0.66, 0.33, 0.97], // #a855f7
  spill_kit: [0.92, 0.7, 0.03], // #eab308
  safety_shower: [0.05, 0.65, 0.91], // #0ea5e9
  assembly_point: [0.13, 0.77, 0.37], // #22c55e
  evacuation_route: [0.4, 0.64, 0.05], // #65a30d
};

const TARGET_DIR = path.resolve(process.cwd(), 'public/models/ar');

/**
 * Genera la geometría de un cilindro simple (radius=0.25 top, 0.3 bottom,
 * height=0.8) que coincide con `<cylinderGeometry args={[0.25, 0.3, 0.8, 12]} />`
 * de PlacedObjectsLayer.tsx. Devuelve {positions, normals, indices} como
 * Float32Array / Uint32Array listos para inyectar en glTF.
 *
 * Construcción manual: 12 segments → 26 vertices (12 top + 12 bottom + 1
 * top center + 1 bottom center) y 4 triángulos por slice (2 lateral + 1 top
 * cap + 1 bottom cap) = 48 tris.
 */
function buildCylinder({ radiusTop = 0.25, radiusBottom = 0.3, height = 0.8, segments = 12 } = {}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const halfH = height / 2;

  // Lateral vertices — duplicados para tener normales planas por anillo
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = Math.cos(theta);
    const z = Math.sin(theta);
    // Top
    positions.push(radiusTop * x, halfH, radiusTop * z);
    normals.push(x, 0, z);
    // Bottom
    positions.push(radiusBottom * x, -halfH, radiusBottom * z);
    normals.push(x, 0, z);
  }

  // Lateral indices — 2 triángulos por slice
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  // Top cap
  const topCenterIdx = positions.length / 3;
  positions.push(0, halfH, 0);
  normals.push(0, 1, 0);
  const topRingStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    positions.push(radiusTop * Math.cos(theta), halfH, radiusTop * Math.sin(theta));
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenterIdx, topRingStart + i, topRingStart + i + 1);
  }

  // Bottom cap
  const bottomCenterIdx = positions.length / 3;
  positions.push(0, -halfH, 0);
  normals.push(0, -1, 0);
  const bottomRingStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    positions.push(radiusBottom * Math.cos(theta), -halfH, radiusBottom * Math.sin(theta));
    normals.push(0, -1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(bottomCenterIdx, bottomRingStart + i + 1, bottomRingStart + i);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Crea un Document gltf-transform listo para escribir como GLB. */
function buildDocument(kind, color) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = `praeventio-ar-${kind}`;

  const buffer = doc.createBuffer();
  const { positions, normals, indices } = buildCylinder();

  // Bounding box (min/max) para `position` accessor — REQUIRED por glTF spec.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }

  const positionAccessor = doc
    .createAccessor('POSITION')
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer);

  const normalAccessor = doc
    .createAccessor('NORMAL')
    .setType('VEC3')
    .setArray(normals)
    .setBuffer(buffer);

  const indexAccessor = doc
    .createAccessor('indices')
    .setType('SCALAR')
    .setArray(indices)
    .setBuffer(buffer);

  const material = doc
    .createMaterial(`${kind}-mat`)
    .setBaseColorFactor([color[0], color[1], color[2], 1])
    .setMetallicFactor(0.0)
    .setRoughnessFactor(0.7);

  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setAttribute('NORMAL', normalAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);

  const mesh = doc.createMesh(`${kind}-mesh`).addPrimitive(primitive);
  const node = doc.createNode(`${kind}-node`).setMesh(mesh);
  doc.createScene(`${kind}-scene`).addChild(node);

  return doc;
}

async function main() {
  await fs.mkdir(TARGET_DIR, { recursive: true });
  const io = new NodeIO();

  let okCount = 0;
  for (const kind of KINDS) {
    const color = COLORS[kind];
    if (!color) {
      console.warn(`[generate-ar-models] no color mapping for ${kind} — skipping`);
      continue;
    }
    const doc = buildDocument(kind, color);
    const outPath = path.join(TARGET_DIR, `${kind}.glb`);
    await io.write(outPath, doc);
    const size = (await fs.stat(outPath)).size;
    console.log(`[generate-ar-models] wrote ${kind}.glb (${size} bytes)`);
    okCount += 1;
  }

  console.log(`[generate-ar-models] done — ${okCount}/${KINDS.length} GLBs in ${TARGET_DIR}`);
}

main().catch((err) => {
  console.error('[generate-ar-models] FAILED:', err);
  process.exit(1);
});
