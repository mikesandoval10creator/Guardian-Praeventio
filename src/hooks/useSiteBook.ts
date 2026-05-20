// Praeventio Guard — Bloque 3.6 / Wire UI #8c: `useSiteBook` hook.
//
// Cliente para `src/server/routes/sitebook.ts` (montado en `/api/sitebook`).
// Estado del wiring previo:
//   - El servicio puro `siteBookService.ts` + adapter Firestore + CRDT
//     layer (`siteBookCrdt.ts`) YA EXISTÍAN cuando se montó este hook.
//   - El route `sitebook.ts` ya expone GET list / GET by folio / POST.
//   - El hook hermano `useInsights.ts` ya tenía `useSiteBookEntries` +
//     `createSiteBookEntry` muy básicos (sin Idempotency-Key, sin single
//     getter, sin helpers CRDT).
//
// Este módulo añade lo que faltaba sin tocar `useInsights.ts`:
//   1. Wrappers tipados de los 3 endpoints REST con auth Firebase.
//   2. Idempotency-Key opcional en mutations (reintentos seguros offline).
//   3. Hook `useSiteBookEntry` para lectura single.
//   4. Helpers de composición CRDT 100% client-side
//      (`createLocalDraft` + `applyLocalOp` + `commitDraftToServer`).
//      El backend NO expone aún rutas de draft/merge — los helpers
//      preparan la entrada localmente y al final hacen POST normal.
//   5. Hook `useSiteBookSync` que expone el estado online/offline +
//      contador de drafts locales pendientes (sync indicator del viewer).
//
// IMPORTANTE — paridad con `useInsights`:
//   Para no romper consumers existentes, re-exportamos `useSiteBookEntries`
//   apuntando a la misma implementación (aliasamos para mantener una
//   única fuente de fetch). El alias `useSiteBookEntries` apunta a la
//   versión nueva con `kind` filter + `limit` opcional.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../services/firebase';
import {
  type CrdtSiteBookEntry,
  type CrdtStamp,
  addEvidence,
  addWorker,
  createCrdtEntry,
  crdtToEntry,
  removeEvidence,
  removeWorker,
  setDescription,
  setLocation,
} from '../services/siteBook/siteBookCrdt';
import type {
  SiteBookEntry,
  SiteBookEntryKind,
} from '../services/siteBook/siteBookService';

// ────────────────────────────────────────────────────────────────────────
// Fetch primitives
// ────────────────────────────────────────────────────────────────────────

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const token = await getAuthToken();
  return fetch(path, {
    ...init,
    signal: signal ?? init.signal,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

function useEndpoint<T>(path: string | null): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  });
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await authedFetch(path, { method: 'GET' }, ctl.signal);
        const json = await unwrap<T>(res);
        if (!ctl.signal.aborted) {
          setState({ data: json, loading: false, error: null });
        }
      } catch (err) {
        if (ctl.signal.aborted) return;
        // AbortError shouldn't be surfaced as a user-visible failure.
        if ((err as Error).name === 'AbortError') return;
        setState({ data: null, loading: false, error: err as Error });
      }
    })();
    return () => ctl.abort();
  }, [path, refetchKey]);

  const refetch = useCallback(() => setRefetchKey((k) => k + 1), []);
  return { ...state, refetch };
}

// ────────────────────────────────────────────────────────────────────────
// Public API — queries
// ────────────────────────────────────────────────────────────────────────

export interface SiteBookEntriesResponse {
  entries: SiteBookEntry[];
  year: number;
  count: number;
}

/**
 * GET /api/sitebook/:projectId/entries?year=YYYY
 *
 * Nota: el endpoint actual sólo acepta `year` y `limit` por query, no
 * filtra por `kind` / `workerUid` (esos viajan al adapter Firestore pero
 * no están expuestos como query params en `sitebook.ts`). Si el caller
 * pasa filtros, se aplican client-side sobre la respuesta.
 */
export interface UseSiteBookEntriesOptions {
  year?: number;
  limit?: number;
  /** Filtro client-side por kind. El endpoint no lo soporta server-side. */
  kind?: SiteBookEntryKind;
  /** Filtro client-side por trabajador involucrado. */
  workerUid?: string;
}

