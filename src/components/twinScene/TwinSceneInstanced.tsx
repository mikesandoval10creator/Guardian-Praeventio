// Praeventio Guard — Sprint 46 D.1 cierre: Twin Scene con InstancedMesh + LOD.
//
// Cierra D.1 del plan maestro ("InstancedMesh + LOD + Rapier física"). El
// Site25DPanel existente usa Google Maps 2.5D — esto es un componente
// COMPLEMENTARIO r3f para renderizar el sub-escenario indoor / faena
// detallado con miles de objetos (pernos, luminarias, sensores, palas,
// camiones) sin bajar de 60fps en mobile.
//
// Reusa @react-three/rapier (instalado Sprint 45) para física opcional
// + r3f-drei Detailed para LOD. NO requiere assets externos — usa
// boxGeometry/cylinderGeometry primitivas para que el bundle no engorde.
//
// Inputs canónicos:
//   - workers: array de WorkerMarker (posición + estado + color)
//   - equipment: array de EquipmentInstance (kind + posición + escala)
//   - sensors: array de SensorMarker (kind + posición + reading)
//   - heatField: opcional, lectura HVAC 1R1C para overlay volumétrico
//   - cargo: opcional, lista de paquetes con masa para visualizar COG
//
// Componente presentacional puro — padre calcula los inputs.

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';
import { Detailed, Instances, Instance, OrbitControls } from '@react-three/drei';
import type { Vector3Tuple } from 'three';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type WorkerStatus = 'safe' | 'warning' | 'sos' | 'idle';

export interface WorkerMarker {
  id: string;
  position: Vector3Tuple;
  status: WorkerStatus;
  label?: string;
}

export type EquipmentKind = 'pala' | 'camion' | 'luminaria' | 'perno' | 'sensor_post';

export interface EquipmentInstance {
  id: string;
  kind: EquipmentKind;
  position: Vector3Tuple;
  /** Escala uniforme (1 = default). */
  scale?: number;
  /** Si está fijo en suelo (luminaria, perno, post) → no participa en física. */
  fixed?: boolean;
}

export type SensorKind = 'co' | 'temp' | 'noise' | 'dust' | 'methane';

export interface SensorMarker {
  id: string;
  kind: SensorKind;
  position: Vector3Tuple;
  /** Lectura actual. */
  reading: number;
  /** Si la lectura excede el umbral de alerta. */
  alert?: boolean;
}

export interface HeatField {
  /** Temperatura promedio C°. */
  averageC: number;
  /** Hotspot point (where the warmest reading is). */
  hotspot?: Vector3Tuple;
  /** Severidad 0..1 (0=normal, 1=crítico). */
  severity: number;
}

export interface CargoItem {
  id: string;
  position: Vector3Tuple;
  size: Vector3Tuple;
  /** Masa kg — el centro-de-gravedad se calcula afuera. */
  massKg: number;
}

export interface TwinSceneInstancedProps {
  workers?: ReadonlyArray<WorkerMarker>;
  equipment?: ReadonlyArray<EquipmentInstance>;
  sensors?: ReadonlyArray<SensorMarker>;
  heatField?: HeatField | null;
  cargo?: ReadonlyArray<CargoItem>;
  /** Si se renderiza la COG del cargo calculada externamente. */
  cargoCog?: Vector3Tuple | null;
  /** Camera position default. */
  cameraPosition?: Vector3Tuple;
  /** Activar Rapier physics layer. */
  physicsEnabled?: boolean;
  /** Tono visual. */
  appearance?: 'light' | 'dark';
}

// ────────────────────────────────────────────────────────────────────────
// Color tokens
// ────────────────────────────────────────────────────────────────────────

const WORKER_COLOR: Record<WorkerStatus, string> = {
  safe: '#0d9488', // teal-600 (Directiva 1 — Guardian Praeventio tono)
  warning: '#fbbf24', // amber-400
  sos: '#ef4444', // rose-500
  idle: '#94a3b8', // slate-400
};

const EQUIPMENT_COLOR: Record<EquipmentKind, string> = {
  pala: '#fbbf24',
  camion: '#f97316',
  luminaria: '#fde047',
  perno: '#475569',
  sensor_post: '#0ea5e9',
};

const SENSOR_COLOR: Record<SensorKind, string> = {
  co: '#dc2626',
  temp: '#f97316',
  noise: '#a855f7',
  dust: '#78716c',
  methane: '#facc15',
};

// ────────────────────────────────────────────────────────────────────────
// Sub-component: Workers — InstancedMesh per status (one draw call per status)
// ────────────────────────────────────────────────────────────────────────

interface WorkersByStatusProps {
  workers: ReadonlyArray<WorkerMarker>;
}

