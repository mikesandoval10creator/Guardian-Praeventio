// Praeventio Guard — F.29 Indicadores de Tendencia de Incidentes.
//
// Hook puro fetch — el endpoint `/api/sprint-k/:projectId/incidents/trends`
// agrega y normaliza; el cliente solo presenta. Migrado del monolito
// `useSprintK.ts` (2026-05-17) — cada feature Sprint K debe vivir en su
// propio archivo de dominio según directiva del usuario.
//
// Pareja del backend en `src/server/routes/incidentTrends.ts`.

import { useEndpoint } from './_fetchUtils';

export type IncidentTrendWindow = '3m' | '6m' | '12m';
export type IncidentTrendGroup = 'month' | 'week';
export type IncidentTrendDirection = 'improving' | 'stable' | 'worsening';

export interface IncidentTrendBucket {
  label: string;
  count: number;
  severityWeighted: number;
  byKind: Record<string, number>;
}

export interface IncidentTrendLeading {
  /** 0..1 — fracción de near-miss sobre total. */
  nearMissRatio: number;
  /** 0..1 — fracción cerrados / total. */
  closureRate: number;
  /** Promedio en días entre occurredAt y closedAt (solo cerrados). */
  averageDaysOpen: number;
}

export interface IncidentTrendsResponse {
  window: IncidentTrendWindow;
  group: IncidentTrendGroup;
  totalIncidents: number;
  buckets: IncidentTrendBucket[];
  leading: IncidentTrendLeading;
  trend: IncidentTrendDirection;
  /** 0..1 — confianza R² de la regresión lineal sobre severityWeighted. */
  trendConfidence: number;
  generatedAt: string;
}

export interface UseIncidentTrendsOptions {
  window?: IncidentTrendWindow;
  group?: IncidentTrendGroup;
}

export function useIncidentTrends(
  projectId: string | null,
  opts: UseIncidentTrendsOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.window) qs.set('window', opts.window);
    if (opts.group) qs.set('group', opts.group);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/incidents/trends${query ? `?${query}` : ''}`;
  }
  return useEndpoint<IncidentTrendsResponse>(path);
}
