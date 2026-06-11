// Praeventio Guard — Épica B1 (capa 2): client hook for the DS 67
// cotización-adicional simulator.
//
// Pairs with `src/server/routes/ds67.ts`:
//   GET  /api/compliance/:projectId/ds67/simulator/prefill
//   POST /api/compliance/:projectId/ds67/simulator/simulate
//
// The GET pre-fills "días perdidos" per período anual from the project's
// REAL registered incidents; the POST merges manual inputs and runs the
// pure engine server-side. The view only presents.

import { apiAuthHeaders } from '../lib/apiAuth';
import { useEndpoint } from './_fetchUtils';
import type {
  Ds67InvalidityBand,
  Ds67SimulationResult,
} from '../services/compliance/ds67Simulator';

export interface Ds67PrefillPeriod {
  /** es-CL label `01-07-2024 al 30-06-2025` (período anual art. 2 b)). */
  label: string;
  startIso: string;
  endIso: string;
  /** Sum of `lostDays` across registered incidents in the window. */
  registeredLostDays: number;
  registeredIncidentCount: number;
}

export interface Ds67PrefillResponse {
  generatedAt: string;
  periods: Ds67PrefillPeriod[];
}

export function useDs67Prefill(projectId: string | null) {
  const path = projectId ? `/api/compliance/${projectId}/ds67/simulator/prefill` : null;
  return useEndpoint<Ds67PrefillResponse>(path);
}

export interface Ds67SimulatePeriodPayload {
  label?: string;
  averageWorkers: number;
  /** Omit to let the server fill from registered incidents. */
  lostDays?: number;
  invalidityEvents?: Partial<Record<Ds67InvalidityBand, number>>;
}

export interface Ds67SimulatePayload {
  periods: Ds67SimulatePeriodPayload[];
  currentAdditionalCotizacionPct?: number;
  annualPayrollClp?: number;
}

export interface Ds67SimulateResponsePeriod {
  label: string;
  startIso: string;
  endIso: string;
  lostDays: number;
  lostDaysSource: 'manual' | 'incidents';
  registeredLostDays: number;
  registeredIncidentCount: number;
}

export interface Ds67SimulateResponse {
  generatedAt: string;
  result: Ds67SimulationResult;
  periods: Ds67SimulateResponsePeriod[];
}

export async function requestDs67Simulation(
  projectId: string,
  payload: Ds67SimulatePayload,
): Promise<Ds67SimulateResponse> {
  const res = await fetch(`/api/compliance/${projectId}/ds67/simulator/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await apiAuthHeaders()),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as Ds67SimulateResponse;
}
