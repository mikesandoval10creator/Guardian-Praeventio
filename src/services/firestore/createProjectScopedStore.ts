// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.1.
//
// Factory genérica que centraliza el pattern repetido por 14 stores
// client-side creados en las sesiones del 22-23 mayo (Sprint K wire UI
// restante + Digital Twin on-device). Cada store individual implementa
// save / patch / subscribe / list contra `projects/{projectId}/<col>/<id>`
// con ~70 LOC casi idénticos.
//
// Diseño:
//   - Genérico sobre T (el shape del doc); T DEBE tener `id: string`
//     para que `save` use `setDoc` idempotente.
//   - `options.orderByField` y `options.defaultLimit` son configurables.
//   - `options.activeFilter` (NUEVA) permite a stores con concepto de
//     "active vs ended" exponer un `subscribeActive()` con `where()`
//     server-side — cierra el gap identificado por el audit 2026-05-23
//     (filtros server-side ausentes en los 14 stores nuevos).
//   - El path `projects/{projectId}/<collection>` mantiene consistencia
//     con `placedObjectsStore.ts` (el store original, Sprint 21 Ola 3
//     Bucket J) que ya estaba en main como referencia.
//
// Importa el SDK Firestore agnóstico desde `../firebase` para que tests
// vitest puedan mockear (`vi.mock('../firebase')`) sin tocar el SDK real.

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from '../firebase';

export interface ProjectScopedStoreOptions<T> {
  /** Default count para subscribe + list. Cap server-side a Math.min(N, 500). */
  defaultLimit?: number;
  /** Campo por el cual ordenar (descendente por default). */
  orderByField?: keyof T & string;
  /** Dirección de orden. Default 'desc'. */
  orderDirection?: 'asc' | 'desc';
  /**
   * Filtro server-side para el variant `subscribeFiltered`. Ejemplo típico:
   *   { field: 'status', op: '==', value: 'active' }
   *   { field: 'status', op: 'in', value: ['active', 'pending_resumption'] }
   *
   * `in` / `not-in` / `array-contains-any` aceptan arrays (max 30 valores
   * server-side per Firestore docs). Permite reducir reads a escala (ver
   * §B.5 del plan 2026-05-23).
   */
  activeFilter?: {
    field: keyof T & string;
    op:
      | '=='
      | '!='
      | '>'
      | '>='
      | '<'
      | '<='
      | 'in'
      | 'not-in'
      | 'array-contains'
      | 'array-contains-any';
    value: unknown;
  };
}

/**
 * Retornado por `createProjectScopedStore`. Cada método acepta `projectId`
 * como primer arg para que la misma factory sirva para varios proyectos
 * concurrentes (multi-project session).
 */
export interface ProjectScopedStore<T extends { id: string }> {
  /** Persiste doc con id determinista (setDoc + merge). Idempotente. */
  save: (projectId: string, doc: T) => Promise<void>;
  /** Actualiza campos puntuales. Toca `updatedAt: Date.now()` automáticamente. */
  patch: (
    projectId: string,
    docId: string,
    patch: Partial<T>,
  ) => Promise<void>;
  /**
   * Live subscription ordenada por `options.orderByField`. Devuelve
   * función `unsubscribe` que el caller debe invocar en cleanup.
   * Errores se reportan via `onError` Y emiten array vacío a `onSnap`
   * para que el caller no quede en estado loading infinito.
   */
  subscribe: (
    projectId: string,
    onSnap: (items: T[]) => void,
    onError?: (err: Error) => void,
    limitCount?: number,
  ) => () => void;
  /**
   * Variant filtrado server-side. Solo disponible si `options.activeFilter`
   * está definido. Si no está, este método lanza al ser invocado (gate
   * documentado).
   */
  subscribeFiltered: (
    projectId: string,
    onSnap: (items: T[]) => void,
    onError?: (err: Error) => void,
    limitCount?: number,
  ) => () => void;
  /** Read-once. Equivalente a `subscribe` pero sin live updates. */
  list: (projectId: string, limitCount?: number) => Promise<T[]>;
}

/**
 * Factory que crea un store project-scoped consistente con el patrón
 * `projects/{projectId}/<collectionName>/{doc.id}`.
 *
 * @example
 * // Antes (70 LOC por store):
 * export async function saveStoppage(projectId, stoppage) { ... }
 * export async function patchStoppage(projectId, id, patch) { ... }
 * export function subscribeStoppages(projectId, onSnap, onError, limit) { ... }
 *
 * // Después:
 * const stoppageStore = createProjectScopedStore<Stoppage>('stoppages', {
 *   orderByField: 'declaredAt',
 *   activeFilter: { field: 'status', op: '==', value: 'active' },
 * });
 * export const { save: saveStoppage, patch: patchStoppage,
 *                subscribe: subscribeStoppages,
 *                subscribeFiltered: subscribeActiveStoppages,
 *                list: listStoppages } = stoppageStore;
 */
