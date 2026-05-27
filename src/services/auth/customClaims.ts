// Praeventio Guard — TODO.md §12.4.2: Custom claim `assignedSiteIds`.
//
// PLAN_PARTE3:127-145 — el RBAC scoping actual lee Firestore en cada
// request (`assertProjectMember` busca `projects/{id}.members[]`). Eso
// es O(1) Firestore lookup, pero cada request paga ~50ms de I/O +
// quota de reads. Pasar la lista de projects asignados como custom
// claim del JWT lo hace O(1) en memoria sin I/O.
//
// Migración lazy: `assertProjectMember` puede consultar primero el
// claim del decodedToken; si está presente y contiene el projectId,
// success sin tocar Firestore. Si no, fallback a Firestore (compat
// con tenants que aún no migran el claim).
//
// Política: solo admin/owner pueden setear assignedSiteIds en otros
// usuarios. El usuario nunca puede setear su propio claim
// (Firebase Admin SDK lo previene; este módulo no expone API
// cliente).

import type { DecodedIdToken } from 'firebase-admin/auth';

export const ASSIGNED_SITES_CLAIM = 'assignedSiteIds';

/**
 * Lee el claim assignedSiteIds del decoded token. Devuelve `null` si
 * el claim no existe (caller debe degradar a Firestore lookup).
 */
export function readAssignedSites(
  decodedToken: DecodedIdToken | Record<string, unknown>,
): string[] | null {
  const raw = (decodedToken as Record<string, unknown>)[ASSIGNED_SITES_CLAIM];
  if (!Array.isArray(raw)) return null;
  // Defensive: rechaza arrays con non-strings (firebase admin permite
  // setear casi cualquier valor; el caller pudo equivocarse).
  const cleaned = raw.filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return cleaned;
}

/**
 * Check sin I/O: el caller está asignado al projectId.
 */
export function hasAssignedSite(
  decodedToken: DecodedIdToken | Record<string, unknown>,
  projectId: string,
): boolean {
  const sites = readAssignedSites(decodedToken);
  if (sites === null) return false;
  return sites.includes(projectId);
}

/**
 * Decide si el claim cubre el caso autoritativamente. Útil para que
 * `assertProjectMember` haga short-circuit cuando el claim ya
 * responde sí/no sin necesidad de Firestore.
 *
 * Si retorna `{ resolved: true, member: bool }` → no consultar
 * Firestore. Si retorna `{ resolved: false }` → fallback Firestore.
 *
 * Reglas:
 *   - claim ausente → no resolved (compat con tenants pre-migración).
 *   - claim presente Y projectId en la lista → resolved + member: true.
 *   - claim presente PERO projectId NO en la lista → no resolved (puede
 *     que el claim esté desactualizado; consultamos Firestore para no
 *     bloquear false-negative).
 *
 * Esto es conservador: nunca bloquea con falso negativo del claim,
 * solo da fast-path cuando el resultado es positivo.
 */
export function resolveAssignedSitesCheck(
  decodedToken: DecodedIdToken | Record<string, unknown>,
  projectId: string,
): { resolved: true; member: true } | { resolved: false } {
  if (hasAssignedSite(decodedToken, projectId)) {
    return { resolved: true, member: true };
  }
  return { resolved: false };
}

/**
 * Construye el payload de claims para `admin.auth().setCustomUserClaims`.
 * `existingClaims` debe venir de `getUser(uid).customClaims` para
 * preservar otros claims (role, tier, etc.).
 *
 * Política: límite a 1000 site IDs (Firebase claim total size ≤1000
 * bytes; cada string ID ~24 chars → ~40 IDs max in practice). Esto es
 * defensa — si un tenant tiene >100 projects, el claim deja de servir
 * y necesita rediseño (group claims, índices Firestore).
 */
export const MAX_ASSIGNED_SITES = 100;

export interface BuildClaimsInput {
  existingClaims: Record<string, unknown> | undefined;
  newAssignedSites: string[];
}

export function buildClaimsWithAssignedSites(
  input: BuildClaimsInput,
): Record<string, unknown> {
  const base = input.existingClaims ?? {};
  if (input.newAssignedSites.length > MAX_ASSIGNED_SITES) {
    throw new Error(
      `assignedSiteIds excede el máximo de ${MAX_ASSIGNED_SITES} ` +
        `(recibido: ${input.newAssignedSites.length}). ` +
        'Considera Firestore-backed scoping para tenants con muchos proyectos.',
    );
  }
  // Defensivo: dedupe + sort para idempotencia (mismo input → mismo
  // claim payload → no invalida tokens innecesariamente).
  const unique = Array.from(new Set(input.newAssignedSites)).sort();
  return {
    ...base,
    [ASSIGNED_SITES_CLAIM]: unique,
  };
}