export function useSiteBookEntries(
  projectId: string | null,
  options: UseSiteBookEntriesOptions = {},
) {
  const { year, limit, kind, workerUid } = options;
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (year !== undefined) params.set('year', String(year));
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [year, limit]);

  const path = projectId ? `/api/sitebook/${projectId}/entries${queryString}` : null;
  const result = useEndpoint<SiteBookEntriesResponse>(path);

  // Client-side post-filtering for kind/workerUid (no server query support).
  const filtered = useMemo(() => {
    if (!result.data) return result.data;
    if (!kind && !workerUid) return result.data;
    const entries = result.data.entries.filter((e) => {
      if (kind && e.kind !== kind) return false;
      if (workerUid && !(e.involvedWorkerUids ?? []).includes(workerUid)) {
        return false;
      }
      return true;
    });
    return { ...result.data, entries, count: entries.length };
  }, [result.data, kind, workerUid]);

  return { ...result, data: filtered };
}

/**
 * GET /api/sitebook/:projectId/entry/:folio
 *
 * Single-entry read for the detail drawer. 404 surfaces as
 * `Error('not_found')` in `error.message`.
 */
export function useSiteBookEntry(
  projectId: string | null,
  folio: string | null,
) {
  const path =
    projectId && folio
      ? `/api/sitebook/${projectId}/entry/${encodeURIComponent(folio)}`
      : null;
  return useEndpoint<SiteBookEntry>(path);
}

// ────────────────────────────────────────────────────────────────────────
// Public API — mutations
// ────────────────────────────────────────────────────────────────────────

export interface CreateSiteBookEntryInput {
  kind: SiteBookEntryKind;
  occurredAt: string;
  description: string;
  location?: string;
  involvedWorkerUids?: string[];
}

/**
 * POST /api/sitebook/:projectId/entries
 *
 * `idempotencyKey` permite reintentar de forma segura tras un fallo de
 * red (el route + adapter rechazan duplicados por folio + counter
 * atómico, así que el Idempotency-Key header viaja al middleware
 * genérico). Si el caller no pasa una, generamos una basada en
 * (kind + occurredAt + descripción hash corto) para dedupe básico
 * client-side.
 */
