// Sprint 29 Bucket AA F-B — NL query panel.
//
// Textarea + botón "Buscar" → POST /api/zettelkasten/nl-query.
// Renderiza la lista de resultados con cita al incident_id.

import React, { useState } from 'react';
import { Search, Loader2, FileWarning, BookOpen } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { logger } from '../../utils/logger';

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
  const { auth } = await import('../../services/firebase');
  const token = await auth.currentUser?.getIdToken?.();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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

export const NlQueryPanel: React.FC = () => {
  const { selectedProject } = useProject();
  const [query, setQuery] = useState('');
  const [topK] = useState(5);
  const [results, setResults] = useState<IncidentSearchHit[]>([]);
  const [citations, setCitations] = useState<string[]>([]);
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

  return (
    <section
      data-testid="nl-query-panel"
      className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6 space-y-4"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#4db6ac]/10 flex items-center justify-center border border-[#4db6ac]/20">
          <Search className="w-5 h-5 text-[#4db6ac]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Buscar en histórico de incidentes
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Consulta en lenguaje natural sobre los incidentes del proyecto activo.
          </p>
        </div>
      </header>

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

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
          <FileWarning className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {results.length > 0 && (
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

      {citations.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Citas: {citations.join(' · ')}</span>
        </div>
      )}
    </section>
  );
};

export default NlQueryPanel;
