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
  // Codex P2 round 3 (PR #309): widened to accept the full F.4
  // status set so the CorrectiveActions page can fetch in_progress
  // and reopened records too.
  opts: {
    status?: 'open' | 'in_progress' | 'closed' | 'verified' | 'reopened';
  } = {},
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

// ────────────────────────────────────────────────────────────────────────
// Fase F.3 — Incident evidence bundle
// ────────────────────────────────────────────────────────────────────────

import type { IncidentBundleManifest } from '../services/incidentBundle/incidentEvidenceBundle';

export interface IncidentBundleResponse {
  manifest: IncidentBundleManifest;
}

export function useIncidentBundle(
  projectId: string | null,
  incidentId: string | null,
) {
  return useEndpoint<IncidentBundleResponse>(
    projectId && incidentId
      ? `/api/sprint-k/${projectId}/incidents/${incidentId}/bundle`
      : null,
  );
}

/**
 * Codex P2 round 4 (PR #309): persist a scheduled effectiveness review.
 * Calls POST /api/sprint-k/:projectId/corrective-actions/:actionId/effectiveness-review.
 */
export async function scheduleCorrectiveActionEffectivenessReview(
  projectId: string,
  actionId: string,
  reviewAt: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/corrective-actions/${actionId}/effectiveness-review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ actionId, reviewAt }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.5 — Firma QR de Recepción
// ────────────────────────────────────────────────────────────────────────
//
// Cliente para los dos endpoints F.5 expuestos en sprintK.ts:
//   - POST /qr-signature/challenge  → genera challenge HMAC + nonce
//   - POST /qr-signature/acknowledge → persiste la firma del trabajador
//
// El motor de firma vive en `services/qrSignature/qrSignatureService.ts`
// (HMAC + canonicalize). Aquí solo wrap HTTP + auth header.

import type {
  QrSignatureChallenge,
  SignedAcknowledgement,
  SignatureItemKind,
} from '../services/qrSignature/qrSignatureService';

export async function requestQrSignatureChallenge(
  projectId: string,
  itemId: string,
  kind: SignatureItemKind,
  ttlMinutes?: number,
): Promise<QrSignatureChallenge> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/qr-signature/challenge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ itemId, kind, ttlMinutes }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { challenge: QrSignatureChallenge };
  return data.challenge;
}

export interface QrAcknowledgementPayload {
  challengeId: string;
  workerUid: string;
  biometricUsed?: boolean;
  signedAt: string;
}

export async function persistQrAcknowledgement(
  projectId: string,
  payload: QrAcknowledgementPayload,
): Promise<SignedAcknowledgement> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/qr-signature/acknowledge`,
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
  const data = (await res.json()) as { acknowledgement: SignedAcknowledgement };
  return data.acknowledgement;
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.26 — Indicador de Madurez Preventiva
// ────────────────────────────────────────────────────────────────────────
//
// Wraps GET /api/sprint-k/:projectId/maturity-index which derives 10
// señales objetivas a partir de las colecciones canónicas del proyecto
// y corre `computeMaturityLevel` + `recommendNextSteps`. Devuelve el
// `MaturityReport` con sub-puntajes por categoría + 3 recomendaciones
// concretas para subir de nivel.
//
// Cuando el proyecto es muy nuevo o no tiene actividad mínima el server
// devuelve `{ insufficientData: true, reason }` y la UI muestra el
// empty-state explicativo en vez de un score 1 alarmista.

import type {
  MaturityReport,
  MaturityRecommendation,
  MaturitySignals,
} from '../services/maturity/preventionMaturityIndex';

export interface MaturityIndexResponse {
  // Caso "datos insuficientes": faena recién creada o sin señales.
  insufficientData?: boolean;
  reason?: 'project_too_new' | 'not_enough_signals';
  signalsCount?: number;
  /** Fuentes (feeds) distintas con ≥1 doc. Codex P2 fix: el gate y el
   *  honest-data-completeness se basa en esto, no en signalsCount. */
  feedsAvailable?: number;
  /** Nombres de las fuentes pobladas (útil para diagnóstico/UI). */
  populatedFeeds?: string[];
  projectAgeDays?: number | null;
  // Caso normal: reporte completo.
  report?: MaturityReport;
  recommendations?: MaturityRecommendation[];
  signals?: MaturitySignals;
  metadata?: {
    signalsCount: number;
    feedsAvailable: number;
    populatedFeeds: string[];
    projectAgeDays: number | null;
    windowMonths: number;
  };
}

export function usePreventionMaturity(projectId: string | null) {
  return useEndpoint<MaturityIndexResponse>(
    projectId ? `/api/sprint-k/${projectId}/maturity-index` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.15 — Centro de Permisos de Trabajo (Work Permits)
// ────────────────────────────────────────────────────────────────────────
//
// LOTO / Altura / Caliente / Confinado / Excavación / Izaje crítico.
// Engine: src/services/workPermits/workPermitEngine.ts
// Adapter: src/services/workPermits/workPermitFirestoreAdapter.ts

import type {
  WorkPermit,
  WorkPermitKind,
  WorkPermitStatus,
} from '../services/workPermits/workPermitEngine';

export interface WorkPermitsResponse {
  permits: WorkPermit[];
}

export function useWorkPermits(
  projectId: string | null,
  opts: { status?: WorkPermitStatus; kind?: WorkPermitKind } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.kind) qs.set('kind', opts.kind);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/work-permits${query ? `?${query}` : ''}`;
  }
  return useEndpoint<WorkPermitsResponse>(path);
}

export interface WorkPermitChecklistItemPayload {
  id: string;
  label: string;
  checked: boolean;
  verifiedAt?: string;
}

/**
 * Codex P1 #1 + P1 #2 + P2 #3: client-facing payload is intentionally
 * minimal. The server takes the issuer/approver identity from `req.user`
 * (NOT from the body) and seeds the canonical unchecked checklist for
 * the kind — supervisors attest in the dedicated /sign step. The
 * optional `workerUid` is a self-assignment hint; defaults to the
 * caller's uid server-side.
 */
export interface WorkPermitCreatePayload {
  id: string;
  kind: WorkPermitKind;
  workerUid?: string;
  zoneId?: string;
  taskDescription: string;
  durationHours: number;
}

/** Optional attestation payload for `signWorkPermit`. */
export interface WorkPermitSignPayload {
  workerHasTraining?: boolean;
  workerHasEpp?: boolean;
  workerMedicallyFit?: boolean;
  checkedLabels?: string[];
}

export async function createWorkPermit(
  projectId: string,
  payload: WorkPermitCreatePayload,
): Promise<{ permit: WorkPermit }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/work-permits`, {
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
  return (await res.json()) as { permit: WorkPermit };
}

export async function signWorkPermit(
  projectId: string,
  permitId: string,
  attestation?: WorkPermitSignPayload,
): Promise<{ permit: WorkPermit }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/work-permits/${permitId}/sign`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(attestation ?? {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { permit: WorkPermit };
}

export async function closeWorkPermit(
  projectId: string,
  permitId: string,
  reason: string,
  outcome: 'fulfill' | 'cancel' = 'fulfill',
): Promise<{ permit: WorkPermit }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/work-permits/${permitId}/close`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ reason, outcome }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { permit: WorkPermit };
}
