// Sprint 29 Bucket AA F-B — NL query panel.
//
// Textarea + botón "Buscar" → POST /api/zettelkasten/nl-query.
// Renderiza la lista de resultados con cita al incident_id.
//
// Alpha41 ZK-8 — segundo modo "Grafo (exacto)": consultas estructuradas
// cypher-lite sobre las aristas tipadas, sin LLM, para auditoría preventiva
// precisa → POST /api/zettelkasten/structured-query.
//   Ej: (:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical
//
// m31 (auditoría de deuda paralela) — aislamiento de contexto:
//   · results/citations/matches/error son estado LOCAL y se invalidan cuando
//     cambia el proyecto o la identidad/sesión (A → B → A, A → null → B,
//     logout/login). El guard es un `epoch` monotónico: volver al mismo
//     proyecto NO revive los resultados antiguos (el epoch sigue creciendo).
//   · Cada petición captura (epoch, id) y comprueba liveness DESPUÉS de cada
//     await relevante (credenciales, fetch, cuerpo). Un transporte que
//     ignore `abort` tampoco puede aplicar un success/error/finally viejo.
//   · El `finally` viejo nunca apaga el spinner de una petición más nueva:
//     el estado de carga va marcado por `reqId`, no por un booleano global.
//   · Modo estructurado: Enter respeta el mismo `disabled` que el botón
//     (no abre concurrencia sin control).
//   · Identidad: la API real es `useFirebase()` (src/contexts/FirebaseContext.tsx)
//     → `user` / `isAuthReady`. NO existe `AuthContext` ni `sessionVersion`:
//     la identidad observable es `user?.uid` + la transición presente/ausente.
//     Sin identidad válida no se muestran datos privados ni se consulta.
//
// NOTAS DE ALCANCE: no se tocan rutas, ACLs ni backend. El aislamiento real
// de servidor vive en `verifyAuth` + `assertProjectMember`
// (src/server/routes/zettelkasten.ts) y NO se certifica aquí con mocks.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Search, Loader2, FileWarning, BookOpen, Network, ArrowRight } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { logger } from '../../utils/logger';
import { apiAuthHeader } from '../../lib/apiAuth';
import { humanErrorMessage } from '../../lib/humanError';


interface IncidentSearchHit {
  incidentId: string;
  projectId: string;
  summary: string;
  occurredAt?: string;
}

interface NlQueryResponse {
  results: IncidentSearchHit[];
  citations: string[];
}

/** m31 — corte de espera de una consulta (ms). */
const QUERY_TIMEOUT_MS = 20_000;

interface QueryTransport {
  /** Señal de aborto de la petición en curso. */
  signal: AbortSignal;
  /**
   * Liveness: `false` cuando la respuesta llegó tarde (cambió el proyecto o
   * la identidad, o hay una petición más nueva). Se evalúa tras cada await.
   */
  isLive: () => boolean;
}

async function postNlQuery(
  payload: {
    query: string;
    projectId: string;
    topK: number;
  },
  transport: QueryTransport,
): Promise<NlQueryResponse | null> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  // Liveness tras el await de credenciales.
  if (!transport.isLive()) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch('/api/zettelkasten/nl-query', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: transport.signal,
  });
  // Liveness tras el await del fetch.
  if (!transport.isLive()) return null;
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    // Liveness tras el await del cuerpo de error.
    if (!transport.isLive()) return null;
    throw new Error(errBody?.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as NlQueryResponse;
  // Liveness tras el await del cuerpo de éxito.
  if (!transport.isLive()) return null;
  return body;
}

// ── ZK-8: modo estructurado (grafo, sin LLM) ────────────────────────────

interface StructuredNodeHit {
  id: string;
  type: string;
  title: string | null;
  severity: string | null;
}

interface StructuredMatch {
  from: StructuredNodeHit;
  to: StructuredNodeHit;
  via: string;
  direction: 'outgoing' | 'incoming';
  edgeType: string;
}

