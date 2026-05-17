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
import type { ScoreBreakdown } from '../services/suppliers/supplierScoring';

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

// ────────────────────────────────────────────────────────────────────────
// Fase F.21 — Panel de Riesgo por Turno (pre-turno)
// ────────────────────────────────────────────────────────────────────────
//
// Wraps GET /api/sprint-k/:projectId/pre-shift-risk which composes the
// determinístico pre-shift risk panel from 7 signals (weather, fatigue,
// new workers, critical tasks, equipment, recent incidents, brigade).
// Types come from `preShiftRiskComposer` so the page shows the same
// shape it would from a direct in-process call.

import type {
  ShiftRiskReport,
  ShiftPeriod,
} from '../services/shiftRiskPanel/preShiftRiskComposer';

export interface PreShiftRiskResponse {
  panel: ShiftRiskReport;
}

export interface PreShiftRiskOptions {
  /** YYYY-MM-DD. Defaults to today (server-side). */
  date?: string;
  /** Defaults to 'day' (server-side). */
  shift?: ShiftPeriod;
}

export function usePreShiftRisk(
  projectId: string | null,
  opts: PreShiftRiskOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.date) qs.set('date', opts.date);
    if (opts.shift) qs.set('shift', opts.shift);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/pre-shift-risk${query ? `?${query}` : ''}`;
  }
  return useEndpoint<PreShiftRiskResponse>(path);
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

// ────────────────────────────────────────────────────────────────────────
// Fase F.13 — Radar de Riesgos Repetidos
// ────────────────────────────────────────────────────────────────────────

import type { RadarReport } from '../services/riskRadar/repeatingRiskRadar';

export interface RepeatingRisksResponse {
  report: RadarReport;
}

export function useRepeatingRisks(projectId: string | null) {
  return useEndpoint<RepeatingRisksResponse>(
    projectId ? `/api/sprint-k/${projectId}/repeating-risks` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.20 — Gestor de Simulacros
// ────────────────────────────────────────────────────────────────────────
//
// Hooks + mutations for the drills surface. Shapes mirror what the
// sprintK.ts endpoints return — the page consumes the response directly
// and renders cards / detail without an intermediate adapter.

export type DrillKindAPI =
  | 'evacuation'
  | 'fire'
  | 'spill_chemical'
  | 'first_aid'
  | 'rescue_confined'
  | 'rescue_height'
  | 'gas_leak'
  | 'earthquake';

export type DrillStatusAPI =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type DrillLevelAPI =
  | 'excellent'
  | 'good'
  | 'needs_improvement'
  | 'critical'
  /**
   * Sin baseline real para gradear: el plan omitió `expectedCount` y/o
   * `benchmarkSeconds`. La UI muestra "Baseline insuficiente" en vez de
   * un nivel cuantitativo. (Codex PR #316 P2.)
   */
  | 'insufficient_baseline';

export interface DrillRecord {
  id: string;
  kind: DrillKindAPI;
  scheduledAt: string;
  responsibleUid: string;
  status: DrillStatusAPI;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
  createdAt: string;
  createdBy: string;
  executedAt?: string;
  participantCount?: number;
  responseTimeSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
  report?: {
    /** `null` cuando el baseline `expectedCount` no fue registrado. */
    participationRate: number | null;
    /** `null` cuando el baseline `benchmarkSeconds` no fue registrado. */
    speedDeficitPercent: number | null;
    level: DrillLevelAPI;
    recommendations: string[];
  };
}

export interface DrillsResponse {
  drills: DrillRecord[];
}

export interface DrillResponse {
  drill: DrillRecord;
}

export function useDrills(
  projectId: string | null,
  opts: { status?: DrillStatusAPI; kind?: DrillKindAPI } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.kind) qs.set('kind', opts.kind);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/drills${query ? `?${query}` : ''}`;
  }
  return useEndpoint<DrillsResponse>(path);
}

