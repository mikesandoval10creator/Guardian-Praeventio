// Praeventio Guard — §214-215 Positive Observations + Balance hooks.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation. Mantiene la forma pública para que los consumers solo
// cambien el import.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  PositiveObservation,
  BalanceReport,
} from '../services/positiveObservations/positiveObservationsService';
import { apiAuthHeader } from '../lib/apiAuth';

export interface PositiveObservationsResponse {
  observations: PositiveObservation[];
}

export function usePositiveObservationsForWorker(
  projectId: string | null,
  workerUid: string | null,
) {
  return useEndpoint<PositiveObservationsResponse>(
    projectId && workerUid
      ? `/api/sprint-k/${projectId}/positive-observations/worker/${workerUid}`
      : null,
  );
}

export interface PositiveObservationPayload {
  id: string;
  observedWorkerUid: string;
  kind: PositiveObservation['kind'];
  description: string;
  observedAt: string;
  location: string;
  shared?: boolean;
}

export async function createPositiveObservation(
  projectId: string,
  payload: PositiveObservationPayload,
): Promise<void> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(`/api/sprint-k/${projectId}/positive-observations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

export type PositiveObservationPeriod = '30d' | '90d' | 'all';

export interface PositiveObservationsPageInfo {
  limit: number;
  hasMore: boolean;
  nextStartAfter: string | null;
}

export interface PositiveObservationsListResponse {
  observations: PositiveObservation[];
  period: PositiveObservationPeriod;
  pagination?: PositiveObservationsPageInfo;
}

export interface PositiveObservationBalanceResponse {
  positive: number;
  corrective: number;
  ratio: number;
  period: PositiveObservationPeriod;
  balance: BalanceReport;
  positivePeriod?: PositiveObservationPeriod;
  correctivePeriod?: PositiveObservationPeriod;
  correctivePeriodBasis?: 'dueDate' | 'all';
}

export function usePositiveObservations(
  projectId: string | null,
  opts: { period?: PositiveObservationPeriod; startAfter?: string } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.period) qs.set('period', opts.period);
    if (opts.startAfter) qs.set('startAfter', opts.startAfter);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/positive-observations${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<PositiveObservationsListResponse>(path);
}

export function usePositiveObservationBalance(
  projectId: string | null,
  period: PositiveObservationPeriod = '30d',
) {
  const path = projectId
    ? `/api/sprint-k/${projectId}/positive-observations/balance?period=${period}`
    : null;
  return useEndpoint<PositiveObservationBalanceResponse>(path);
}