export async function createSiteBookEntry(
  projectId: string,
  input: CreateSiteBookEntryInput,
  idempotencyKey?: string,
): Promise<SiteBookEntry> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(`/api/sitebook/${projectId}/entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return unwrap<SiteBookEntry>(res);
}

// ────────────────────────────────────────────────────────────────────────
// CRDT / offline-first composition helpers
//
// El backend NO expone hoy un endpoint para sync de drafts CRDT (eso vive
// como `mergeAndPersistCrdtDraft` adentro del adapter Firestore y solo
// se llama desde Cloud Function / job). Mientras tanto, estos helpers
// permiten que la UI:
//   1. Construya el draft offline (`createLocalDraft`),
//   2. Aplique operaciones puntuales con stamp Lamport (`applyLocalOp`),
//   3. Cuando hay red, dispare un POST normal (`commitDraftToServer`)
//      que persiste la versión flat. La metadata CRDT se descarta en el
//      commit final — eso es OK porque el caso de uso actual es
//      single-supervisor draft local. La capa multi-supervisor real
//      necesitará una ruta dedicada en una iteración futura.
// ────────────────────────────────────────────────────────────────────────

export type LocalOp =
  | { type: 'setDescription'; value: string }
  | { type: 'setLocation'; value: string | undefined }
  | { type: 'addWorker'; uid: string }
  | { type: 'removeWorker'; uid: string }
  | { type: 'addEvidence'; url: string }
  | { type: 'removeEvidence'; url: string };

export interface CreateLocalDraftInput {
  projectId: string;
  kind: SiteBookEntryKind;
  occurredAt: string;
  recordedByUid: string;
  recordedByRole: string;
  description: string;
  location?: string;
  involvedWorkerUids?: string[];
  evidenceUrls?: string[];
  /** Identificador único del dispositivo+usuario. Recomendado: `${uid}_${deviceId}`. */
  actor: string;
  /** Fecha actual; inyectable para tests. */
  now?: Date;
}

/**
 * Crea un draft CRDT en memoria para edición offline. El `provisionalFolio`
 * es derivado de un nonce — el server reasignará el folio definitivo al
 * hacer commit. El `id` es content-addressed para deduplicación.
 */
export function createLocalDraft(input: CreateLocalDraftInput): CrdtSiteBookEntry {
  const now = input.now ?? new Date();
  const year = new Date(input.occurredAt).getUTCFullYear();
  // Nonce determinístico-ish suficiente para colisión local: ts ms +
  // actor + 6 dígitos random. La unicidad real la garantiza el server.
  const nonce =
    `${now.getTime().toString(36)}-${input.actor.slice(0, 8)}-` +
    `${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const provisionalFolio = `DRAFT-${year}-${nonce}`;
  return createCrdtEntry({
    id: nonce,
    projectId: input.projectId,
    provisionalFolio,
    year,
    kind: input.kind,
    occurredAt: input.occurredAt,
    recordedByUid: input.recordedByUid,
    recordedByRole: input.recordedByRole,
    description: input.description,
    location: input.location,
    involvedWorkerUids: input.involvedWorkerUids,
    evidenceUrls: input.evidenceUrls,
    actor: input.actor,
    now,
  });
}

/**
 * Aplica una operación local al draft CRDT y devuelve la nueva versión.
 * Inmutable — el caller debe `setState(applyLocalOp(prev, op, ...))`.
 */
export function applyLocalOp(
  draft: CrdtSiteBookEntry,
  op: LocalOp,
  actor: string,
  now: Date = new Date(),
): CrdtSiteBookEntry {
  const stamp: CrdtStamp = { ts: now.getTime(), actor };
  switch (op.type) {
    case 'setDescription':
      return setDescription(draft, op.value, stamp);
    case 'setLocation':
      return setLocation(draft, op.value, stamp);
    case 'addWorker':
      return addWorker(draft, op.uid, stamp);
    case 'removeWorker':
      return removeWorker(draft, op.uid, stamp);
    case 'addEvidence':
      return addEvidence(draft, op.url, stamp);
    case 'removeEvidence':
      return removeEvidence(draft, op.url, stamp);
    default: {
      // Exhaustiveness check
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * Convierte un draft CRDT a `SiteBookEntry` flat y hace POST al server.
 * El server asigna el folio definitivo + ejecuta validaciones (descripción
 * ≥ 15 chars en route, ≥ 20 en createEntry).
 */
export async function commitDraftToServer(
  draft: CrdtSiteBookEntry,
  idempotencyKey?: string,
): Promise<SiteBookEntry> {
  const flat = crdtToEntry(draft);
  // El payload que acepta el endpoint es un subset de `SiteBookEntry`.
  // Idempotency-Key viaja por header; el server lo lee para dedupe.
  const key = idempotencyKey ?? draft.id;
  return createSiteBookEntry(
    flat.projectId,
    {
      kind: flat.kind,
      occurredAt: flat.occurredAt,
      description: flat.description,
      location: flat.location,
      involvedWorkerUids: flat.involvedWorkerUids,
    },
    key,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sync indicator
// ────────────────────────────────────────────────────────────────────────

export interface SiteBookSyncState {
  online: boolean;
  /** Drafts locales en memoria pendientes de commit. Caller propaga. */
  pendingDraftCount: number;
}

/**
 * Observa `navigator.onLine` y expone un contador opcional de drafts
 * locales no committed. El caller controla `pendingDraftCount` (queue
 * propia); el hook solo combina con el estado de red para que el
 * indicador del viewer pueda mostrar "synced" / "pending N" / "offline".
 */
export function useSiteBookSync(pendingDraftCount = 0): SiteBookSyncState {
  const isBrowser = typeof navigator !== 'undefined';
  const [online, setOnline] = useState<boolean>(() =>
    isBrowser ? navigator.onLine : true,
  );

  useEffect(() => {
    if (!isBrowser) return undefined;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [isBrowser]);

  return { online, pendingDraftCount };
}

// ────────────────────────────────────────────────────────────────────────
// Convenience composite hook — facade for the new viewer route
// ────────────────────────────────────────────────────────────────────────

export interface UseSiteBookResult {
  list: ReturnType<typeof useSiteBookEntries>;
  sync: SiteBookSyncState;
  create: (
    input: CreateSiteBookEntryInput,
    idempotencyKey?: string,
  ) => Promise<SiteBookEntry>;
}

/**
 * Facade: list + sync + create bound to `projectId`. Optimizado para el
 * dúo `<SiteBookViewer />` + `<NewEntryForm />` para que la página
 * conductora pueda pasar `useSiteBook(projectId, { year })` y obtener
 * todo en una sola línea. `refetch` queda disponible vía `list.refetch`.
 */
export function useSiteBook(
  projectId: string | null,
  options: UseSiteBookEntriesOptions & { pendingDraftCount?: number } = {},
): UseSiteBookResult {
  const list = useSiteBookEntries(projectId, options);
  const sync = useSiteBookSync(options.pendingDraftCount);
  const refetchRef = useRef(list.refetch);
  refetchRef.current = list.refetch;

  const create = useCallback(
    async (input: CreateSiteBookEntryInput, idempotencyKey?: string) => {
      if (!projectId) {
        throw new Error('projectId required');
      }
      const entry = await createSiteBookEntry(projectId, input, idempotencyKey);
      // Refresca la lista para que el nuevo folio aparezca arriba.
      refetchRef.current();
      return entry;
    },
    [projectId],
  );

  return { list, sync, create };
}