export function useDrill(
  projectId: string | null,
  drillId: string | null,
) {
  return useEndpoint<DrillResponse>(
    projectId && drillId
      ? `/api/sprint-k/${projectId}/drills/${drillId}`
      : null,
  );
}

export interface DrillPlanPayload {
  id: string;
  kind: DrillKindAPI;
  scheduledAt: string;
  responsibleUid: string;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
}

export async function planDrill(
  projectId: string,
  payload: DrillPlanPayload,
): Promise<DrillRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/drills/plan`, {
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
  const json = (await res.json()) as { ok: true; drill: DrillRecord };
  return json.drill;
}

export interface DrillExecutePayload {
  executedAt: string;
  participantCount: number;
  expectedCount?: number;
  responseTimeSeconds: number;
  benchmarkSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
}

export async function executeDrill(
  projectId: string,
  drillId: string,
  payload: DrillExecutePayload,
): Promise<DrillRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/drills/${drillId}/execute`,
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
  const json = (await res.json()) as { ok: true; drill: DrillRecord };
  return json.drill;
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.7 — Minuta CPHS automática
// ────────────────────────────────────────────────────────────────────────
//
// Wrappea GET /api/sprint-k/:projectId/cphs/draft-minute. El endpoint
// usa el motor determinístico `buildMonthlyMinuteDraft` para producir
// un `MinuteDraft` (markdown + secciones + métricas + completeness
// score). La page lo renderiza y permite descargar como JSON antes
// de que el CPHS firme el acta definitiva.

import type { MinuteDraft } from '../services/cphs/cphsMinuteAutogenerator';

export interface CphsDraftMinuteResponse {
  draft: MinuteDraft;
}

