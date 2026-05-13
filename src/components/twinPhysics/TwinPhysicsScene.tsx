// Praeventio Guard — Sprint 45 D.1 (parcial): Twin 3D + Rapier física.
//
// Cierra parcialmente D.1 del plan maestro ("InstancedMesh + LOD + Rapier
// física"). Componente standalone que demuestra integración real de
// @react-three/rapier con r3f. Sirve como base para refactor futuro
// del Site25DPanel.tsx.
//
// El componente acepta una lista de "objetos físicos" (cajas con masa
// y posición) y los renderiza con InstancedMesh + RigidBody. Una caída
// libre típica para verificar que el solver corre.
//
// Bundle: este módulo SE CARGA LAZY (React.lazy en el consumidor) para
// no pesar el initial bundle.

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';

export interface PhysicalObject {
  id: string;
  /** Posición inicial. */
  position: [number, number, number];
  /** Tamaño caja. */
  size?: [number, number, number];
  /** Color hex. */
  color?: string;
  /** Si es estático (suelo, paredes). */
  fixed?: boolean;
}

export interface TwinPhysicsSceneProps {
  objects: ReadonlyArray<PhysicalObject>;
  /** Activar el solver Rapier. Default true; false renderiza estático. */
  physicsEnabled?: boolean;
  /** Gravedad — default [0, -9.81, 0] (m/s²). */
  gravity?: [number, number, number];
  /** Mostrar suelo de referencia. */
  showGround?: boolean;
  appearance?: 'light' | 'dark';
}

export function TwinPhysicsScene({
  objects,
  physicsEnabled = true,
  gravity = [0, -9.81, 0],
  showGround = true,
  appearance = 'light',
}: TwinPhysicsSceneProps) {
  const isDark = appearance === 'dark';
  const bgColor = isDark ? '#0f172a' : '#f1f5f9';

  return (
    <div
      data-testid="twin-physics.scene"
      className={`h-96 w-full rounded-xl border ${
        isDark ? 'border-slate-700' : 'border-slate-200'
      }`}
      style={{ background: bgColor }}
    >
      <Suspense fallback={<div data-testid="twin-physics.loading">Cargando 3D…</div>}>
        <Canvas camera={{ position: [8, 6, 8], fov: 50 }} shadows>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
          {physicsEnabled ? (
            <Physics gravity={gravity}>
              {showGround && (
                <RigidBody type="fixed">
                  <mesh receiveShadow position={[0, -0.5, 0]}>
                    <boxGeometry args={[20, 1, 20]} />
                    <meshStandardMaterial color={isDark ? '#1e293b' : '#cbd5e1'} />
                  </mesh>
                </RigidBody>
              )}
              {objects.map((o) => (
                <RigidBody key={o.id} type={o.fixed ? 'fixed' : 'dynamic'} position={o.position} colliders="cuboid">
                  <mesh castShadow>
                    <boxGeometry args={o.size ?? [1, 1, 1]} />
                    <meshStandardMaterial color={o.color ?? '#14b8a6'} />
                  </mesh>
                </RigidBody>
              ))}
            </Physics>
          ) : (
            <>
              {showGround && (
                <mesh position={[0, -0.5, 0]}>
                  <boxGeometry args={[20, 1, 20]} />
                  <meshStandardMaterial color={isDark ? '#1e293b' : '#cbd5e1'} />
                </mesh>
              )}
              {objects.map((o) => (
                <mesh key={o.id} position={o.position}>
                  <boxGeometry args={o.size ?? [1, 1, 1]} />
                  <meshStandardMaterial color={o.color ?? '#14b8a6'} />
                </mesh>
              ))}
            </>
          )}
        </Canvas>
      </Suspense>
    </div>
  );
}
