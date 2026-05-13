// @vitest-environment jsdom
//
// Sprint 48 E.2 — Migración parcial a @react-three/test-renderer real.
//
// Este archivo verifica el WRAPPER DOM (HUD, data-objects, className,
// border de appearance) que es plain React. El scene-graph 3D
// (InstancedMesh, LOD, Instances grouping) se prueba con el renderer
// r3f real en `__tests__/sceneGraph.r3f.test.tsx`.
//
// Mocks que SE MANTIENEN:
//   - @react-three/fiber Canvas: el componente envuelve TODO en Canvas y
//     éste requiere WebGL no presente en jsdom. Para validar el HUD DOM
//     basta un stub. Para validar scene-graph: usar test-renderer (cubierto
//     en sceneGraph.r3f.test.tsx que importa sub-componentes directos).
//   - @react-three/rapier: Physics inicializa el solver WASM que no carga
//     en jsdom (incluso con test-renderer). Mock necesario.
//   - @react-three/drei: se mockea solo para los testids del HUD-wrapper.
//     Para asserts en LOD/Instances reales → ver sceneGraph.r3f.test.tsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Canvas mock — jsdom no tiene WebGL. Stub solo emite los children al DOM
// para que los testids `data-testid="lod"` / `instances"` sean accesibles
// para los asserts de presencia. Las verificaciones de scene graph real
// están en sceneGraph.r3f.test.tsx (sin este mock).
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));

// Rapier mock — Physics solver requiere WASM (no inicializa en jsdom).
// Justificado: cubrir el flag physicsEnabled sin levantar el motor real.
vi.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-physics">{children}</div>
  ),
  RigidBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Drei mock — proxy con testids para verificar presencia agrupada.
// Para count exacto de InstancedMesh / niveles LOD → sceneGraph.r3f.test.tsx.
vi.mock('@react-three/drei', () => ({
  Detailed: ({ children }: { children: React.ReactNode }) => <div data-testid="lod">{children}</div>,
  Instances: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="instances">{children}</div>
  ),
  Instance: () => <div data-testid="instance" />,
  OrbitControls: () => <div data-testid="orbit" />,
}));

import {
  TwinSceneInstanced,
  type WorkerMarker,
  type EquipmentInstance,
  type SensorMarker,
  type CargoItem,
} from './TwinSceneInstanced.js';

const WORKERS: WorkerMarker[] = [
  { id: 'w1', position: [0, 0, 0], status: 'safe' },
  { id: 'w2', position: [2, 0, 1], status: 'warning' },
  { id: 'w3', position: [3, 0, 2], status: 'sos' },
];

const EQUIPMENT: EquipmentInstance[] = [
  { id: 'p1', kind: 'pala', position: [10, 0, 0] },
  { id: 'c1', kind: 'camion', position: [12, 0, 5] },
  { id: 'b1', kind: 'perno', position: [1, 0, 1] },
  { id: 'b2', kind: 'perno', position: [2, 0, 1] },
  { id: 'l1', kind: 'luminaria', position: [3, 5, 0] },
];

const SENSORS: SensorMarker[] = [
  { id: 's1', kind: 'co', position: [4, 1, 0], reading: 8, alert: true },
  { id: 's2', kind: 'temp', position: [5, 1, 0], reading: 22, alert: false },
];

describe('TwinSceneInstanced', () => {
  it('renderiza con HUD mostrando total y trabajadores', () => {
    render(<TwinSceneInstanced workers={WORKERS} equipment={EQUIPMENT} sensors={SENSORS} />);
    const scene = screen.getByTestId('twin-scene');
    expect(scene).toHaveAttribute('data-objects', String(WORKERS.length + EQUIPMENT.length + SENSORS.length));
    expect(screen.getByTestId('twin-scene.hud')).toHaveTextContent(/3 trabajadores/);
  });

  it('lista vacía no rompe', () => {
    render(<TwinSceneInstanced />);
    const scene = screen.getByTestId('twin-scene');
    expect(scene).toHaveAttribute('data-objects', '0');
  });

  it('activa Physics layer cuando physicsEnabled=true', () => {
    render(<TwinSceneInstanced workers={WORKERS} physicsEnabled />);
    expect(screen.getByTestId('rapier-physics')).toBeInTheDocument();
  });

  it('NO activa Physics cuando physicsEnabled=false (default)', () => {
    render(<TwinSceneInstanced workers={WORKERS} />);
    expect(screen.queryByTestId('rapier-physics')).not.toBeInTheDocument();
  });

  it('usa Detailed (LOD) para palas y camiones', () => {
    render(<TwinSceneInstanced equipment={EQUIPMENT} />);
    // Pala + camión = 2 LOD groups
    const lodNodes = screen.getAllByTestId('lod');
    expect(lodNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('usa Instances (InstancedMesh) para pernos/luminarias/sensor_post', () => {
    render(<TwinSceneInstanced equipment={EQUIPMENT} />);
    const instances = screen.getAllByTestId('instances');
    // pernos + luminarias = 2 instance groups (no posts en este sample)
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  it('agrupa workers por status (1 Instances por status presente)', () => {
    render(<TwinSceneInstanced workers={WORKERS} />);
    // 3 statuses distintos → 3 Instances groups solo de workers
    const instances = screen.getAllByTestId('instances');
    expect(instances.length).toBeGreaterThanOrEqual(3);
  });

  it('cargo + cog visualization se renderiza', () => {
    const cargo: CargoItem[] = [
      { id: 'c1', position: [0, 1, 0], size: [1, 1, 1], massKg: 100 },
      { id: 'c2', position: [2, 1, 0], size: [1, 1, 1], massKg: 200 },
    ];
    render(<TwinSceneInstanced cargo={cargo} cargoCog={[1, 1, 0]} />);
    expect(screen.getByTestId('twin-scene')).toHaveAttribute('data-objects', '2');
  });

  it('heatField opcional no rompe', () => {
    render(
      <TwinSceneInstanced
        sensors={SENSORS}
        heatField={{ averageC: 28, hotspot: [5, 2, 0], severity: 0.6 }}
      />,
    );
    expect(screen.getByTestId('twin-scene')).toBeInTheDocument();
  });

  it('appearance dark cambia className', () => {
    render(<TwinSceneInstanced appearance="dark" />);
    const scene = screen.getByTestId('twin-scene');
    expect(scene.className).toMatch(/border-slate-700/);
  });
});
