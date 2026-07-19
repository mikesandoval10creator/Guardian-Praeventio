// Sprint 29 Bucket AA F-B — NL query panel.
//
// Textarea + botón "Buscar" → POST /api/zettelkasten/nl-query.
// Renderiza la lista de resultados con cita al incident_id.
//
// Alpha41 ZK-8 — segundo modo "Grafo (exacto)": consultas estructuradas
// cypher-lite sobre las aristas tipadas, sin LLM, para auditoría preventiva
// precisa → POST /api/zettelkasten/structured-query.
//   Ej: (:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical

import React, { useState } from 'react';
import { Search, Loader2, FileWarning, BookOpen, Network, ArrowRight } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
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

async function postNlQuery(payload: {
  query: string;
  projectId: string;
  topK: number;
}): Promise<NlQueryResponse> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch('/api/zettelkasten/nl-query', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as NlQueryResponse;
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

async function postStructuredQuery(payload: {
  pattern: string;
  projectId: string;
}): Promise<StructuredQueryResponse> {
  const authHeader = await apiAuthHeader();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch('/api/zettelkasten/structured-query', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    if (errBody?.error === 'invalid_pattern') {
      throw new Error(
        'Patrón inválido. Formato: (:Tipo)-[:arista]->(:Tipo) WHERE campo=valor',
      );
    }
    throw new Error(errBody?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as StructuredQueryResponse;
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

export const NlQueryPanel: React.FC = () => {
  const { selectedProject } = useProject();
  const [mode, setMode] = useState<'semantic' | 'structured'>('semantic');
  const [query, setQuery] = useState('');
  const [topK] = useState(5);
  const [results, setResults] = useState<IncidentSearchHit[]>([]);
  const [citations, setCitations] = useState<string[]>([]);
  const [pattern, setPattern] = useState('');
  const [matches, setMatches] = useState<StructuredMatch[]>([]);
  const [structuredSearched, setStructuredSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = selectedProject?.id;

  const onSearch = async () => {
    if (!projectId) {
      setError('Selecciona un proyecto primero.');
      return;
    }
    if (query.trim().length === 0) {
      setError('Escribe una consulta para buscar.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await postNlQuery({ query: query.trim(), projectId, topK });
      setResults(out.results ?? []);
      setCitations(out.citations ?? []);
    } catch (e: any) {
      logger.error('nl-query failed', e);
      setError(e?.message ?? 'Error al consultar el histórico.');
    } finally {
      setLoading(false);
    }
  };

  const onStructuredSearch = async () => {
    if (!projectId) {
      setError('Selecciona un proyecto primero.');
      return;
    }
    if (pattern.trim().length === 0) {
      setError('Escribe un patrón para consultar el grafo.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await postStructuredQuery({ pattern: pattern.trim(), projectId });
      setMatches(out.matches ?? []);
      setStructuredSearched(true);
    } catch (e: any) {
      logger.error('structured-query failed', e);
      setError(e?.message ?? 'Error al consultar el grafo.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'semantic' | 'structured') => {
    setMode(next);
    setError(null);
  };

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
            disabled={loading || !projectId}
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
              if (e.key === 'Enter') onStructuredSearch();
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
            disabled={loading || !projectId}
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

      {mode === 'structured' && structuredSearched && !loading && !error && (
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

      {mode === 'semantic' && results.length > 0 && (
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

      {mode === 'semantic' && citations.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Citas: {citations.join(' · ')}</span>
        </div>
      )}
    </section>
  );
};

export default NlQueryPanel;
