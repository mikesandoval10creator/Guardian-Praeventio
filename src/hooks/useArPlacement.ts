// SPDX-License-Identifier: MIT
//
// useArPlacement — Sprint 21 Ola 4 Bucket N.
//
// Bridge entre la sesión AR (WebXR immersive-ar o ARKit Quick Look) y el
// lifecycle de PlacedObject. Cuando el usuario, dentro del overlay AR,
// confirma una nueva posición para un objeto `installed`, este hook:
//
//   1. Compara delta vs. la posición original. Si delta < 10 cm: no-op
//      (precisión típica AR es 5-10 cm; evita commit por jitter).
//   2. Persiste el patch parcial en Firestore via `updatePlacedObject`.
//   3. Si hay `geoAnchor`, recalcula `geo` (lat/lng/altitudeM) usando
//      `useGeoAnchor.meshToGeo` para mantener el doc consistente.
//   4. Dispara la transición de lifecycle (mismo lifecycle, distinta
//      posición) → emite un nuevo ZK node de tipo "position-changed".
//      La rama `positionChanged` ya está cubierta por el orchestrator
//      (ver `objectLifecycleOrchestrator.ts`). Calendar events NO se
//      duplican: ese branch solo dispara cuando lifecycle entra a
//      `installed`, y aquí lifecycle no cambia.
//
// La hook se mantiene desacoplada del modo de sesión (WebXR vs Quick
// Look); el caller decide cuándo llamar `startSession` y dispone del
// flujo concreto de sampling AR. Lo que aquí importa es el resultado:
// una posición confirmada y el commit downstream.

import { useCallback, useState } from 'react';
import {
  updatePlacedObject as defaultUpdatePlacedObject,
} from '../services/digitalTwin/placedObjectsStore';
import { useGeoAnchor, type GeoAnchor } from './useGeoAnchor';
import { useObjectLifecycle, type UseObjectLifecycleCallback } from './useObjectLifecycle';
import type { PlacedObject } from '../services/digitalTwin/photogrammetry/types';
import { logger } from '../utils/logger';

/** Threshold mínimo, en metros, para considerar el reposicionamiento real. */
export const AR_PLACEMENT_MIN_DELTA_M = 0.10;

export type ArPlacementStatus =
  | 'idle'
  | 'starting'
  | 'placing'
  | 'confirming'
  | 'done'
  | 'error';

export interface ArPlacementOptions {
  object: PlacedObject;
  projectId: string;
  geoAnchor?: GeoAnchor | null;
}

export interface ArPlacementApi {
  /** Marca la sesión AR como iniciada — placeholder, el caller arma la sesión real. */
  startSession(): Promise<void>;
  /**
   * Confirma una nueva posición desde AR. Si delta < 10 cm es no-op.
   * Si delta significativa: persiste position (+ geo si hay anchor) y
   * dispara la transición lifecycle → ZK node "position-changed".
   */
  confirmPlacement(newMeshPosition: { x: number; y: number; z: number }): Promise<void>;
  status: ArPlacementStatus;
  error: string | null;
}

/**
 * Deps inyectables — útil para tests sin React/Firebase. El hook usa los
 * defaults; los tests pueden invocar `runArPlacementConfirm` directamente.
 */
export interface ArPlacementDeps {
  updatePlacedObject: (
    id: string,
    patch: Partial<PlacedObject>,
    projectId: string,
  ) => Promise<void>;
  runLifecycle: UseObjectLifecycleCallback;
  /** Conversor mesh→geo. Si retorna null, no hay anchor configurado. */
  meshToGeo: (m: { x: number; y: number; z: number }) =>
    | { lat: number; lng: number; altitudeM?: number }
    | null;
}

/**
 * Versión pura del confirm — los tests llaman directamente con mocks.
 */
export async function runArPlacementConfirm(
  object: PlacedObject,
  newMeshPosition: { x: number; y: number; z: number },
  projectId: string,
  deps: ArPlacementDeps,
): Promise<{ committed: boolean; reason?: string }> {
  // (1) Delta check — usa norma euclídea en metros.
  const dx = newMeshPosition.x - object.position.x;
  const dy = newMeshPosition.y - object.position.y;
  const dz = newMeshPosition.z - object.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance < AR_PLACEMENT_MIN_DELTA_M) {
    return { committed: false, reason: 'delta-below-threshold' };
  }

  // (2) Compute geo si el anchor está disponible.
  const newGeo = deps.meshToGeo(newMeshPosition);

  // (3) Patch parcial — solo position (y geo si aplica).
  const patch: Partial<PlacedObject> = {
    position: newMeshPosition,
    updatedAt: Date.now(),
  };
  if (newGeo) {
    patch.geo = newGeo;
  }

  await deps.updatePlacedObject(object.id, patch, projectId);

  // (4) Dispara la transición lifecycle. `previous` lleva la posición
  // original; `next` la nueva. El orchestrator detecta `positionChanged`
  // y emite el ZK node sin duplicar calendar events (ese branch solo
  // dispara cuando lifecycle cambia a 'installed').
  const previous: PlacedObject = { ...object };
  const next: PlacedObject = {
    ...object,
    position: newMeshPosition,
    geo: newGeo ?? object.geo,
    updatedAt: patch.updatedAt!,
  };
  await deps.runLifecycle(previous, next);

  return { committed: true };
}

/**
 * React hook — wrapper sobre `runArPlacementConfirm` con state para la
 * UI (status + error). El caller (ARObjectOverlay / WebXR session) decide
 * cuándo llamar `startSession` (que solo marca el state como 'placing')
 * y `confirmPlacement` (que dispara el commit completo).
 */
export function useArPlacement(opts: ArPlacementOptions): ArPlacementApi {
  const { object, projectId, geoAnchor } = opts;
  const [status, setStatus] = useState<ArPlacementStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { meshToGeo } = useGeoAnchor(geoAnchor ?? null);
  const runLifecycle = useObjectLifecycle(projectId);

  const startSession = useCallback(async () => {
    setError(null);
    setStatus('starting');
    // El caller (overlay AR) arma la sesión real — aquí solo marcamos
    // que el flujo está activo. Cuando el caller obtiene un sampling
    // estable del usuario, transiciona a 'placing'.
    setStatus('placing');
  }, []);

  const confirmPlacement = useCallback(
    async (newMeshPosition: { x: number; y: number; z: number }) => {
      setError(null);
      setStatus('confirming');
      try {
        const result = await runArPlacementConfirm(
          object,
          newMeshPosition,
          projectId,
          {
            updatePlacedObject: defaultUpdatePlacedObject,
            runLifecycle,
            meshToGeo: (m) => meshToGeo(m),
          },
        );
        if (!result.committed) {
          // Delta sub-umbral → volver a idle, sin error.
          setStatus('idle');
          return;
        }
        setStatus('done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('ar_placement_confirm_failed', { err: msg });
        setError(msg);
        setStatus('error');
      }
    },
    [object, projectId, runLifecycle, meshToGeo],
  );

  return { startSession, confirmPlacement, status, error };
}
