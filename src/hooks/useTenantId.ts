// SPDX-License-Identifier: MIT
//
// useTenantId — hook React que extrae el tenantId del Firebase Auth
// custom claim. NO está disponible como propiedad directa de `user`;
// hay que llamar `user.getIdTokenResult()` para verlo.
//
// Fix Codex 2026-05-16 — PR #277 review: ARMachineryScene/Warehouse
// usaban `(user as { tenantId?: string }).tenantId` que siempre da
// null, haciendo que el subscribe a Firestore nunca ocurra y la
// creación de anchors falle silenciosamente.

import { useEffect, useState } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';

export interface UseTenantIdResult {
  /** Tenant del usuario (null si no logueado o no tiene claim). */
  tenantId: string | null;
  /** True hasta que la primera lectura del token termina. */
  loading: boolean;
}

/**
 * Lee el custom claim `tenantId` del ID token del usuario actual.
 *
 * El hook re-lee el token cuando cambia el `user`, pero NO forza
 * refresh — usa el cache del token (vencimiento ~1h). Si el operador
 * tiene un nuevo claim que aún no se propagó, el caller puede llamar
 * `user.getIdToken(true)` manualmente para forzar refresh.
 */
export function useTenantId(): UseTenantIdResult {
  const { user } = useFirebase();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));

  useEffect(() => {
    if (!user) {
      setTenantId(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) return;
        const claim = result?.claims?.tenantId;
        setTenantId(typeof claim === 'string' && claim.length > 0 ? claim : null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTenantId(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { tenantId, loading };
}