function WorkersByStatus({ workers }: WorkersByStatusProps) {
  const grouped = useMemo(() => {
    const map = new Map<WorkerStatus, WorkerMarker[]>();
    for (const w of workers) {
      if (!map.has(w.status)) map.set(w.status, []);
      map.get(w.status)!.push(w);
    }
    return map;
  }, [workers]);

  return (
    <>
      {Array.from(grouped.entries()).map(([status, list]) => (
        <Instances key={status} limit={Math.max(list.length, 1)} castShadow>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color={WORKER_COLOR[status]} />
          {list.map((w) => (
            <Instance key={w.id} position={w.position} />
          ))}
        </Instances>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-component: Equipment — LOD para palas/camiones, instanced para
// perno/luminaria/sensor_post (objetos repetidos miles de veces)
// ────────────────────────────────────────────────────────────────────────

interface EquipmentRendererProps {
  equipment: ReadonlyArray<EquipmentInstance>;
}

function EquipmentRenderer({ equipment }: EquipmentRendererProps) {
  // Separar por kind para usar la técnica óptima por categoría
  const palas = useMemo(() => equipment.filter((e) => e.kind === 'pala'), [equipment]);
  const camiones = useMemo(() => equipment.filter((e) => e.kind === 'camion'), [equipment]);
  const pernos = useMemo(() => equipment.filter((e) => e.kind === 'perno'), [equipment]);
  const luminarias = useMemo(() => equipment.filter((e) => e.kind === 'luminaria'), [equipment]);
  const posts = useMemo(() => equipment.filter((e) => e.kind === 'sensor_post'), [equipment]);

  return (
    <>
      {/* Palas + camiones: LOD (más detallado cerca, simple lejos) */}
      {palas.map((p) => (
        <Detailed key={p.id} distances={[0, 20, 60]} position={p.position}>
          {/* Near: caja + brazo extendido */}
          <group scale={p.scale ?? 1}>
            <mesh castShadow>
              <boxGeometry args={[2, 1.5, 3]} />
              <meshStandardMaterial color={EQUIPMENT_COLOR.pala} />
            </mesh>
            <mesh position={[0, 1.5, 1]} castShadow>
              <boxGeometry args={[0.4, 0.4, 3]} />
              <meshStandardMaterial color={EQUIPMENT_COLOR.pala} />
            </mesh>
          </group>
          {/* Medium: solo caja */}
          <mesh scale={p.scale ?? 1} castShadow>
            <boxGeometry args={[2, 1.5, 3]} />
            <meshStandardMaterial color={EQUIPMENT_COLOR.pala} />
          </mesh>
          {/* Far: low-poly */}
          <mesh scale={(p.scale ?? 1) * 0.9}>
            <boxGeometry args={[2, 1.5, 3]} />
            <meshBasicMaterial color={EQUIPMENT_COLOR.pala} />
          </mesh>
        </Detailed>
      ))}

      {camiones.map((c) => (
        <Detailed key={c.id} distances={[0, 30, 80]} position={c.position}>
          <group scale={c.scale ?? 1}>
            <mesh castShadow>
              <boxGeometry args={[3, 1.8, 6]} />
              <meshStandardMaterial color={EQUIPMENT_COLOR.camion} />
            </mesh>
            <mesh position={[0, -1, 2]} castShadow>
              <cylinderGeometry args={[0.7, 0.7, 0.4, 16]} />
              <meshStandardMaterial color="#1f2937" />
            </mesh>
          </group>
          <mesh scale={c.scale ?? 1}>
            <boxGeometry args={[3, 1.8, 6]} />
            <meshStandardMaterial color={EQUIPMENT_COLOR.camion} />
          </mesh>
          <mesh scale={(c.scale ?? 1) * 0.9}>
            <boxGeometry args={[3, 1.8, 6]} />
            <meshBasicMaterial color={EQUIPMENT_COLOR.camion} />
          </mesh>
        </Detailed>
      ))}

      {/* Pernos, luminarias, posts: instanced — pueden ser miles */}
      {pernos.length > 0 && (
        <Instances limit={pernos.length} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.3, 8]} />
          <meshStandardMaterial color={EQUIPMENT_COLOR.perno} />
          {pernos.map((p) => (
            <Instance key={p.id} position={p.position} scale={p.scale ?? 1} />
          ))}
        </Instances>
      )}
      {luminarias.length > 0 && (
        <Instances limit={luminarias.length}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshStandardMaterial color={EQUIPMENT_COLOR.luminaria} emissive={EQUIPMENT_COLOR.luminaria} emissiveIntensity={0.5} />
          {luminarias.map((l) => (
            <Instance key={l.id} position={l.position} scale={l.scale ?? 1} />
          ))}
        </Instances>
      )}
      {posts.length > 0 && (
        <Instances limit={posts.length} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 2, 8]} />
          <meshStandardMaterial color={EQUIPMENT_COLOR.sensor_post} />
          {posts.map((p) => (
            <Instance key={p.id} position={p.position} scale={p.scale ?? 1} />
          ))}
        </Instances>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-component: Sensors — color por kind, alert ring si está alertado
// ────────────────────────────────────────────────────────────────────────

function SensorMarkers({ sensors }: { sensors: ReadonlyArray<SensorMarker> }) {
  return (
    <>
      {sensors.map((s) => (
        <group key={s.id} position={s.position}>
          <mesh>
            <octahedronGeometry args={[0.4, 0]} />
            <meshStandardMaterial
              color={SENSOR_COLOR[s.kind]}
              emissive={s.alert ? '#ef4444' : '#000000'}
              emissiveIntensity={s.alert ? 0.6 : 0}
            />
          </mesh>
          {s.alert && (
            // Ring de alerta — torus pulsante (no animado en este componente,
            // padre puede envolver en useFrame si quiere pulso)
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.7, 0.05, 8, 24]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-component: Heat field overlay (volumetric warning blob)
// ────────────────────────────────────────────────────────────────────────

function HeatFieldOverlay({ field }: { field: HeatField }) {
  if (!field.hotspot || field.severity < 0.1) return null;
  const radius = 3 + field.severity * 5;
  const color = field.severity > 0.7 ? '#ef4444' : field.severity > 0.4 ? '#f97316' : '#fbbf24';
  return (
    <mesh position={field.hotspot}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.15} />
    </mesh>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-component: Cargo + COG visualization
// ────────────────────────────────────────────────────────────────────────

function CargoVisualization({
  cargo,
  cog,
}: {
  cargo: ReadonlyArray<CargoItem>;
  cog: Vector3Tuple | null;
}) {
  return (
    <>
      {cargo.map((c) => (
        <mesh key={c.id} position={c.position}>
          <boxGeometry args={c.size} />
          <meshStandardMaterial color="#0ea5e9" transparent opacity={0.7} />
        </mesh>
      ))}
      {cog && (
        <group position={cog}>
          {/* COG marker — cross shape */}
          <mesh>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.5} />
          </mesh>
          {/* Vertical drop line indicating where the COG hits the ground */}
          <mesh position={[0, -cog[1] / 2, 0]}>
            <cylinderGeometry args={[0.02, 0.02, Math.max(0.01, cog[1]), 6]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
        </group>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────

export function TwinSceneInstanced({
  workers = [],
  equipment = [],
  sensors = [],
  heatField = null,
  cargo = [],
  cargoCog = null,
  cameraPosition = [12, 10, 12],
  physicsEnabled = false,
  appearance = 'light',
}: TwinSceneInstancedProps) {
  const isDark = appearance === 'dark';
  const bgColor = isDark ? '#0f172a' : '#f1f5f9';
  const groundColor = isDark ? '#1e293b' : '#cbd5e1';

  const totalObjects = workers.length + equipment.length + sensors.length + cargo.length;

  const scene = (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 25, 10]} intensity={1} castShadow />
      {/* Ground */}
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[60, 1, 60]} />
        <meshStandardMaterial color={groundColor} />
      </mesh>
      <WorkersByStatus workers={workers} />
      <EquipmentRenderer equipment={equipment} />
      <SensorMarkers sensors={sensors} />
      {heatField && <HeatFieldOverlay field={heatField} />}
      <CargoVisualization cargo={cargo} cog={cargoCog} />
    </>
  );

  return (
    <section
      data-testid="twin-scene"
      data-objects={totalObjects}
      className={`relative h-[480px] w-full overflow-hidden rounded-2xl border ${
        isDark ? 'border-slate-700' : 'border-slate-200'
      }`}
      style={{ background: bgColor }}
    >
      <Suspense fallback={<div data-testid="twin-scene.loading">Cargando escena 3D…</div>}>
        <Canvas camera={{ position: cameraPosition, fov: 50 }} shadows>
          {physicsEnabled ? (
            <Physics gravity={[0, -9.81, 0]}>
              {/* Wrap workers + equipment dynamic en RigidBody si physics ON */}
              {workers.map((w) => (
                <RigidBody key={w.id} type="dynamic" position={w.position} colliders="ball">
                  <mesh castShadow>
                    <sphereGeometry args={[0.3, 16, 16]} />
                    <meshStandardMaterial color={WORKER_COLOR[w.status]} />
                  </mesh>
                </RigidBody>
              ))}
              {/* Ground */}
              <RigidBody type="fixed">
                <mesh position={[0, -0.5, 0]} receiveShadow>
                  <boxGeometry args={[60, 1, 60]} />
                  <meshStandardMaterial color={groundColor} />
                </mesh>
              </RigidBody>
              <ambientLight intensity={0.5} />
              <directionalLight position={[20, 25, 10]} intensity={1} castShadow />
            </Physics>
          ) : (
            scene
          )}
          <OrbitControls />
        </Canvas>
      </Suspense>
      <div
        data-testid="twin-scene.hud"
        className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white"
      >
        {totalObjects} objetos · {workers.length} trabajadores
      </div>
    </section>
  );
}
