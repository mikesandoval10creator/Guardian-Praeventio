// SPDX-License-Identifier: MIT
//
// Sprint 21 Ola 3 — Bucket J — placedObjectsStore.
//
// Firestore-bound CRUD for `PlacedObject`s — extintores, AEDs, hidrantes,
// señalética virtuales colocados en el Digital Twin de la faena.
//
// Storage path:
//   projects/{projectId}/placed_objects/{placedObjectId}
//
// Diseño:
//   - Kept separate from `objectLifecycleOrchestrator.ts` (que es PURO) para
//     que los specs sigan siendo testables sin pulling firebase/firestore.
//   - subscribePlacedObjects devuelve unsubscribe — cumple el contrato
//     React useEffect.
//   - savePlacedObject usa `setDoc` con id determinista (`obj.id`) para que
//     la creación local + sync remoto quede idempotente (mismo doc).
//   - updatePlacedObject siempre toca `updatedAt: Date.now()` para que
//     ordering por updatedAt en queries sea estable.

import {
  db,
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
} from '../firebase';
import type { PlacedObject } from './photogrammetry/types';

/** Resuelve el path Firestore para un proyecto. */
function placedObjectsCollectionPath(projectId: string): string {
  return `projects/${projectId}/placed_objects`;
}

/**
 * Persiste un `PlacedObject` en Firestore bajo
 * `projects/{projectId}/placed_objects/{obj.id}`.
 *
 * Usa `setDoc` con id determinista (`obj.id`) para idempotencia: llamar
 * varias veces con el mismo `obj` produce el mismo doc, sin duplicados.
 * Con `merge: true` para preservar campos extras agregados por otros
 * servicios (ej. `zettelkastenNodeId` escrito por la lifecycle pipeline).
 */
export async function savePlacedObject(
  obj: PlacedObject,
  projectId: string,
): Promise<void> {
  if (!projectId) throw new Error('savePlacedObject: projectId vacío');
  if (!obj?.id) throw new Error('savePlacedObject: obj.id vacío');
  const ref = doc(db, placedObjectsCollectionPath(projectId), obj.id);
  await setDoc(ref, { ...obj, updatedAt: Date.now() }, { merge: true });
}

/**
 * Live subscription a la colección `placed_objects` de un proyecto.
 * Devuelve la función `unsubscribe` — el caller (típicamente un useEffect)
 * la invoca al desmontar.
 *
 * Si ocurre un error en la suscripción (permisos, offline-no-cache), el
 * callback recibe un array vacío en vez de propagar — el banner de error
 * ya lo cubre el `ProjectContext` a nivel de aplicación.
 */
export function subscribePlacedObjects(
  projectId: string,
  onSnap: (objects: PlacedObject[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!projectId) {
    // Sin proyecto activo → sin objetos. Devuelve un noop unsubscribe para
    // que los useEffect cleanup no exploten.
    onSnap([]);
    return () => {};
  }
  const ref = collection(db, placedObjectsCollectionPath(projectId));
  return onSnapshot(
    ref,
    (snap) => {
      const objects: PlacedObject[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as PlacedObject;
          objects.push({ ...data, id: d.id });
        } catch {
          // skip docs malformados sin tumbar todo el snapshot
        }
      });
      onSnap(objects);
    },
    (err) => {
      onError?.(err as Error);
      onSnap([]);
    },
  );
}

/**
 * Borrar un placed object. Idempotente — si el doc no existe, Firestore
 * resuelve sin error.
 */
export async function deletePlacedObject(
  id: string,
  projectId: string,
): Promise<void> {
  if (!projectId) throw new Error('deletePlacedObject: projectId vacío');
  if (!id) throw new Error('deletePlacedObject: id vacío');
  const ref = doc(db, placedObjectsCollectionPath(projectId), id);
  await deleteDoc(ref);
}

/**
 * Patch parcial de un placed object — solo escribe los campos del patch
 * + `updatedAt`. Usar para cambios de lifecycle, position, notes, etc.
 *
 * NOTA: el caller debe pasar `Partial<PlacedObject>` con solo los campos
 * que mutaron — Firestore `updateDoc` rechaza objetos `undefined` en
 * top-level, así que aquí hacemos un strip defensivo.
 */
export async function updatePlacedObject(
  id: string,
  patch: Partial<PlacedObject>,
  projectId: string,
): Promise<void> {
  if (!projectId) throw new Error('updatePlacedObject: projectId vacío');
  if (!id) throw new Error('updatePlacedObject: id vacío');
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  cleaned.updatedAt = Date.now();
  const ref = doc(db, placedObjectsCollectionPath(projectId), id);
  // Same Firestore web SDK cast pattern as OfflineSyncManager.tsx — our
  // `cleaned` Record is structurally compatible with `UpdateData` at runtime.
  await updateDoc(ref, cleaned as { [k: string]: any });
}
