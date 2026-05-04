// SPDX-License-Identifier: MIT
//
// PlacedObjectsLayer — R3F layer that renders virtual safety-control objects
// (extinguishers, AEDs, signage, etc.) on top of the photogrammetry mesh.
//
// Receives a list of `PlacedObject`s and renders each one as a colored
// placeholder mesh + drei `<Html>` floating label. Clicks emit `onSelect`.
// Drag (alt+drag for now — TransformControls/DragControls planned for Ola 3)
// emits `onMove`. Lifecycle drives visual state (opacity / pulse / gray).

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type {
  PlacedObject,
  PlacedObjectKind,
  PlacedObjectLifecycle,
} from '../../services/digitalTwin/photogrammetry/types';

export const HUMAN_KIND_LABEL: Record<PlacedObjectKind, string> = {
  extinguisher_pqs: 'Extintor PQS',
  extinguisher_co2: 'Extintor CO2',
  extinguisher_water: 'Extintor de agua',
  hydrant: 'Hidrante',
  sign_evacuation: 'Señal evacuación',
  sign_warning: 'Señal advertencia',
  sign_mandatory: 'Señal obligatoria',
  sign_prohibition: 'Señal prohibición',
  aed: 'Desfibrilador (AED)',
  first_aid_kit: 'Botiquín',
  emergency_shower: 'Ducha emergencia',
  eye_wash_station: 'Lavaojos',
  gas_detector: 'Detector de gas',
  spill_kit: 'Kit anti-derrames',
  safety_shower: 'Ducha de seguridad',
  assembly_point: 'Punto de encuentro',
  evacuation_route: 'Vía evacuación',
};

const KIND_COLOR: Record<PlacedObjectKind, string> = {
  extinguisher_pqs: '#dc2626', // rojo
  extinguisher_co2: '#1f1f1f', // negro
  extinguisher_water: '#2563eb', // azul
  hydrant: '#f59e0b', // amarillo
  sign_evacuation: '#10b981', // verde
  sign_warning: '#f59e0b',
  sign_mandatory: '#2563eb',
  sign_prohibition: '#dc2626',
  aed: '#16a34a', // verde
  first_aid_kit: '#ef4444',
  emergency_shower: '#06b6d4',
  eye_wash_station: '#22d3ee',
  gas_detector: '#a855f7',
  spill_kit: '#eab308',
  safety_shower: '#0ea5e9',
  assembly_point: '#22c55e',
  evacuation_route: '#65a30d',
};

function lifecycleOpacity(lc: PlacedObjectLifecycle): number {
  if (lc === 'planning') return 0.45;
  if (lc === 'pending_install') return 0.65;
  if (lc === 'retired') return 0.25;
  return 1.0;
}

function lifecycleEmissive(lc: PlacedObjectLifecycle): number {
  if (lc === 'maintenance_due') return 0.6;
  if (lc === 'active' || lc === 'installed') return 0.15;
  return 0;
}

interface ObjectMarkerProps {
  object: PlacedObject;
  selected: boolean;
  onSelect: (object: PlacedObject) => void;
  onMove?: (object: PlacedObject, newPosition: { x: number; y: number; z: number }) => void;
}

function ObjectMarker({ object, selected, onSelect, onMove }: ObjectMarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const baseColor = KIND_COLOR[object.kind] ?? '#94a3b8';
  const opacity = lifecycleOpacity(object.lifecycle);
  const emissive = lifecycleEmissive(object.lifecycle);
  const isPulse = object.lifecycle === 'maintenance_due';
  const isRetired = object.lifecycle === 'retired';

  // Pulse animation for maintenance_due
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (isPulse) {
      const s = 1 + 0.15 * Math.sin(clock.elapsedTime * 3);
      meshRef.current.scale.setScalar(s * (object.scale ?? 1));
    } else {
      meshRef.current.scale.setScalar(object.scale ?? 1);
    }
  });

  const finalColor = isRetired ? '#71717a' : baseColor;

  return (
    <group
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={
        object.rotation
          ? [object.rotation.x, object.rotation.y, object.rotation.z]
          : [0, 0, 0]
      }
    >
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(object);
        }}
        onPointerDown={(e) => {
          // Alt + drag relocates — minimal placeholder; full DragControls in next ola.
          if (e.altKey && onMove) {
            e.stopPropagation();
            const newPos = {
              x: object.position.x + 0.5,
              y: object.position.y,
              z: object.position.z,
            };
            onMove(object, newPos);
          }
        }}
      >
        <cylinderGeometry args={[0.25, 0.3, 0.8, 12]} />
        <meshStandardMaterial
          color={finalColor}
          emissive={finalColor}
          emissiveIntensity={emissive}
          transparent
          opacity={opacity}
        />
      </mesh>

      {selected && (
        <mesh>
          <torusGeometry args={[0.5, 0.04, 8, 24]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      )}

      <Html
        center
        distanceFactor={10}
        position={[0, 0.7, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            border: selected ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {HUMAN_KIND_LABEL[object.kind] ?? object.kind}
        </div>
      </Html>
    </group>
  );
}

export interface PlacedObjectsLayerProps {
  objects: PlacedObject[];
  selectedId?: string | null;
  onSelect: (object: PlacedObject) => void;
  onMove?: (object: PlacedObject, newPosition: { x: number; y: number; z: number }) => void;
  /**
   * Sprint 21 Ola 3 Bucket J.5 — opt-in AR bridge.
   *
   * Cuando se define, los consumidores externos (PanelCard de
   * DigitalTwinFaena) usan esta callback para abrir `ARObjectOverlay`.
   * Se threadea aquí para que el layer pueda exponer un botón "Ver en
   * AR" en futuras iteraciones (Ola 4) sin cambiar el contrato. Por
   * ahora la layer no renderiza el botón — el caller lo hace fuera
   * del Canvas R3F (los `<Html>` de drei no admiten event-handler-only
   * events sin pointerEvents auto).
   */
  onRequestAr?: (object: PlacedObject) => void;
}

export function PlacedObjectsLayer({
  objects,
  selectedId,
  onSelect,
  onMove,
  onRequestAr: _onRequestAr,
}: PlacedObjectsLayerProps) {
  // _onRequestAr quedará consumido en Ola 4 (WebXR session). Por ahora
  // mantenemos la prop en la signature para que DigitalTwinFaena pueda
  // pasarla sin TS errors y los tests de tipo del Bucket J pasen.
  return (
    <group>
      {objects.map((obj) => (
        <ObjectMarker
          key={obj.id}
          object={obj}
          selected={obj.id === selectedId}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </group>
  );
}
