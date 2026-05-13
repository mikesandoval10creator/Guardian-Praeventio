// @vitest-environment jsdom
//
// Sprint 48 E.2 — @react-three/test-renderer real (sin mock Canvas).
//
// Cierra E.2 del plan maestro ("Migrar tests 3D a r3f test-renderer real").
// Renderiza los sub-componentes scene-graph de TwinSceneInstanced en un
// renderer r3f sin WebGL (test-renderer hace null-render del scene tree)
// y verifica:
//
//   - InstancedMesh creado con `limit` correcto
//   - Detailed agrupa N levels para LOD
//   - WorkersByStatus produce N grupos = N statuses únicos
//
// Diferencia vs mocks: aquí el componente Three.js real se monta. Si un
// día el componente cambia (p.ej. cambia <sphereGeometry> por <icosaGeometry>)
// el test lo refleja sin tocar el mock. Tests más resilientes a refactor.
//
// Mocks que SE MANTIENEN:
//   - Ninguno aquí. Las dependencias r3f son reales.
//   - (Tests de TwinPhysicsScene mantienen mock de @react-three/rapier
//     porque WASM solver no inicializa en jsdom — ver comentario allí.)
import { describe, it, expect } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import {
  WorkersByStatus,
  EquipmentRenderer,
  type WorkerMarker,
  type EquipmentInstance,
} from '../TwinSceneInstanced.js';

const WORKERS: WorkerMarker[] = [
  { id: 'w1', position: [0, 0, 0], status: 'safe' },
  { id: 'w2', position: [1, 0, 1], status: 'safe' },
  { id: 'w3', position: [2, 0, 1], status: 'warning' },
  { id: 'w4', position: [3, 0, 2], status: 'sos' },
];

describe('Sprint 48 E.2 — r3f test-renderer real (scene graph)', () => {
  it('WorkersByStatus crea 1 InstancedMesh por status único', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <WorkersByStatus workers={WORKERS} />,
    );

    // 3 statuses únicos (safe, warning, sos) → 3 InstancedMesh
    const instancedMeshes = renderer.scene.findAllByType('InstancedMesh');
    expect(instancedMeshes.length).toBe(3);

    await renderer.unmount();
  });

  it('WorkersByStatus respeta el limit de cada InstancedMesh', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <WorkersByStatus workers={WORKERS} />,
    );

    // El componente pasa `limit={Math.max(list.length, 1)}` al Instances drei.
    // El InstancedMesh resultante tiene `count` interno ≥ instancias.
    const meshes = renderer.scene.findAllByType('InstancedMesh');
    // Suma de instancias activas debe coincidir con # de workers
    const totalInstances = meshes.reduce((acc, m) => {
      const instance = m.instance as unknown as { count: number };
      return acc + (instance.count ?? 0);
    }, 0);
    // count puede ser >= workers.length (Instances reserva `limit` slots)
    expect(totalInstances).toBeGreaterThanOrEqual(WORKERS.length);

    await renderer.unmount();
  });

  it('EquipmentRenderer agrupa LOD (Detailed) para palas y camiones', async () => {
    const equipment: EquipmentInstance[] = [
      { id: 'p1', kind: 'pala', position: [10, 0, 0] },
      { id: 'p2', kind: 'pala', position: [12, 0, 0] },
      { id: 'c1', kind: 'camion', position: [14, 0, 0] },
    ];

    const renderer = await ReactThreeTestRenderer.create(
      <EquipmentRenderer equipment={equipment} />,
    );

    // Detailed de drei usa THREE.LOD bajo el capó
    const lodNodes = renderer.scene.findAllByType('LOD');
    // 2 palas + 1 camión = 3 LOD groups
    expect(lodNodes.length).toBe(3);

    // Cada LOD tiene 3 niveles (near, medium, far) en este componente
    for (const lod of lodNodes) {
      const instance = lod.instance as unknown as { levels: unknown[] };
      expect(instance.levels.length).toBe(3);
    }

    await renderer.unmount();
  });

  it('EquipmentRenderer usa InstancedMesh para pernos/luminarias/posts', async () => {
    const equipment: EquipmentInstance[] = [
      { id: 'b1', kind: 'perno', position: [1, 0, 1] },
      { id: 'b2', kind: 'perno', position: [2, 0, 1] },
      { id: 'l1', kind: 'luminaria', position: [3, 5, 0] },
      { id: 'l2', kind: 'luminaria', position: [4, 5, 0] },
      { id: 'sp1', kind: 'sensor_post', position: [5, 0, 0] },
    ];

    const renderer = await ReactThreeTestRenderer.create(
      <EquipmentRenderer equipment={equipment} />,
    );

    // 3 grupos: pernos, luminarias, posts → 3 InstancedMesh
    const instancedMeshes = renderer.scene.findAllByType('InstancedMesh');
    expect(instancedMeshes.length).toBe(3);

    await renderer.unmount();
  });

  it('EquipmentRenderer no crea InstancedMesh si no hay equipos de ese tipo', async () => {
    const equipment: EquipmentInstance[] = [
      { id: 'b1', kind: 'perno', position: [1, 0, 1] },
    ];

    const renderer = await ReactThreeTestRenderer.create(
      <EquipmentRenderer equipment={equipment} />,
    );

    // Solo pernos → 1 InstancedMesh
    const instancedMeshes = renderer.scene.findAllByType('InstancedMesh');
    expect(instancedMeshes.length).toBe(1);
    // Y 0 LOD groups (no palas ni camiones)
    const lods = renderer.scene.findAllByType('LOD');
    expect(lods.length).toBe(0);

    await renderer.unmount();
  });

  it('WorkersByStatus con 1 solo worker crea 1 InstancedMesh con limit ≥ 1', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <WorkersByStatus workers={[{ id: 'w1', position: [0, 0, 0], status: 'safe' }]} />,
    );
    const meshes = renderer.scene.findAllByType('InstancedMesh');
    expect(meshes.length).toBe(1);
    await renderer.unmount();
  });

  it('WorkersByStatus con 0 workers no genera scene nodes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <WorkersByStatus workers={[]} />,
    );
    const meshes = renderer.scene.findAllByType('InstancedMesh');
    expect(meshes.length).toBe(0);
    await renderer.unmount();
  });
});
