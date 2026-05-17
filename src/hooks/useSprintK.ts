// Praeventio Guard — Sprint K hooks bridge.
//
// Hooks fetch-based para los endpoints en /api/sprint-k. Patrón
// consistente con useInsights.ts: { data, loading, error, refetch }.

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type { VulnerabilitySnapshot } from '../services/vulnerability/vulnerabilityFirestoreAdapter';
import type { StoredSIFPrecursor } from '../services/sif/sifFirestoreAdapter';
import type { PositiveObservation } from '../services/positiveObservations/positiveObservationsService';
import type {
  WasteRecord,
  WasteManifest,
  EnvironmentalPermit,
} from '../services/environmental/environmentalCompliance';
import type { VisitorAccess } from '../services/visitors/visitorAccessService';
import type { Lesson, LessonScope } from '../services/lessonsLearned/lessonsLibrary';
import type {
  CorrectiveAction,
  CorrectiveActionLevel,
} from '../services/correctiveActions/weakActionDetector';
import type { LotoApplication } from '../services/loto/lotoDigitalLight';
import type { Equipment, EquipmentStatus } from '../services/equipment/equipmentQrService';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(path: string, signal: AbortSignal): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function useEndpoint<T>(path: string | null): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  });
  const [refetchKey, setRefetchKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    controllerRef.current = ctl;

    (async () => {
      try {
        const res = await authedFetch(path, ctl.signal);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const json = (await res.json()) as T;
        if (!ctl.signal.aborted) {
          setState({ data: json, loading: false, error: null });
        }
      } catch (err) {
        if (ctl.signal.aborted) return;
        setState({ data: null, loading: false, error: err as Error });
      }
    })();

    return () => ctl.abort();
  }, [path, refetchKey]);

  const refetch = useCallback(() => setRefetchKey((k) => k + 1), []);
  return { ...state, refetch };
}

// ────────────────────────────────────────────────────────────────────────
// Public hooks
// ────────────────────────────────────────────────────────────────────────

export interface VulnerabilityResponse {
  snapshot: VulnerabilitySnapshot | null;
}

export function useVulnerabilityLatest(projectId: string | null) {
  return useEndpoint<VulnerabilityResponse>(
    projectId ? `/api/sprint-k/${projectId}/vulnerability/latest` : null,
  );
}

export interface SifPendingResponse {
  precursors: StoredSIFPrecursor[];
}

export function useSifPendingReview(projectId: string | null) {
  return useEndpoint<SifPendingResponse>(
    projectId ? `/api/sprint-k/${projectId}/sif/pending-review` : null,
  );
}

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

export interface WasteInventoryResponse {
  wastes: WasteRecord[];
  pendingManifests: WasteManifest[];
  permits: EnvironmentalPermit[];
}

export function useWasteInventory(projectId: string | null) {
  return useEndpoint<WasteInventoryResponse>(
    projectId ? `/api/sprint-k/${projectId}/waste/inventory` : null,
  );
}

export interface ActiveVisitorsResponse {
  visitors: VisitorAccess[];
}

export function useActiveVisitors(projectId: string | null) {
  return useEndpoint<ActiveVisitorsResponse>(
    projectId ? `/api/sprint-k/${projectId}/visitors/active` : null,
  );
}

export interface LessonsResponse {
  lessons: Lesson[];
}

export function useLessons(
  projectId: string | null,
  opts: { scope?: LessonScope; riskCategory?: string } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.scope) qs.set('scope', opts.scope);
    if (opts.riskCategory) qs.set('riskCategory', opts.riskCategory);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/lessons${query ? `?${query}` : ''}`;
  }
  return useEndpoint<LessonsResponse>(path);
}

export interface CorrectiveActionsResponse {
  actions: CorrectiveAction[];
  systemic: CorrectiveAction[];
}

export function useCorrectiveActions(
  projectId: string | null,
  opts: { status?: 'open' | 'closed' | 'verified' } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/corrective-actions${query ? `?${query}` : ''}`;
  }
  return useEndpoint<CorrectiveActionsResponse>(path);
}

export interface LotoResponse {
  applications: LotoApplication[];
}

export function useLoto(
  projectId: string | null,
  opts: { equipmentId?: string } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.equipmentId) qs.set('equipmentId', opts.equipmentId);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/loto${query ? `?${query}` : ''}`;
  }
  return useEndpoint<LotoResponse>(path);
}

export interface EquipmentResponse {
  equipment: Equipment[];
}

export function useEquipment(
  projectId: string | null,
  opts: { status?: EquipmentStatus } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/equipment${query ? `?${query}` : ''}`;
  }
  return useEndpoint<EquipmentResponse>(path);
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.8 — Inbox del prevencionista
// ────────────────────────────────────────────────────────────────────────
//
// Wraps GET /api/sprint-k/:projectId/inbox which aggregates the N feeds
// listed in F.8 (corrective actions, SIF precursors, etc.) into a single
// ordered list. Types come from the aggregator service so the component
// gets the same shape it would from a direct in-process call.

import type {
  InboxItem,
  InboxSummary,
} from '../services/inbox/inboxAggregator';

export interface InboxResponse {
  items: InboxItem[];
  summary: InboxSummary;
}

export function useInbox(projectId: string | null) {
  return useEndpoint<InboxResponse>(
    projectId ? `/api/sprint-k/${projectId}/inbox` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────────────────

export async function recordSifExecutiveReview(
  projectId: string,
  precursorId: string,
  payload: { reviewedByUid: string; reviewedAt: string; reviewNotes?: string },
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/sif/${precursorId}/executive-review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
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
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/positive-observations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

export interface LessonPayload {
  id: string;
  summary: string;
  preventiveAction: string;
  riskCategories: string[];
  tags: string[];
  scope: LessonScope;
  industry?: string;
  derivedFromIncidentId?: string;
  publishedAt: string;
  adoptionCount: number;
}

export async function createLesson(
  projectId: string,
  payload: LessonPayload,
): Promise<{ ok: true }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return { ok: true };
}

export interface CorrectiveActionPayload {
  id: string;
  description: string;
  level?: CorrectiveActionLevel;
  status: 'open' | 'closed' | 'verified';
  isSystemic: boolean;
  sourceCause?: string;
}

export async function createCorrectiveAction(
  projectId: string,
  payload: CorrectiveActionPayload,
): Promise<{ ok: true }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/corrective-actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.9 — Data Quality scanner (pre-IA gap detector)
// ────────────────────────────────────────────────────────────────────────

import type {
  DataQualityReport,
  Gap as DataQualityGap,
} from '../services/dataQuality/incompletenessScanner';

export interface DataQualityResponse {
  report: DataQualityReport;
  topGaps: DataQualityGap[];
}

export function useDataQuality(projectId: string | null) {
  return useEndpoint<DataQualityResponse>(
    projectId ? `/api/sprint-k/${projectId}/data-quality` : null,
  );
}