interface StructuredQueryResponse {
  pattern: string;
  count: number;
  matches: StructuredMatch[];
}

const PATTERN_EXAMPLES = [
  "(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical",
  "(:Riesgo)-[:causes]->(:Incidente)",
  "(:Normativa)-[:regulates]-()",
];

async function postStructuredQuery(
  payload: {
    pattern: string;
    projectId: string;
  },
  transport: QueryTransport,
): Promise<StructuredQueryResponse | null> {
  const authHeader = await apiAuthHeader();
  // Liveness tras el await de credenciales.
  if (!transport.isLive()) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch('/api/zettelkasten/structured-query', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: transport.signal,
  });
  // Liveness tras el await del fetch.
  if (!transport.isLive()) return null;
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    if (!transport.isLive()) return null;
    if (errBody?.error === 'invalid_pattern') {
      throw new Error(
        'Patrón inválido. Formato: (:Tipo)-[:arista]->(:Tipo) WHERE campo=valor',
      );
    }
    throw new Error(errBody?.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as StructuredQueryResponse;
  if (!transport.isLive()) return null;
  return body;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/30',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/30',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30',
  low: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  info: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
};

const NodeChip: React.FC<{ node: StructuredNodeHit }> = ({ node }) => (
  <span className="inline-flex items-center gap-1.5 min-w-0">
    <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
      {node.type}
    </span>
    <span className="text-sm text-slate-800 dark:text-slate-100 truncate">
      {node.title ?? node.id}
    </span>
    {node.severity && (
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
          SEVERITY_BADGE[node.severity] ?? SEVERITY_BADGE.info
        }`}
      >
        {node.severity}
      </span>
    )}
  </span>
);

// ── m31 — estado con epoch de contexto ───────────────────────────────────

interface PanelState {
  /** Token de contexto vigente (proyecto + identidad). Cambia ⇒ epoch++ */
  token: string;
  /** Epoch monotónico de contexto. Nunca baja ⇒ volver a A no revive A. */
  epoch: number;
  /** Id de la petición que puede escribir en el estado. */
  reqId: number;
  loading: boolean;
  results: IncidentSearchHit[];
  citations: string[];
  matches: StructuredMatch[];
  structuredSearched: boolean;
  error: string | null;
}

/** Petición en curso: identidad de la request para guards de liveness. */
interface ActiveRequest {
  id: number;
  epoch: number;
  controller: AbortController;
  /** La petición fue invalidada (contexto cambió o hay una más nueva). */
  invalidated: boolean;
  timedOut: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
}

function invalidateRequest(request: ActiveRequest) {
  request.invalidated = true;
  if (request.timeoutId !== undefined) clearTimeout(request.timeoutId);
  request.controller.abort();
}

const EMPTY_PANEL = (token: string, epoch: number): PanelState => ({
  token,
  epoch,
  reqId: 0,
  loading: false,
  results: [],
  citations: [],
  matches: [],
  structuredSearched: false,
  error: null,
});

export const NlQueryPanel: React.FC = () => {
  const { selectedProject } = useProject();
  // API REAL de identidad: `useFirebase()` (no existe `AuthContext`).
  const { user, isAuthReady } = useFirebase();
  const [mode, setMode] = useState<'semantic' | 'structured'>('semantic');
  const [query, setQuery] = useState('');
  const [topK] = useState(5);
  const [pattern, setPattern] = useState('');

  const projectId = selectedProject?.id ?? null;
  const identityUid = user?.uid ?? '';
  const identityPresent = Boolean(user);
  // An absent readiness flag is unknown, not an authenticated-ready grant.
  const identityReady = identityPresent && isAuthReady === true;
  // Firebase can keep isAuthReady=true while changing accounts. ProjectContext
  // keeps the old selectedProject until the new user's project snapshot arrives.
  const [confirmedIdentityUid, setConfirmedIdentityUid] = useState(identityUid);
  const projectAtConfirmedIdentityRef = useRef(selectedProject);
  const projectContextReady = confirmedIdentityUid === identityUid || !selectedProject;
  const canQuery = identityReady && projectContextReady;

  /**
   * Token de contexto: proyecto + identidad + estado de la sesión.
   * Cualquier cambio ⇒ nuevo epoch ⇒ se invalidan results/citations/matches/
   * error del contexto anterior.
   */
  const contextToken = `${projectId ?? ''}|${identityUid}|${identityPresent ? '1' : '0'}|${isAuthReady ? '1' : '0'}`;

  const [state, setState] = useState<PanelState>(() => EMPTY_PANEL(contextToken, 0));
  // Ajuste de estado durante el render (patrón oficial de React): cuando el
  // token de contexto cambia, se abre un epoch nuevo y se vacía el panel.
  if (state.token !== contextToken) {
    setState(EMPTY_PANEL(contextToken, state.epoch + 1));
  }

  const mountedRef = useRef(true);
  const activeReqRef = useRef<ActiveRequest | null>(null);
  const reqCounterRef = useRef(0);

  const previousIdentityRef = useRef(identityUid);

  useLayoutEffect(() => {
    if (confirmedIdentityUid === identityUid) {
      projectAtConfirmedIdentityRef.current = selectedProject;
      return;
    }
    if (selectedProject !== projectAtConfirmedIdentityRef.current) {
      projectAtConfirmedIdentityRef.current = selectedProject;
      setConfirmedIdentityUid(identityUid);
    }
  }, [confirmedIdentityUid, identityUid, selectedProject]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const active = activeReqRef.current;
      if (active) {
        invalidateRequest(active);
        activeReqRef.current = null;
      }
    };
  }, []);

  // Cambio de contexto ⇒ aborta la petición en vuelo (el guard de epoch ya
  // impide que su respuesta se aplique; abortar además libera el transporte).
  // Se aborta SÓLO la petición de un epoch anterior: una petición abierta ya
  // en el contexto nuevo no debe ser abortada por este efecto.
  useLayoutEffect(() => {
    if (previousIdentityRef.current !== identityUid) {
      previousIdentityRef.current = identityUid;
      setQuery('');
      setPattern('');
    }
    const active = activeReqRef.current;
    if (active && active.epoch !== state.epoch) {
      invalidateRequest(active);
      activeReqRef.current = null;
    }
  }, [contextToken, state.epoch, identityUid]);

  const epoch = state.epoch;
  const isLive = (req: ActiveRequest) =>
    mountedRef.current && !req.invalidated && activeReqRef.current === req;

  const setErrorMessage = (message: string) => {
    setState(prev => ({ ...prev, error: message }));
  };

  /** Abre una petición nueva e invalida la anterior. */
  const beginRequest = (): ActiveRequest => {
    const previous = activeReqRef.current;
    if (previous) {
      invalidateRequest(previous);
    }
    const id = ++reqCounterRef.current;
    const controller = new AbortController();
    const request: ActiveRequest = { id, epoch, controller, invalidated: false, timedOut: false };
    activeReqRef.current = request;
    setState(prev => (prev.epoch === request.epoch
      ? { ...prev, reqId: id, loading: true, error: null }
      : prev));
    return request;
  };

  /** Escribe el resultado sólo si la petición sigue siendo la vigente. */
  const commit = (
    request: ActiveRequest,
    patch: Partial<Omit<PanelState, 'token' | 'epoch'>>,
  ) => {
    setState(prev => (
      prev.epoch === request.epoch && prev.reqId === request.id
        ? { ...prev, ...patch }
        : prev
    ));
  };

  const onSearch = async () => {
    if (!projectId) {
      setErrorMessage('Selecciona un proyecto primero.');
      return;
    }
    if (!identityReady) {
      setErrorMessage('Inicia sesión para consultar el histórico.');
      return;
    }
    if (!projectContextReady) {
      setErrorMessage('Actualizando el contexto del proyecto. Inténtalo nuevamente en un momento.');
      return;
    }
    if (query.trim().length === 0) {
      setErrorMessage('Escribe una consulta para buscar.');
      return;
    }
    // No se abre concurrencia sin control (botón deshabilitado durante la carga).
    if (state.loading) return;

    const request = beginRequest();
    const timeoutId = request.timeoutId = setTimeout(() => {
      if (!isLive(request)) return;
      request.timedOut = true;
      request.invalidated = true;
      request.controller.abort();
      commit(request, {
        loading: false,
        error: 'La consulta tardó demasiado. Inténtalo nuevamente.',
      });
    }, QUERY_TIMEOUT_MS);

    try {
      const out = await postNlQuery(
        { query: query.trim(), projectId, topK },
        { signal: request.controller.signal, isLive: () => isLive(request) },
      );
      if (!out || !isLive(request)) return;
      commit(request, {
        loading: false,
        results: out.results ?? [],
        citations: out.citations ?? [],
      });
    } catch (e: any) {
      if (!isLive(request)) return;
      logger.error('nl-query failed', e);
      commit(request, {
        loading: false,
        error: e?.message ?? 'Error al consultar el histórico.',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const onStructuredSearch = async () => {
    if (!projectId) {
      setErrorMessage('Selecciona un proyecto primero.');
      return;
    }
    if (!identityReady) {
      setErrorMessage('Inicia sesión para consultar el grafo.');
      return;
    }
    if (!projectContextReady) {
      setErrorMessage('Actualizando el contexto del proyecto. Inténtalo nuevamente en un momento.');
      return;
    }
    if (pattern.trim().length === 0) {
      setErrorMessage('Escribe un patrón para consultar el grafo.');
      return;
    }
    // No se abre concurrencia sin control (Enter respeta el mismo `disabled`).
    if (state.loading) return;

    const request = beginRequest();
    const timeoutId = request.timeoutId = setTimeout(() => {
      if (!isLive(request)) return;
      request.timedOut = true;
      request.invalidated = true;
      request.controller.abort();
      commit(request, {
        loading: false,
        error: 'La consulta tardó demasiado. Inténtalo nuevamente.',
      });
    }, QUERY_TIMEOUT_MS);

    try {
      const out = await postStructuredQuery(
        { pattern: pattern.trim(), projectId },
        { signal: request.controller.signal, isLive: () => isLive(request) },
      );
      if (!out || !isLive(request)) return;
      commit(request, {
        loading: false,
        matches: out.matches ?? [],
        structuredSearched: true,
      });
    } catch (e: any) {
      if (!isLive(request)) return;
      logger.error('structured-query failed', e);
      commit(request, {
        loading: false,
        error: e?.message ?? 'Error al consultar el grafo.',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const switchMode = (next: 'semantic' | 'structured') => {
    setMode(next);
    setState(prev => ({ ...prev, error: null }));
  };

  const { results, citations, matches, structuredSearched, loading, error } = state;
  // Sin identidad válida no se muestra ningún dato privado del contexto.
  const canShowPrivateData = canQuery;

  // m31 — el nombre y el id del proyecto son dato PRIVADO: sin identidad
  // válida el rótulo NO puede seguir exponiéndolos (tras un logout el
  // panel volvería a delatar el proyecto de la sesión anterior).
  const projectLabel = !identityReady
    ? 'Sesión no válida'
    : !projectContextReady
      ? 'Actualizando contexto…'
      : selectedProject
        ? `${selectedProject.name} (${selectedProject.id})`
        : 'Sin proyecto seleccionado';

  return (
    <section
      data-testid="nl-query-panel"
      className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6 space-y-4"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#4db6ac]/10 flex items-center justify-center border border-[#4db6ac]/20">
            {mode === 'semantic' ? (
              <Search className="w-5 h-5 text-[#4db6ac]" />
            ) : (
              <Network className="w-5 h-5 text-[#4db6ac]" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {mode === 'semantic'
                ? 'Buscar en histórico de incidentes'
                : 'Consulta estructurada del grafo'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'semantic'
                ? 'Consulta en lenguaje natural sobre los incidentes del proyecto activo.'
                : 'Respuestas exactas sobre las relaciones tipadas del grafo — sin IA.'}
            </p>
          </div>
        </div>
        <div
          className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs"
          role="tablist"
          aria-label="Modo de consulta"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'semantic'}
            data-testid="nl-query-mode-semantic"
            onClick={() => switchMode('semantic')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              mode === 'semantic'
                ? 'bg-[#4db6ac] text-white'
                : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Semántica (IA)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'structured'}
            data-testid="nl-query-mode-structured"
            onClick={() => switchMode('structured')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              mode === 'structured'
                ? 'bg-[#4db6ac] text-white'
                : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Grafo (exacto)
          </button>
        </div>
      </header>

      {/* m31 — etiqueta de contexto con datos REALES del proyecto activo.
          No afirma membresías, roles ni permisos: sólo el nombre y el id que
          el proyecto seleccionado ya expone. */}
      <p
        data-testid="nl-query-context"
        className="text-[11px] text-slate-500 dark:text-slate-400"
      >
        Contexto: {projectLabel}
      </p>

      {mode === 'semantic' ? (
        <div className="space-y-2">
          <textarea
            data-testid="nl-query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej: caídas de altura sin arnés en pasarelas durante la última temporada"
            rows={3}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-[#4db6ac]"
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={loading || !projectId || !canQuery}
            data-testid="nl-query-submit"
            className="inline-flex items-center gap-2 bg-[#4db6ac] hover:bg-[#3da095] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-xl transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            data-testid="structured-query-input"
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              // Enter NO ignora el estado `disabled` del botón: si la consulta
              // está en curso no se abre una segunda petición.
              if (e.key === 'Enter' && !state.loading && projectId && canQuery) {
                e.preventDefault();
                onStructuredSearch();
              }
            }}
            placeholder="(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical"
            spellCheck={false}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-[#4db6ac]"
          />
          <div className="flex flex-wrap gap-1.5">
            {PATTERN_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPattern(ex)}
                className="text-[10px] font-mono px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#4db6ac] hover:text-[#4db6ac] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onStructuredSearch}
            disabled={loading || !projectId || !canQuery}
            data-testid="structured-query-submit"
            className="inline-flex items-center gap-2 bg-[#4db6ac] hover:bg-[#3da095] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-xl transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
            {loading ? 'Consultando…' : 'Consultar grafo'}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
          <FileWarning className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-700 dark:text-rose-300">{humanErrorMessage(error)}</p>
        </div>
      )}

      {mode === 'structured' && structuredSearched && !loading && !error && canShowPrivateData && (
        <>
          {matches.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="structured-query-empty">
              Sin coincidencias para este patrón en el grafo del proyecto.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="structured-query-results">
              {matches.map((m) => (
                <li
                  key={`${m.from.id}|${m.via}|${m.to.id}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/40 p-3 flex items-center gap-2 flex-wrap"
                >
                  <NodeChip node={m.from} />
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[#4db6ac] shrink-0">
                    [{m.via}]
                    <ArrowRight
                      className={`w-3 h-3 ${m.direction === 'incoming' ? 'rotate-180' : ''}`}
                    />
                  </span>
                  <NodeChip node={m.to} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === 'semantic' && canShowPrivateData && results.length > 0 && (
        <ul className="space-y-2" data-testid="nl-query-results">
          {results.map((hit) => (
            <li
              key={hit.incidentId}
              className="rounded-lg border border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-mono text-[#4db6ac]">incident:{hit.incidentId}</p>
                {hit.occurredAt && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {hit.occurredAt}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-800 dark:text-slate-100 mt-1">{hit.summary}</p>
            </li>
          ))}
        </ul>
      )}

      {mode === 'semantic' && canShowPrivateData && citations.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Citas: {citations.join(' · ')}</span>
        </div>
      )}
    </section>
  );
};

export default NlQueryPanel;