export function useCphsDraftMinute(projectId: string | null) {
  return useEndpoint<CphsDraftMinuteResponse>(
    projectId ? `/api/sprint-k/${projectId}/cphs/draft-minute` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Fase F.16 — Worker Readiness Score (asistente NO bloqueante)
// ────────────────────────────────────────────────────────────────────────
//
// Wraps GET /api/sprint-k/:projectId/worker-readiness/:workerUid (with
// optional ?taskId=) which calls `computeReadiness(profile, task)` from
// the workerReadiness service. The report is purely informational —
// the supervisor decides. Component MUST NOT gate any action on it.

import type { ReadinessReport } from '../services/workerReadiness/readinessScore';

export interface WorkerReadinessResponse {
  report: ReadinessReport;
}

export function useWorkerReadiness(
  projectId: string | null,
  workerUid: string | null,
  opts: { taskId?: string } = {},
) {
  let path: string | null = null;
  if (projectId && workerUid) {
    const qs = new URLSearchParams();
    if (opts.taskId) qs.set('taskId', opts.taskId);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/worker-readiness/${workerUid}${query ? `?${query}` : ''}`;
  }
  return useEndpoint<WorkerReadinessResponse>(path);
}

// ────────────────────────────────────────────────────────────────────────
// §74-78 — Brigada de Emergencia + Recursos
// ────────────────────────────────────────────────────────────────────────
//
// Wrappers para los 4 endpoints `/api/sprint-k/:projectId/emergency-brigade`:
//   - GET snapshot completo (members + resources + readiness rollup)
//   - POST member
//   - POST resource
//   - POST resource inspection
//
// El reporte agregado vive en el servidor (usa `buildBrigadeCoverageReport`
// + `buildResourceReadinessReport`); aquí solo se expone como `data` al
// componente.

import type {
  BrigadeMember,
  BrigadeRole,
  EmergencyResource,
  BrigadeCoverageReport,
  ResourceReadinessReport,
} from '../services/emergencyBrigade/emergencyBrigadeService';

export interface EmergencyBrigadeSnapshotResponse {
  members: (BrigadeMember & { id: string })[];
  resources: EmergencyResource[];
  brigade: BrigadeCoverageReport;
  resourceReadiness: ResourceReadinessReport;
  /** green | amber | rose — rollup para el banner del page. */
  readinessLevel: 'green' | 'amber' | 'rose';
}

export function useEmergencyBrigade(projectId: string | null) {
  return useEndpoint<EmergencyBrigadeSnapshotResponse>(
    projectId ? `/api/sprint-k/${projectId}/emergency-brigade` : null,
  );
}

export interface AddBrigadeMemberPayload {
  workerUid: string;
  role: BrigadeRole;
  trainedAt: string;
  trainingValidYears?: number;
  active?: boolean;
}

export async function addBrigadeMember(
  projectId: string,
  payload: AddBrigadeMemberPayload,
): Promise<{ ok: true; id: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/members`,
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
  return (await res.json()) as { ok: true; id: string };
}

export interface AddBrigadeResourcePayload {
  kind: EmergencyResource['kind'];
  location: string;
  lastInspectedAt: string;
  nextExpirationAt: string;
  operational?: boolean;
}

export async function addBrigadeResource(
  projectId: string,
  payload: AddBrigadeResourcePayload,
): Promise<{ ok: true; id: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/resources`,
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
  return (await res.json()) as { ok: true; id: string };
}

export interface InspectResourcePayload {
  inspectedAt: string;
  operational: boolean;
  nextExpirationAt?: string;
  notes?: string;
}

export async function inspectResource(
  projectId: string,
  resourceId: string,
  payload: InspectResourcePayload,
): Promise<{ ok: true; inspectionId: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/resources/${resourceId}/inspect`,
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
  return (await res.json()) as { ok: true; inspectionId: string };
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §214-215 — Observaciones Positivas + Balance
// ────────────────────────────────────────────────────────────────────────
//
// Hooks adicionales sobre el motor positiveObservations. El hook
// `usePositiveObservationsForWorker` ya existe arriba para listas por
// trabajador. Aquí se agrega:
//   - usePositiveObservations(projectId, { period })  → listado global
//   - usePositiveObservationBalance(projectId, period) → ratio §215
//
// El mutator `createPositiveObservation` ya existe arriba.

import type { BalanceReport } from '../services/positiveObservations/positiveObservationsService';

export type PositiveObservationPeriod = '30d' | '90d' | 'all';

export interface PositiveObservationsPageInfo {
  /** Page size cap applied server-side. */
  limit: number;
  /** True when more docs exist past `nextStartAfter`. */
  hasMore: boolean;
  /** Cursor doc id to pass back as `?startAfter=…` for the next page. */
  nextStartAfter: string | null;
}

export interface PositiveObservationsListResponse {
  observations: PositiveObservation[];
  period: PositiveObservationPeriod;
  /** Codex P2 PR #320 (line 5142): pagination metadata for bounded reads. */
  pagination?: PositiveObservationsPageInfo;
}

export interface PositiveObservationBalanceResponse {
  positive: number;
  corrective: number;
  ratio: number;
  period: PositiveObservationPeriod;
  balance: BalanceReport;
  /**
   * Codex P2 PR #320 (line 5198) + round 2: explicit window per side
   * so the UI can label the asymmetry honestly. The server now applies
   * a `dueDate >=` filter to correctives when a finite period is
   * requested (since the F.4 `CorrectiveActionRecord` carries `dueDate`
   * at creation), and falls back to `'all'` when the filter fails
   * (e.g. missing index, pre-F.4 docs). `correctivePeriodBasis` tells
   * the client which path was taken so it can render either a
   * symmetric "vs 30 días · dueDate" subtitle or an explicit asymmetry
   * chip when the basis falls back to `'all'`.
   */
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
    path = `/api/sprint-k/${projectId}/positive-observations${query ? `?${query}` : ''}`;
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

// ────────────────────────────────────────────────────────────────────────
// Fase F.6 — Modo Sin Señal para Inspecciones
// ────────────────────────────────────────────────────────────────────────
//
// Hooks + mutations for the offline-first inspections surface. The page
// (`OfflineInspection.tsx`) lets the inspector capture observations
// WITHOUT signal; the sync runs against these endpoints once the device
// is back online. Mutations are idempotent server-side (de-dup by
// client-generated id / observationId) so the offline queue can retry
// safely without doubling rows.

export type InspectionStatusAPI = 'in_progress' | 'completed';

export interface InspectionObservationRecord {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt: string;
  recordedBy: string;
}

export interface InspectionRecord {
  id: string;
  templateId: string;
  responsibleUid: string;
  status: InspectionStatusAPI;
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  observations: InspectionObservationRecord[];
}

export interface InspectionsResponse {
  inspections: InspectionRecord[];
}

export interface InspectionResponse {
  inspection: InspectionRecord;
}

export function useInspections(
  projectId: string | null,
  opts: { status?: InspectionStatusAPI | 'all' } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/inspections${query ? `?${query}` : ''}`;
  }
  return useEndpoint<InspectionsResponse>(path);
}

export function useInspection(
  projectId: string | null,
  inspectionId: string | null,
) {
  // The list endpoint returns the full collection; for a single doc we
  // reuse the list call client-side. Keeping a single read surface
  // avoids a second endpoint round-trip just to refresh detail after
  // an observation append (we re-fetch the list anyway).
  const all = useInspections(projectId, { status: 'all' });
  const inspection = all.data?.inspections.find((i) => i.id === inspectionId) ?? null;
  return {
    data: inspection ? { inspection } : null,
    loading: all.loading,
    error: all.error,
    refetch: all.refetch,
  } as FetchState<InspectionResponse> & { refetch: () => void };
}

export interface InspectionStartPayload {
  id: string;
  templateId: string;
  responsibleUid: string;
  startedAt?: string;
}

export async function startInspection(
  projectId: string,
  payload: InspectionStartPayload,
): Promise<InspectionRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/inspections`, {
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
  const json = (await res.json()) as { ok: true; inspection: InspectionRecord };
  return json.inspection;
}

export interface InspectionObservationPayload {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt?: string;
}

export async function addObservation(
  projectId: string,
  inspectionId: string,
  payload: InspectionObservationPayload,
): Promise<InspectionObservationRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/inspections/${inspectionId}/observations`,
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
  const json = (await res.json()) as {
    ok: true;
    observation: InspectionObservationRecord;
  };
  return json.observation;
}

export async function completeInspection(
  projectId: string,
  inspectionId: string,
  completedAt?: string,
): Promise<InspectionRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/inspections/${inspectionId}/complete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(completedAt ? { completedAt } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; inspection: InspectionRecord };
  return json.inspection;
}

// ────────────────────────────────────────────────────────────────────────
// §42-44 — Inventario Controles de Ingeniería + Jerarquía ISO 31000
// ────────────────────────────────────────────────────────────────────────
//
// Hooks + mutations para el inventario de controles aplicados según
// la jerarquía ISO 31000 / 45001:
//   elimination > substitution > engineering > administrative > epp
//
// Endpoints en `src/server/routes/sprintK.ts`:
//   GET    /api/sprint-k/:projectId/engineering-controls?level=...&riskCategory=...
//   POST   /api/sprint-k/:projectId/engineering-controls
//   POST   /api/sprint-k/:projectId/engineering-controls/:id/verify

export type EngineeringControlLevelAPI =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

export interface EngineeringControlVerificationAPI {
  verifierUid: string;
  verifiedAt: string;
  result: 'pass' | 'observation' | 'fail';
  evidence?: string;
}

export interface EngineeringControlAPI {
  id: string;
  level: EngineeringControlLevelAPI;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
  createdAt: string;
  createdBy: string;
  lastVerifiedAt: string | null;
  verifications: EngineeringControlVerificationAPI[];
}

export interface EngineeringControlsResponse {
  controls: EngineeringControlAPI[];
  /**
   * Codex P2 (PR #319): present when the server's best-effort read of
   * the `engineering_controls` collection threw (transient Firestore /
   * permissions / backend error). The list is still returned (possibly
   * empty) so the page renders, but the UI must show a degraded-data
   * banner instead of treating it as a clean empty inventory.
   */
  warning?: 'partial_read_failure';
}

export interface EngineeringControlsOptions {
  /** 'admin' is mapped to 'administrative' server-side. */
  level?: 'engineering' | 'admin' | 'epp' | 'all' | EngineeringControlLevelAPI;
  riskCategory?: string;
}

export function useEngineeringControls(
  projectId: string | null,
  opts: EngineeringControlsOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.level) qs.set('level', opts.level);
    if (opts.riskCategory) qs.set('riskCategory', opts.riskCategory);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/engineering-controls${query ? `?${query}` : ''}`;
  }
  return useEndpoint<EngineeringControlsResponse>(path);
}

export interface EngineeringControlCreatePayload {
  id: string;
  level: EngineeringControlLevelAPI;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
}

export async function createEngineeringControl(
  projectId: string,
  payload: EngineeringControlCreatePayload,
): Promise<{ ok: true; control: EngineeringControlAPI }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/engineering-controls`, {
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
  return (await res.json()) as { ok: true; control: EngineeringControlAPI };
}

/**
 * Codex P1 (PR #319): `verifierUid` was removed from the verify
 * payload — the server now derives the verifier identity from the
 * authenticated caller (`req.user!.uid`) instead of trusting the
 * client. The field is kept on the public type as an optional alias so
 * existing callers that still pass it do not break the compile; it is
 * stripped before the fetch goes out.
 */
export interface EngineeringControlVerifyPayload {
  result: 'pass' | 'observation' | 'fail';
  evidence?: string;
  /** @deprecated Server derives verifier from the authenticated caller. */
  verifierUid?: string;
}

export async function verifyControl(
  projectId: string,
  id: string,
  payload: EngineeringControlVerifyPayload,
): Promise<{ ok: true; entry: EngineeringControlVerificationAPI }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  // Codex P1 (PR #319): strip `verifierUid` before the wire. The server
  // ignores it (and the schema rejects unknowns), but stripping here
  // makes the intent explicit and keeps the request body minimal.
  const { verifierUid: _ignored, ...wirePayload } = payload;
  void _ignored;
  const res = await fetch(
    `/api/sprint-k/${projectId}/engineering-controls/${id}/verify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(wirePayload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as {
    ok: true;
    entry: EngineeringControlVerificationAPI;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §61-63 — Encuesta de Percepción + Índice de Cultura Preventiva
// ────────────────────────────────────────────────────────────────────────
//
// Wraps:
//   GET  /api/sprint-k/:projectId/culture-pulse           snapshot actual
//   GET  /api/sprint-k/:projectId/culture-pulse/history   últimas 6 olas
//   POST /api/sprint-k/:projectId/culture-pulse/survey
//   POST /api/sprint-k/:projectId/culture-pulse/survey/:id/respond
//
// PRIVACIDAD: el endpoint de respuestas NO requiere ni acepta
// `responderUid`/`responderHash` desde el cliente. El servidor deriva
// el hash a partir del token verificado (uid + surveyId). La respuesta
// individual se persiste anónimamente y el snapshot sólo expone
// agregados.

export type CulturePulseQuestionKey =
  | 'felt_safe_today'
  | 'manager_listens'
  | 'free_to_stop'
  | 'reported_incident_safely'
  | 'has_resources_to_be_safe';

export interface CulturePulseSnapshot {
  surveyId: string | null;
  status: 'open' | 'closed' | null;
  openAt: string | null;
  closeAt: string | null;
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  totalResponses: number;
  expectedRespondents: number | null;
  participationRate: number | null;
  punitiveCulturedFlagged: boolean;
  byQuestion: Record<CulturePulseQuestionKey, number>;
  topConcerns: Array<{
    key: CulturePulseQuestionKey;
    label: string;
    score: number;
  }>;
  topStrengths: Array<{
    key: CulturePulseQuestionKey;
    label: string;
    score: number;
  }>;
  hasResponded: boolean;
  /**
   * Codex P1 #3 (PR #323) — Anonymity threshold. When `true`, all
   * derived aggregates (`cultureIndex`, `level`, `byQuestion`,
   * `topConcerns`, `topStrengths`, `participationRate`, `punitiveCulturedFlagged`)
   * are zeroed/empty and the UI must show a "waiting for enough
   * responses" placeholder to preserve respondent anonymity.
   */
  insufficientResponses?: boolean;
  /** Current response count, exposed when `insufficientResponses=true`. */
  currentCount?: number;
  /** Minimum responses required before aggregates are revealed. */
  threshold?: number;
}

export interface CulturePulseResponse {
  snapshot: CulturePulseSnapshot;
}

export function useCulturePulse(projectId: string | null) {
  return useEndpoint<CulturePulseResponse>(
    projectId ? `/api/sprint-k/${projectId}/culture-pulse` : null,
  );
}

export interface CulturePulseHistoryPoint {
  surveyId: string;
  openAt: string;
  closeAt: string | null;
  cultureIndex: number;
  totalResponses: number;
  level: 'low' | 'fair' | 'good' | 'strong';
}

export interface CulturePulseHistoryResponse {
  history: CulturePulseHistoryPoint[];
}

export function useCulturePulseHistory(projectId: string | null) {
  return useEndpoint<CulturePulseHistoryResponse>(
    projectId ? `/api/sprint-k/${projectId}/culture-pulse/history` : null,
  );
}

export interface CulturePulseSchedulePayload {
  surveyId: string;
  openAt: string;
  closeAt: string;
  title?: string;
  expectedRespondents?: number;
}

export async function scheduleCulturePulse(
  projectId: string,
  payload: CulturePulseSchedulePayload,
): Promise<{ ok: true }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/culture-pulse/survey`, {
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

export interface CulturePulseResponsePayload {
  workerRole: string;
  area: string;
  answers: Record<CulturePulseQuestionKey, number>;
}

export async function submitCulturePulseResponse(
  projectId: string,
  surveyId: string,
  payload: CulturePulseResponsePayload,
): Promise<{ ok: true }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/culture-pulse/survey/${surveyId}/respond`,
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
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────
// Fase §185-190 — Base de Conocimiento + Curador + Obsolescencia
// ────────────────────────────────────────────────────────────────────────
//
// Wraps GET/POST /api/sprint-k/:projectId/knowledge-base + use +
// flag-obsolete. The entries reuse the engine's `KnowledgeArticle`
// shape extended with `sourceType` and `obsoleteReason`/`obsoleteAt`
// so the page can render the "reutilización" indicator (sourceType ===
// 'lesson' links back to F.12) plus the curator's "obsolete" warning.

export type KbCategory =
  | 'glossary'
  | 'faq'
  | 'procedure'
  | 'guide'
  | 'norm_summary';

export type KbSourceType = 'lesson' | 'procedure' | 'standard' | 'experience';

export interface KnowledgeEntry {
  id: string;
  kind: KbCategory;
  title: string;
  content: string;
  tags: string[];
  lastReviewedAt: string;
  viewCount: number;
  averageRating?: number;
  isObsolete: boolean;
  authorUid: string;
  sourceType?: KbSourceType;
  obsoleteReason?: string;
  obsoleteAt?: string;
  /** Present only when the response included a search hit. */
  score?: number;
}

export interface KnowledgeBaseResponse {
  entries: KnowledgeEntry[];
  searched: boolean;
  category: KbCategory | null;
}

export interface UseKnowledgeBaseOptions {
  category?: KbCategory;
  search?: string;
}

export function useKnowledgeBase(
  projectId: string | null,
  opts: UseKnowledgeBaseOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.category) qs.set('category', opts.category);
    if (opts.search) qs.set('search', opts.search);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/knowledge-base${query ? `?${query}` : ''}`;
  }
  return useEndpoint<KnowledgeBaseResponse>(path);
}

export interface KbEntryCreatePayload {
  title: string;
  content: string;
  category?: KbCategory;
  tags?: string[];
  sourceType?: KbSourceType;
}

export async function createKbEntry(
  projectId: string,
  payload: KbEntryCreatePayload,
): Promise<{ entry: KnowledgeEntry }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/knowledge-base`, {
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
  return (await res.json()) as { entry: KnowledgeEntry };
}

export async function useKbEntry(
  projectId: string,
  entryId: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/knowledge-base/${entryId}/use`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

export async function flagKbObsolete(
  projectId: string,
  entryId: string,
  reason: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/knowledge-base/${entryId}/flag-obsolete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §195-200 — Ciclo PDCA + No Conformidades (ISO 45001 §10.2)
// ────────────────────────────────────────────────────────────────────────
//
// Wraps the /api/sprint-k/:projectId/pdca/* family. The page renders a
// kanban-style board (Plan/Do/Check/Act) over the cycle list and the
// summary card consumes `usePdcaSummary` for counts + closure rate.

export type PdcaStage = 'plan' | 'do' | 'check' | 'act';

export type PdcaOrigin = 'audit' | 'incident' | 'finding' | 'inspection';

export interface PdcaEntry {
  kind: PdcaStage;
  activityId: string;
  notes: string;
  ownerUid: string;
  startedAt: string;
  completedAt?: string;
  evidence?: string[];
  efficacyScore?: number;
}

export interface PdcaCycleRecord {
  id: string;
  currentStage: PdcaStage;
  stages: PdcaEntry[];
  cycleNumber: number;
  nonConformityId?: string;
  origin?: PdcaOrigin;
  ownerUid?: string;
  createdAt?: string;
  createdByUid?: string;
}

export interface PdcaNonConformityRecord {
  id: string;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  description: string;
  location: string;
  detectedAt: string;
  taskId?: string;
  responsibleUid: string;
  status: 'open' | 'in_progress' | 'closed' | 'verified_effective' | 'reoccurred';
  correctiveActionId?: string;
  closedAt?: string;
  verifiedEffectiveAt?: string;
  reoccurredAt?: string;
}

export interface PdcaSummaryResponse {
  summary: {
    total: number;
    byPhase: Record<PdcaStage, number>;
    closedCycles: number;
    closureRate: number;
  };
}

export interface PdcaCyclesResponse {
  cycles: PdcaCycleRecord[];
}

export interface PdcaNonConformitiesResponse {
  nonConformities: PdcaNonConformityRecord[];
}

export function usePdcaCycles(projectId: string | null) {
  return useEndpoint<PdcaCyclesResponse>(
    projectId ? `/api/sprint-k/${projectId}/pdca/cycles` : null,
  );
}

export function usePdcaSummary(projectId: string | null) {
  return useEndpoint<PdcaSummaryResponse>(
    projectId ? `/api/sprint-k/${projectId}/pdca/summary` : null,
  );
}

export function usePdcaNonConformities(projectId: string | null) {
  return useEndpoint<PdcaNonConformitiesResponse>(
    projectId ? `/api/sprint-k/${projectId}/pdca/non-conformities` : null,
  );
}

export interface PdcaCreatePayload {
  id: string;
  nonConformityId: string;
  origin: PdcaOrigin;
  ownerUid: string;
  notes?: string;
  startedAt?: string;
}

export async function createPdcaCycle(
  projectId: string,
  payload: PdcaCreatePayload,
): Promise<PdcaCycleRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/pdca/cycles`, {
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
  const json = (await res.json()) as { ok: true; cycle: PdcaCycleRecord };
  return json.cycle;
}

export interface PdcaAdvancePayload {
  evidence: string[];
  notes?: string;
  efficacyScore?: number;
}

export async function advancePdcaPhase(
  projectId: string,
  cycleId: string,
  payload: PdcaAdvancePayload,
): Promise<PdcaCycleRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/pdca/cycles/${cycleId}/advance`,
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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
    };
    throw new Error(body.reason ?? body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; cycle: PdcaCycleRecord };
  return json.cycle;
}

export interface PdcaNonConformityPayload {
  id: string;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  description: string;
  location: string;
  detectedAt?: string;
  taskId?: string;
  responsibleUid: string;
}

export async function createPdcaNonConformity(
  projectId: string,
  payload: PdcaNonConformityPayload,
): Promise<PdcaNonConformityRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/pdca/non-conformities`,
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
  const json = (await res.json()) as {
    ok: true;
    nonConformity: PdcaNonConformityRecord;
  };
  return json.nonConformity;
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo
// ────────────────────────────────────────────────────────────────────────
//
// Hooks fetch-based para los 5 endpoints de proveedores:
//   GET  /:projectId/suppliers?riskLevel=low|medium|high|all
//   POST /:projectId/suppliers
//   POST /:projectId/suppliers/:id/incidents
//   POST /:projectId/suppliers/:id/audits
//   GET  /:projectId/suppliers/ranking
//
// El servidor calcula `score` + `riskLevel` + `trend` desde el motor
// determinístico `supplierScoring`. El frontend NO recalcula — sólo
// presenta y filtra.

export type SupplierRiskLevel = 'low' | 'medium' | 'high';
export type SupplierRiskFilter = SupplierRiskLevel | 'all';
export type SupplierTrend = 'improving' | 'stable' | 'worsening';
export type SupplierIncidentSeverity = 'near_miss' | 'incident';

export interface SupplierIncidentRecord {
  id: string;
  occurredAt: string;
  severity: SupplierIncidentSeverity;
  description: string;
  recordedByUid: string;
}

export interface SupplierAuditRecord {
  id: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
  recordedByUid: string;
}

export interface SupplierView {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: SupplierRiskLevel;
  trend: SupplierTrend;
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
}

export interface SuppliersResponse {
  suppliers: SupplierView[];
  total: number;
}

export interface SupplierRankingEntry extends SupplierView {
  rank: number;
  breakdown: ScoreBreakdown;
}

export interface SupplierRankingResponse {
  ranking: SupplierRankingEntry[];
  total: number;
}

export function useSuppliers(
  projectId: string | null,
  opts: { riskLevel?: SupplierRiskFilter } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.riskLevel && opts.riskLevel !== 'all') {
      qs.set('riskLevel', opts.riskLevel);
    } else if (opts.riskLevel === 'all') {
      qs.set('riskLevel', 'all');
    }
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/suppliers${query ? `?${query}` : ''}`;
  }
  return useEndpoint<SuppliersResponse>(path);
}

export function useSupplierRanking(projectId: string | null) {
  return useEndpoint<SupplierRankingResponse>(
    projectId ? `/api/sprint-k/${projectId}/suppliers/ranking` : null,
  );
}

export interface RegisterSupplierPayload {
  id?: string;
  name: string;
  taxId: string;
  services: string[];
  criticalRoles?: string[];
  active?: boolean;
}

export async function registerSupplier(
  projectId: string,
  payload: RegisterSupplierPayload,
): Promise<SupplierView> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/suppliers`, {
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
  const data = (await res.json()) as { ok: true; supplier: SupplierView };
  return data.supplier;
}

export interface RecordSupplierIncidentPayload {
  id?: string;
  occurredAt: string;
  severity: SupplierIncidentSeverity;
  description: string;
}

export async function recordSupplierIncident(
  projectId: string,
  supplierId: string,
  payload: RecordSupplierIncidentPayload,
): Promise<SupplierIncidentRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/suppliers/${supplierId}/incidents`,
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
  const data = (await res.json()) as { ok: true; incident: SupplierIncidentRecord };
  return data.incident;
}

export interface RecordSupplierAuditPayload {
  id?: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
}

export async function recordSupplierAudit(
  projectId: string,
  supplierId: string,
  payload: RecordSupplierAuditPayload,
): Promise<SupplierAuditRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/suppliers/${supplierId}/audits`,
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
  const data = (await res.json()) as { ok: true; audit: SupplierAuditRecord };
  return data.audit;
}
