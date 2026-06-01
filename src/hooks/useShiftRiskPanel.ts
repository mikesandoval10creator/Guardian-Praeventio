// Praeventio Guard — Shift Risk Panel client hook (1 mutator).

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  ShiftRiskInputs,
  ShiftRiskReport,
} from '../services/shiftRiskPanel/preShiftRiskComposer';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * projectId is taken from the URL; the rest of `ShiftRiskInputs` is sent
 * in the body.
 */
export type ShiftRiskPanelInput = Omit<ShiftRiskInputs, 'projectId'>;

export interface ShiftRiskPanelResponse {
  report: ShiftRiskReport;
}

export async function composeShiftRiskPanelApi(
  projectId: string,
  input: ShiftRiskPanelInput,
): Promise<ShiftRiskPanelResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-risk-panel/compose`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftRiskPanelResponse>(res);
}
