// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.2.
//
// Hook complementario a `useFirestoreCollection` (que lee paths raw) — éste
// se enchufa a una instancia de `ProjectScopedStore<T>` (output del factory
// `createProjectScopedStore<T>`) y resuelve automáticamente el `projectId`
// desde `ProjectContext`. Cierra el pattern duplicado que vive en 15 pages
// del Sprint K + Digital Twin (~150 LOC × 15 = ~2200 LOC duplicados):
//
//   useEffect(() => {
//     if (!selectedProject?.id) return;
//     setLoading(true);
//     const unsub = subscribeFoo(selectedProject.id, setItems, setError);
//     setLoading(false);
//     return unsub;
//   }, [selectedProject?.id]);
//
// El hook expone:
//   - items     — última snapshot
//   - loading   — true mientras no llegue la primera snapshot
//   - error     — null si OK, Error si onSnapshot reportó fallo
//   - save      — wrapper sobre store.save(projectId, doc)
//   - patch     — wrapper sobre store.patch(projectId, id, partial)
//   - refetch   — list() read-once (útil después de mutations remotas)
//   - projectId — el id resuelto (o '' si no hay proyecto)
//
// Decisiones:
//   - El hook NO usa `pendingActions` (offline outbox) porque los 14 stores
//     Sprint K son live-only (Firestore listener directo). El pattern offline
//     sigue cubierto por `useFirestoreCollection` para colecciones legacy.
//   - `save` y `patch` lanzan si el caller intenta mutar sin proyecto
//     seleccionado — gate explícito para que la page muestre feedback.
//   - `options.activeOnly = true` switcha entre `subscribe` y
//     `subscribeFiltered` (este último requiere `activeFilter` en la
//     definición del store).
//   - `options.autoSubscribe = false` permite usar el hook solo para
//     save/patch (ej. forms que no listean nada).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import type { ProjectScopedStore } from '../services/firestore/createProjectScopedStore';

export interface UseProjectFirestoreCollectionOptions {
  /** Default true. Si false, el hook no llama subscribe (útil para forms). */
  autoSubscribe?: boolean;
  /** Default false. Si true, usa store.subscribeFiltered (where server-side). */
  activeOnly?: boolean;
  /** Override del default del store. Cap server-side a 500. */
  limit?: number;
  /** Override del projectId derivado de ProjectContext. Útil para tests. */
  projectIdOverride?: string;
}

export interface UseProjectFirestoreCollectionResult<T extends { id: string }> {
  items: T[];
  loading: boolean;
  error: Error | null;
  /** projectId resuelto. '' si no hay proyecto seleccionado. */
  projectId: string;
  save: (item: T) => Promise<void>;
  patch: (docId: string, partial: Partial<T>) => Promise<void>;
  /** Read-once. No reemplaza la subscription si está activa. */
  refetch: () => Promise<T[]>;
}

export function useProjectFirestoreCollection<T extends { id: string }>(
  store: ProjectScopedStore<T>,
  options: UseProjectFirestoreCollectionOptions = {},
): UseProjectFirestoreCollectionResult<T> {
  const { selectedProject } = useProject();
  const projectId =
    options.projectIdOverride ?? selectedProject?.id ?? '';
  const autoSubscribe = options.autoSubscribe ?? true;
  const activeOnly = options.activeOnly ?? false;
  const limit = options.limit;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(autoSubscribe && !!projectId);
  const [error, setError] = useState<Error | null>(null);

  // useRef del store + opciones para que el effect sea estable bajo
  // re-renders (el store es una instancia singleton por colección, pero
  // si el caller pasara una nueva instancia por error, el effect respondería).
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    // Sin proyecto → reset estado, sin subscription.
    if (!autoSubscribe || !projectId) {
      setItems([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const subscribe = activeOnly
      ? storeRef.current.subscribeFiltered
      : storeRef.current.subscribe;

    const unsubscribe = subscribe(
      projectId,
      (next) => {
        setItems(next);
        setLoading(false);
      },
      (err) => {
        setError(err);
        // El store ya emite [] a onSnap en error — no hacer setItems acá
        // para no duplicar el reset (race entre los dos callbacks).
        setLoading(false);
      },
      limit,
    );

    return () => {
      try {
        unsubscribe();
      } catch {
        /* unsub no debe romper unmount */
      }
    };
  }, [projectId, autoSubscribe, activeOnly, limit]);

  const save = useCallback(
    async (item: T) => {
      if (!projectId) {
        throw new Error('useProjectFirestoreCollection.save: sin proyecto seleccionado');
      }
      await storeRef.current.save(projectId, item);
    },
    [projectId],
  );

  const patch = useCallback(
    async (docId: string, partial: Partial<T>) => {
      if (!projectId) {
        throw new Error('useProjectFirestoreCollection.patch: sin proyecto seleccionado');
      }
      await storeRef.current.patch(projectId, docId, partial);
    },
    [projectId],
  );

  const refetch = useCallback(async () => {
    if (!projectId) return [];
    return storeRef.current.list(projectId, limit);
  }, [projectId, limit]);

  return useMemo(
    () => ({ items, loading, error, projectId, save, patch, refetch }),
    [items, loading, error, projectId, save, patch, refetch],
  );
}
