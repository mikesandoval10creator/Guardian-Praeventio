// SPDX-License-Identifier: MIT
//
// useProjectArAnchors — hook React reactivo para anclas AR del
// proyecto activo. Wrap onSnapshot en el path Firestore correcto.
//
// 2026-05-16 (Sprint F — AR Real). El hook respeta la directiva del
// usuario "información es privada por proyecto" usando el mismo
// scoping `tenants/{tid}/projects/{pid}/ar_anchors` que el adapter.

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';
import type { AnchorKind, ArAnchor } from '../services/ar/arAnchorService';

export interface UseProjectArAnchorsOptions {
  /** Tenant del usuario (de auth claims). */
  tenantId: string | null;
  /** Proyecto activo. */
  projectId: string | null;
  /** Opcional: filtra por kind en server-side (más eficiente). */
  kind?: AnchorKind;
}

export interface UseProjectArAnchorsResult {
  anchors: ArAnchor[];
  loading: boolean;
  error: Error | null;
}

/**
 * Suscribe en tiempo real a los anchors AR de un proyecto. Devuelve
 * lista vacía mientras carga o si tenant/project no están listos.
 *
 * Si Firestore tira un error de permisos (rules deniegan), `error`
 * se setea y `anchors` queda vacío — la UI debe mostrar mensaje
 * apropiado en lugar de fingir éxito.
 */
export function useProjectArAnchors(
  opts: UseProjectArAnchorsOptions,
): UseProjectArAnchorsResult {
  const [anchors, setAnchors] = useState<ArAnchor[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!opts.tenantId || !opts.projectId) {
      setAnchors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const path = `tenants/${opts.tenantId}/projects/${opts.projectId}/ar_anchors`;
    const colRef = collection(db, path);
    const q = opts.kind ? query(colRef, where('kind', '==', opts.kind)) : query(colRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ArAnchor[] = snapshot.docs.map((d) => d.data() as ArAnchor);
        setAnchors(list);
        setLoading(false);
      },
      (err) => {
        logger.error('useProjectArAnchors onSnapshot failed', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [opts.tenantId, opts.projectId, opts.kind]);

  return { anchors, loading, error };
}