export function createProjectScopedStore<T extends { id: string }>(
  collectionName: string,
  options: ProjectScopedStoreOptions<T> = {},
): ProjectScopedStore<T> {
  if (!collectionName || typeof collectionName !== 'string') {
    throw new Error('createProjectScopedStore: collectionName debe ser string no-vacío');
  }
  const {
    defaultLimit = 100,
    orderByField,
    orderDirection = 'desc',
    activeFilter,
  } = options;

  const collectionPath = (projectId: string): string => {
    if (!projectId) throw new Error(`${collectionName}: projectId vacío`);
    return `projects/${projectId}/${collectionName}`;
  };

  const clampLimit = (n?: number): number => {
    const requested = typeof n === 'number' && n > 0 ? n : defaultLimit;
    return Math.max(1, Math.min(requested, 500));
  };

  const buildQuery = (
    projectId: string,
    limitCount?: number,
    withActiveFilter = false,
  ) => {
    const col = collection(db, collectionPath(projectId));
    const parts: unknown[] = [];
    if (withActiveFilter && activeFilter) {
      parts.push(where(activeFilter.field, activeFilter.op, activeFilter.value));
    }
    if (orderByField) {
      parts.push(orderBy(orderByField, orderDirection));
    }
    parts.push(limit(clampLimit(limitCount)));
    // `query` acepta variadic args; spread sin cast porque el caller no
    // controla los tipos exactos del SDK (compatibilidad con vi.mock).
    return (query as (...a: unknown[]) => unknown)(col, ...parts);
  };

  const collectSnap = (snap: { forEach: (cb: (d: { id: string; data: () => T }) => void) => void }): T[] => {
    const out: T[] = [];
    snap.forEach((d) => {
      try {
        const data = d.data();
        out.push({ ...data, id: d.id });
      } catch {
        /* skip malformed docs — no propagar para no tumbar todo el snapshot */
      }
    });
    return out;
  };

  return {
    async save(projectId, item) {
      if (!item?.id) {
        throw new Error(`${collectionName}.save: doc.id vacío`);
      }
      const ref = doc(db, collectionPath(projectId), item.id);
      // merge:true preserva campos escritos por otros servicios
      // (ej. fields agregados por triggers Cloud Functions).
      await setDoc(ref, { ...item, updatedAt: Date.now() }, { merge: true });
    },

    async patch(projectId, docId, patch) {
      if (!docId) {
        throw new Error(`${collectionName}.patch: docId vacío`);
      }
      const ref = doc(db, collectionPath(projectId), docId);
      // updateDoc tiene 4 overloads en el SDK modular; el más permisivo
      // espera `{ [x: string]: FieldValue | Partial<unknown> | undefined }`
      // y `unknown` no es asignable a `FieldValue | Partial<unknown>`. Casting
      // la función misma — mismo pattern que onSnapshot abajo — es la única
      // manera de cruzar el bound sin requerir SetOptions custom. El cuerpo
      // runtime es idéntico (Firestore SDK acepta cualquier objeto plano).
      await (updateDoc as (ref: unknown, data: unknown) => Promise<void>)(
        ref,
        { ...patch, updatedAt: Date.now() },
      );
    },

    subscribe(projectId, onSnap, onError, limitCount) {
      if (!projectId) {
        onSnap([]);
        return () => {};
      }
      const q = buildQuery(projectId, limitCount, false);
      // onSnapshot acepta query | reference; el SDK no exporta un tipo
      // que cubra ambos cleanly. Cast intencional.
      return (onSnapshot as (q: unknown, next: (s: unknown) => void, err?: (e: unknown) => void) => () => void)(
        q,
        (snap) => onSnap(collectSnap(snap as Parameters<typeof collectSnap>[0])),
        (err) => {
          onError?.(err as Error);
          onSnap([]); // No dejar al caller en loading infinito.
        },
      );
    },

    subscribeFiltered(projectId, onSnap, onError, limitCount) {
      if (!activeFilter) {
        throw new Error(
          `${collectionName}.subscribeFiltered: options.activeFilter no configurado en createProjectScopedStore`,
        );
      }
      if (!projectId) {
        onSnap([]);
        return () => {};
      }
      const q = buildQuery(projectId, limitCount, true);
      return (onSnapshot as (q: unknown, next: (s: unknown) => void, err?: (e: unknown) => void) => () => void)(
        q,
        (snap) => onSnap(collectSnap(snap as Parameters<typeof collectSnap>[0])),
        (err) => {
          onError?.(err as Error);
          onSnap([]);
        },
      );
    },

    async list(projectId, limitCount) {
      if (!projectId) return [];
      const q = buildQuery(projectId, limitCount, false);
      const snap = await (getDocs as (q: unknown) => Promise<Parameters<typeof collectSnap>[0]>)(q);
      return collectSnap(snap);
    },
  };
}
