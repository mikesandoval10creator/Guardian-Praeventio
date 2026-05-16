// Praeventio Guard — Scratch storage para cálculos de ingeniería.
//
// Regla #3 (usuario 2026-05-15): si algo no existe, lo PRODUCIMOS.
// Antes los cálculos Bernoulli (uplift de andamios, dispersión hazmat,
// etc.) solo se persistían si había un proyecto seleccionado, y si no
// se dropeaban silenciosamente con un `logger.info`. Ahora SIEMPRE se
// persisten — en Firestore si hay proyecto, en IndexedDB scratch si no.
// Cuando el usuario selecciona/crea un proyecto, los cálculos scratch se
// "promueven" automáticamente al proyecto.
//
// Storage: IndexedDB via `idb-keyval` (ya dep). Una key namespaced por
// usuario (sub Firebase Auth) si está logged-in, o por sessionId
// efímera si no.

import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';
import type { RiskNodePayload } from '../zettelkasten/types';

const SCRATCH_PREFIX = 'praeventio:scratch-calc:';

export interface ScratchCalculation {
  /** Hash determinístico del payload — sirve como id idempotente. */
  id: string;
  /** Payload del nodo Bernoulli/ingeniería. */
  node: RiskNodePayload;
  /** Cuándo se calculó. */
  createdAt: string;
  /** Si el user estaba logged-in, su uid (para namespacing). */
  userUid: string | null;
  /** Si ya fue promovido a un proyecto, su id. */
  promotedToProjectId?: string;
  /** Cuándo fue promovido. */
  promotedAt?: string;
}

function scratchKey(userUid: string | null, calcId: string): string {
  return `${SCRATCH_PREFIX}${userUid ?? 'anonymous'}:${calcId}`;
}

/**
 * Persiste un cálculo en IndexedDB scratch. Determinístico — si el
 * mismo payload se calcula dos veces, sobreescribe la entrada existente
 * (no duplica).
 */
export async function saveScratchCalculation(
  node: RiskNodePayload,
  userUid: string | null,
): Promise<ScratchCalculation> {
  // ID determinístico desde el payload (hash sobre JSON con keys ordenadas
  // recursivamente — JSON.stringify's replacer-as-array filtra, no ordena).
  const canonical = canonicalJsonStringify(node);
  const id = await deterministicId(canonical);

  const entry: ScratchCalculation = {
    id,
    node,
    createdAt: new Date().toISOString(),
    userUid,
  };
  await idbSet(scratchKey(userUid, id), entry);
  return entry;
}

/**
 * Lista todos los cálculos scratch del usuario.
 */
export async function listScratchCalculations(
  userUid: string | null,
): Promise<ScratchCalculation[]> {
  const allKeys = await idbKeys();
  const prefix = `${SCRATCH_PREFIX}${userUid ?? 'anonymous'}:`;
  const myKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(prefix),
  );
  const entries: ScratchCalculation[] = [];
  for (const k of myKeys) {
    const v = await idbGet<ScratchCalculation>(k);
    if (v && !v.promotedToProjectId) entries.push(v);
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * "Promueve" un cálculo scratch a un proyecto Firestore. Marca la entrada
 * scratch como `promoted` para no re-promoverla, y devuelve el payload
 * listo para que el caller llame a `writeNodesDebounced([payload], {projectId})`.
 */
export async function promoteScratchToProject(
  calcId: string,
  userUid: string | null,
  projectId: string,
): Promise<RiskNodePayload | null> {
  const k = scratchKey(userUid, calcId);
  const entry = await idbGet<ScratchCalculation>(k);
  if (!entry) return null;
  // Marcar como promoted (no borrar — preservamos historial scratch para
  // que el user vea qué se promovió y cuándo)
  await idbSet(k, {
    ...entry,
    promotedToProjectId: projectId,
    promotedAt: new Date().toISOString(),
  });
  return entry.node;
}

/**
 * Promueve TODOS los cálculos scratch pendientes al proyecto dado.
 * Útil cuando el user finalmente selecciona/crea un proyecto.
 *
 * Devuelve los payloads listos para que el caller los pase a Firestore.
 */
export async function promoteAllScratchToProject(
  userUid: string | null,
  projectId: string,
): Promise<RiskNodePayload[]> {
  const pending = await listScratchCalculations(userUid);
  const promoted: RiskNodePayload[] = [];
  for (const entry of pending) {
    const node = await promoteScratchToProject(entry.id, userUid, projectId);
    if (node) promoted.push(node);
  }
  return promoted;
}

/**
 * Borra un cálculo scratch (user explícitamente lo descartó).
 */
export async function deleteScratchCalculation(
  calcId: string,
  userUid: string | null,
): Promise<void> {
  await idbDel(scratchKey(userUid, calcId));
}

// ─── Helpers internos ──────────────────────────────────────────────────

/**
 * Serializa un objeto a JSON con claves ordenadas alfabéticamente
 * RECURSIVAMENTE. Esto sí produce un canonical JSON real (a diferencia
 * de pasar `Object.keys(o).sort()` como replacer, que solo filtra keys).
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]))
      .join(',') +
    '}'
  );
}

/**
 * Hash determinístico SHA-256 sobre string canónico, truncado a 16 hex.
 * Usa Web Crypto API (disponible en browsers modernos). Determinístico
 * cross-platform — mismos inputs siempre producen el mismo id.
 */
async function deterministicId(canonical: string): Promise<string> {
  const enc = new TextEncoder().encode(canonical);
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const arr = new Uint8Array(buf);
    return Array.from(arr.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback determinístico simple (no se usa en browsers modernos —
  // solo si crypto.subtle no está disponible, p.ej. tests jsdom legacy)
  let h = 0;
  for (let i = 0; i < canonical.length; i++) {
    h = ((h << 5) - h + canonical.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(16, '0');
}
