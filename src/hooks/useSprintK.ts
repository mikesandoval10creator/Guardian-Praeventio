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
import type { PreventiveObjective } from '../services/annualReview/annualSgiReview';
// Tipos del engine residual ya no se importan aquí; viven en useResidualRisk.ts (2026-05-18).
import type {
  SupervisionDecision,
  SupervisionDecisionKind,
  SupervisorRanking,
} from '../services/leadership/supervisionDecisionTrail';
import type { DataConfidenceReport } from '../services/dataConfidence/dataConfidencePanel';

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

// §214-215 Positive Observations hooks migrados a `usePositiveObservations.ts` (2026-05-18).
export {
  usePositiveObservationsForWorker,
  type PositiveObservationsResponse,
} from './usePositiveObservations';

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

// F.12 Lessons Learned hook migrado a `src/hooks/useLessonsLearned.ts`
// (2026-05-18) — re-export para mantener compatibilidad mientras los
// consumers se actualizan al import dedicado.
export {
  useLessons,
  createLesson,
  type LessonsResponse,
  type LessonPayload,
} from './useLessonsLearned';

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

// PositiveObservationPayload + createPositiveObservation migrados a
// `usePositiveObservations.ts` (2026-05-18). Re-export para compatibilidad:
export {
  createPositiveObservation,
  type PositiveObservationPayload,
} from './usePositiveObservations';

// LessonPayload + createLesson migrados a `useLessonsLearned.ts` (2026-05-18).
// Se re-exportan desde la cabecera de este archivo.

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

// F.21 Pre-Shift Risk hook migrado a usePreShiftRisk.ts (2026-05-18).
export {
  usePreShiftRisk,
  type PreShiftRiskResponse,
  type PreShiftRiskOptions,
} from "./usePreShiftRisk";

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

// F.5 QR Signature mutators migrados a useQrSignature.ts (2026-05-18).
export {
  requestQrSignatureChallenge,
  persistQrAcknowledgement,
  type QrAcknowledgementPayload,
} from "./useQrSignature";

// F.26 Maturity Index hooks migrados a useMaturityIndex.ts (2026-05-18).
export {
  usePreventionMaturity,
  type MaturityIndexResponse,
} from "./useMaturityIndex";

// F.15 Work Permits hooks migrados a useWorkPermits.ts (2026-05-18).
export {
  useWorkPermits,
  createWorkPermit,
  signWorkPermit,
  closeWorkPermit,
  type WorkPermitsResponse,
  type WorkPermitCreatePayload,
  type WorkPermitSignPayload,
  type WorkPermitChecklistItemPayload,
} from "./useWorkPermits";

// F.13 Radar de Riesgos Repetidos migrado a `useRepeatingRisks.ts` (2026-05-18).
export {
  useRepeatingRisks,
  type RepeatingRisksResponse,
} from './useRepeatingRisks';

// F.20 Drills hooks migrados a useDrillsManager.ts (2026-05-18).
export {
  useDrills,
  useDrill,
  planDrill,
  executeDrill,
  type DrillKindAPI,
  type DrillStatusAPI,
  type DrillLevelAPI,
  type DrillRecord,
  type DrillsResponse,
  type DrillResponse,
  type DrillPlanPayload,
  type DrillExecutePayload,
} from "./useDrillsManager";

// F.7 CPHS Minute hook migrado a useCphsMinute.ts (2026-05-18).
export {
  useCphsDraftMinute,
  type CphsDraftMinuteResponse,
} from "./useCphsMinute";

// F.16 Worker Readiness hook migrado a useWorkerReadiness.ts (2026-05-18).
export {
  useWorkerReadiness,
  type WorkerReadinessResponse,
} from "./useWorkerReadiness";

// §74-78 Emergency Brigade hooks migrados a useEmergencyBrigade.ts (2026-05-18).
export {
  useEmergencyBrigade,
  addBrigadeMember,
  addBrigadeResource,
  inspectResource,
  type EmergencyBrigadeSnapshotResponse,
  type AddBrigadeMemberPayload,
  type AddBrigadeResourcePayload,
  type InspectResourcePayload,
} from "./useEmergencyBrigade";

// §214-215 listing + balance hooks migrados a `usePositiveObservations.ts` (2026-05-18).
export {
  usePositiveObservations,
  usePositiveObservationBalance,
  type PositiveObservationPeriod,
  type PositiveObservationsPageInfo,
  type PositiveObservationsListResponse,
  type PositiveObservationBalanceResponse,
} from './usePositiveObservations';

// F.6 Offline Inspections hooks migrados a useOfflineInspections.ts (2026-05-18).
export {
  useInspections,
  useInspection,
  startInspection,
  addObservation,
  completeInspection,
  type InspectionStatusAPI,
  type InspectionObservationRecord,
  type InspectionRecord,
  type InspectionsResponse,
  type InspectionResponse,
  type InspectionStartPayload,
  type InspectionObservationPayload,
} from "./useOfflineInspections";

// §42-44 Engineering Controls hooks migrados a useEngineeringControls.ts (2026-05-18).
export {
  useEngineeringControls,
  createEngineeringControl,
  verifyControl,
  type EngineeringControlLevelAPI,
  type EngineeringControlVerificationAPI,
  type EngineeringControlAPI,
  type EngineeringControlsResponse,
  type EngineeringControlsOptions,
  type EngineeringControlCreatePayload,
  type EngineeringControlVerifyPayload,
} from "./useEngineeringControls";

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

// ────────────────────────────────────────────────────────────────────────
// Sprint K §291-295 — Revisión Anual del SGI (ISO 45001 §9.3)
// ────────────────────────────────────────────────────────────────────────

export interface AnnualReviewEvidence {
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
  attachedAt: string;
  attachedByUid: string;
}

export interface AnnualReviewSnapshot {
  fiscalYear: number;
  tenantId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  updatedByUid: string;
  objectives: PreventiveObjective[];
  evidences: AnnualReviewEvidence[];
  analysis: string;
  conclusion: string | null;
  signedOffByUid: string | null;
  signedOffByName: string | null;
  concludedAt: string | null;
  isConcluded: boolean;
}

export interface AnnualReviewResponse {
  year: number;
  exists: boolean;
  snapshot: AnnualReviewSnapshot | null;
}

export function useCurrentAnnualReview(
  projectId: string | null,
  opts: { year?: number } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (typeof opts.year === 'number' && Number.isInteger(opts.year)) {
      qs.set('year', String(opts.year));
    }
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/annual-review/current${query ? `?${query}` : ''}`;
  }
  return useEndpoint<AnnualReviewResponse>(path);
}

async function annualReviewPost<T>(
  projectId: string,
  segment: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/annual-review/${segment}`, {
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
  return (await res.json()) as T;
}

export interface SetObjectivesInput {
  year: number;
  objectives: Array<{
    id: string;
    title: string;
    description?: string;
    metric:
      | 'count_reduction'
      | 'count_increase'
      | 'percent_completion'
      | 'percent_reduction';
    baseline: number;
    target: number;
    currentValue?: number;
    deadline: string;
    ownerUid: string;
    status?:
      | 'planned'
      | 'in_progress'
      | 'on_track'
      | 'at_risk'
      | 'achieved'
      | 'missed';
    linkedActionIds?: string[];
    evidenceUrls?: string[];
  }>;
  /** Optional analysis text snapshot. */
  analysis?: string;
}

export async function setAnnualReviewObjectives(
  projectId: string,
  input: SetObjectivesInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{ ok: true; snapshot: AnnualReviewSnapshot }>(
    projectId,
    'objectives',
    input as unknown as Record<string, unknown>,
  );
  return json.snapshot;
}

export interface AttachEvidenceInput {
  year: number;
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind?: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
}

export async function attachAnnualReviewEvidence(
  projectId: string,
  input: AttachEvidenceInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{ ok: true; snapshot: AnnualReviewSnapshot }>(
    projectId,
    'evidence',
    input as unknown as Record<string, unknown>,
  );
  return json.snapshot;
}

export interface ConcludeReviewInput {
  year: number;
  conclusion: string;
  signedOffByUid: string;
  signedOffByName: string;
}

export async function concludeAnnualReview(
  projectId: string,
  input: ConcludeReviewInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{ ok: true; snapshot: AnnualReviewSnapshot }>(
    projectId,
    'conclude',
    input as unknown as Record<string, unknown>,
  );
  return json.snapshot;
}

// §296-301 Residual Risk hooks migrados a useResidualRisk.ts (2026-05-18).
export {
  useResidualRisks,
  useSuspiciousRisks,
  registerResidualRisk,
  acceptResidualRisk,
  type StoredResidualRisk,
  type ResidualRiskPayload,
  type ResidualControlEffectiveness,
  type ResidualRisksResponse,
} from "./useResidualRisk";

// ────────────────────────────────────────────────────────────────────────
// Sprint K §276-277 — Bitácora de decisiones de supervisión + Ranking
// ────────────────────────────────────────────────────────────────────────

export type LeadershipPeriod = '30d' | '90d' | 'all';

export interface LeadershipDecisionsResponse {
  decisions: SupervisionDecision[];
}

export interface LeadershipRankingResponse {
  ranking: SupervisorRanking[];
}

export interface LeadershipDecisionPayload {
  id?: string;
  decidedAt?: string;
  kind: SupervisionDecisionKind;
  context: string;
  rationale: string;
  involvedRef?: {
    kind: 'TASK' | 'WORKER' | 'FINDING' | 'EXCEPTION';
    id: string;
  };
  outcome?: {
    positive: boolean;
    description: string;
    recordedAt: string;
  };
}

export function useLeadershipDecisions(
  projectId: string | null,
  opts: { supervisorUid?: string; period?: LeadershipPeriod } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.supervisorUid) qs.set('supervisorUid', opts.supervisorUid);
    if (opts.period) qs.set('period', opts.period);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/leadership/decisions${query ? `?${query}` : ''}`;
  }
  return useEndpoint<LeadershipDecisionsResponse>(path);
}

export function useLeadershipRanking(
  projectId: string | null,
  period: LeadershipPeriod = '90d',
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    qs.set('period', period);
    path = `/api/sprint-k/${projectId}/leadership/ranking?${qs.toString()}`;
  }
  return useEndpoint<LeadershipRankingResponse>(path);
}

export async function recordLeadershipDecision(
  projectId: string,
  payload: LeadershipDecisionPayload,
): Promise<SupervisionDecision> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/leadership/decisions`,
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
    decision: SupervisionDecision;
  };
  return json.decision;
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §131-138 — Cierre de Proyecto + Lecciones Transferibles +
//                      Decisiones Críticas + Resúmenes Multi-Rol
// ────────────────────────────────────────────────────────────────────────
//
// Hooks delgados sobre /api/sprint-k/:projectId/closure/*. Mantienen
// el patrón useEndpoint para queries y funciones async para mutaciones.

export type ClosureRole = 'worker' | 'supervisor' | 'gerencia';

export interface ClosureState {
  status: 'open' | 'initiated' | 'finalized';
  initiatedAt: string | null;
  initiatedByUid: string | null;
  finalizedAt: string | null;
  finalizedByUid: string | null;
}

export interface ClosureStatusResponse {
  state: ClosureState;
  readinessPercent: number;
  canClose: boolean;
  blockers: string[];
  warnings: string[];
  pending: {
    openIncidents: number;
    openActions: number;
    openPermits: number;
    lessonsCaptured: number;
    decisionsLogged: number;
  };
}

export function useClosureStatus(projectId: string | null) {
  return useEndpoint<ClosureStatusResponse>(
    projectId ? `/api/sprint-k/${projectId}/closure/status` : null,
  );
}

export interface ClosureSummaryResponse {
  summary: {
    audience: 'management' | 'client' | 'operations' | 'regulatory';
    highlights: Array<{ label: string; value: string }>;
    narrative: string;
  };
  role: string;
  audience: string;
  counts: {
    lessons: number;
    decisions: number;
    incidents: number;
    criticalIncidents: number;
  };
}

export function useClosureSummary(
  projectId: string | null,
  role: ClosureRole,
) {
  const path =
    projectId !== null
      ? `/api/sprint-k/${projectId}/closure/summary?role=${encodeURIComponent(role)}`
      : null;
  return useEndpoint<ClosureSummaryResponse>(path);
}

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function initiateClosure(projectId: string): Promise<ClosureState> {
  const json = await authedPost<{ ok: true; state: ClosureState }>(
    `/api/sprint-k/${projectId}/closure/initiate`,
    {},
  );
  return json.state;
}

export interface CaptureLessonPayload {
  summary: string;
  preventiveAction: string;
  industry: string;
  riskCategories?: string[];
  tags?: string[];
}

export interface CapturedLesson {
  id: string;
  summary: string;
  preventiveAction: string;
  riskCategories: string[];
  tags: string[];
  industry: string;
  capturedAt: string;
  capturedByUid: string;
  publishedLessonId: string | null;
}

export async function captureLesson(
  projectId: string,
  payload: CaptureLessonPayload,
): Promise<CapturedLesson> {
  const json = await authedPost<{ ok: true; lesson: CapturedLesson }>(
    `/api/sprint-k/${projectId}/closure/lessons`,
    payload,
  );
  return json.lesson;
}

export interface LogDecisionPayload {
  decidedAt: string;
  context: string;
  decision: string;
  outcome: 'positive' | 'neutral' | 'negative';
  decidedByUid?: string;
}

export interface LoggedDecision {
  id: string;
  decidedAt: string;
  context: string;
  decision: string;
  decidedByUid: string;
  outcome: 'positive' | 'neutral' | 'negative';
  loggedAt: string;
  loggedByUid: string;
}

export async function logDecision(
  projectId: string,
  payload: LogDecisionPayload,
): Promise<LoggedDecision> {
  const json = await authedPost<{ ok: true; decision: LoggedDecision }>(
    `/api/sprint-k/${projectId}/closure/decisions`,
    payload,
  );
  return json.decision;
}

export async function finalizeClosure(projectId: string): Promise<ClosureState> {
  const json = await authedPost<{ ok: true; state: ClosureState }>(
    `/api/sprint-k/${projectId}/closure/finalize`,
    {},
  );
  return json.state;
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §69-71 — Conducción Segura + Rutas Críticas + Alertas Ruta
// ────────────────────────────────────────────────────────────────────────

export type DrivingRouteCriticality = 'low' | 'medium' | 'high' | 'extreme';
export type DrivingRouteHazard =
  | 'cliff'
  | 'rockfall'
  | 'flood_zone'
  | 'sharp_curves'
  | 'limited_visibility'
  | 'wildlife'
  | 'mining_traffic'
  | 'icy_surface'
  | 'fog'
  | 'debris'
  | 'accident_reported';
export type DrivingRouteAlertKind =
  | 'icy'
  | 'fog'
  | 'debris'
  | 'accident_reported'
  | 'weather'
  | 'other';
export type DrivingRoutesStatus = 'active' | 'critical' | 'all';

export interface DrivingRouteAlert {
  kind: DrivingRouteAlertKind;
  note: string | null;
  flaggedAt: string;
  flaggedBy: string;
  resolvedAt: string | null;
}

export interface DrivingRoute {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: DrivingRouteCriticality;
  hazards: DrivingRouteHazard[];
  weatherSensitive: boolean;
  recommendedMaxSpeedKmh: number;
  activeAlert: DrivingRouteAlert | null;
  alertHistory: DrivingRouteAlert[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface DrivingDriver {
  workerUid: string;
  licenseClass: string;
  licenseExpiresAt: string;
  yearsExperience: number;
  incidents12m: number;
  speedingEvents30d: number;
  fatigueScore: number;
  hoursThisWeek: number;
  lastJourneyAt: string | null;
  updatedAt: string;
}

export interface DrivingRankingEntry {
  workerUid: string;
  safetyScore: number;
  level: 'critical' | 'poor' | 'fair' | 'good' | 'excellent';
  canOperate: boolean;
  blockers: string[];
  fatigueScore: number;
  hoursThisWeek: number;
  licenseExpiresAt: string;
}

export interface DrivingRoutesResponse {
  routes: DrivingRoute[];
}
export interface DrivingDriversResponse {
  drivers: DrivingDriver[];
}
export interface DrivingRankingResponse {
  ranking: DrivingRankingEntry[];
}

export function useDrivingRoutes(
  projectId: string | null,
  opts: { status?: DrivingRoutesStatus } = {},
// F.29 — Indicadores de Tendencia de Incidentes
// ────────────────────────────────────────────────────────────────────────
//
// Time series + leading indicators. Hook puro fetch — el endpoint
// agrega y normaliza, el cliente solo presenta.

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
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/driving/routes${query ? `?${query}` : ''}`;
  }
  return useEndpoint<DrivingRoutesResponse>(path);
}

export function useDrivingDrivers(projectId: string | null) {
  return useEndpoint<DrivingDriversResponse>(
    projectId ? `/api/sprint-k/${projectId}/driving/drivers` : null,
  );
}

export function useDrivingRanking(projectId: string | null) {
  return useEndpoint<DrivingRankingResponse>(
    projectId ? `/api/sprint-k/${projectId}/driving/ranking` : null,
  );
}

export interface DrivingRoutePayload {
  id?: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: DrivingRouteCriticality;
  hazards?: DrivingRouteHazard[];
  weatherSensitive?: boolean;
  recommendedMaxSpeedKmh?: number;
}

export async function registerRoute(
  projectId: string,
  payload: DrivingRoutePayload,
): Promise<DrivingRoute> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/driving/routes`, {
// Sprint K §244-250 — Aprendices + Mentoría + Autorización Progresiva
// ────────────────────────────────────────────────────────────────────────
//
// Hooks que envuelven los 5 endpoints declarados en sprintK.ts:
//   useApprentices(projectId)            → GET  /apprentices
//   useMentorAvailability(projectId)     → GET  /mentors/availability
//   registerApprentice(...)              → POST /apprentices
//   authorizeApprentice(...)             → POST /apprentices/:uid/authorize
//   recordExposure(...)                  → POST /apprentices/:uid/expose
//
// Tipos espejo de los shapes en el server. NO importamos del módulo
// de servicio directamente (`apprenticeshipProgressService`) porque
// estos shapes son UI-friendly (incluyen `currentLevel`, `progress`
// y `recentExposures` derivados server-side) — el servicio canónico
// devuelve formas más crudas para uso determinístico interno.

export type ApprenticeAuthLevel =
  | 'none'
  | 'observer'
  | 'supervised'
  | 'autonomous';

export type ApprenticeRole =
  | 'aprendiz'
  | 'nuevo_ingreso'
  | 'practicante'
  | 'trabajador_general';

export type ApprenticeExposureOutcome = 'success' | 'partial' | 'unsafe';

export interface ApprenticeRecentExposure {
  id: string;
  taskKind: string;
  recordedAt: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
}

export interface ApprenticeRecord {
  workerUid: string;
  mentorUid: string;
  role: ApprenticeRole;
  startDate: string;
  currentLevel: ApprenticeAuthLevel;
  taskAuthorizations: Record<string, ApprenticeAuthLevel>;
  progress: number;
  recentExposures: ApprenticeRecentExposure[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface ApprenticesResponse {
  apprentices: ApprenticeRecord[];
}

export interface MentorAvailabilityEntry {
  mentorUid: string;
  apprenticeUids: string[];
  currentLoad: number;
  maxLoad: number;
  available: boolean;
  availableSlots: number;
}

export interface MentorAvailabilityResponse {
  mentors: MentorAvailabilityEntry[];
  maxLoad: number;
}

export function useApprentices(projectId: string | null) {
  return useEndpoint<ApprenticesResponse>(
    projectId ? `/api/sprint-k/${projectId}/apprentices` : null,
  );
}

export function useMentorAvailability(projectId: string | null) {
  return useEndpoint<MentorAvailabilityResponse>(
    projectId ? `/api/sprint-k/${projectId}/mentors/availability` : null,
  );
}

export interface RegisterApprenticePayload {
  uid: string;
  mentorUid: string;
  role: ApprenticeRole;
  startDate: string;
}

export async function registerApprentice(
  projectId: string,
  payload: RegisterApprenticePayload,
): Promise<ApprenticeRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/apprentices`, {
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
  const json = (await res.json()) as { ok: true; route: DrivingRoute };
  return json.route;
}

export interface DrivingRouteAlertPayload {
  kind: DrivingRouteAlertKind;
  note?: string;
  resolve?: boolean;
}

export async function flagRouteAlert(
  projectId: string,
  routeId: string,
  payload: DrivingRouteAlertPayload,
): Promise<DrivingRouteAlert | null> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/driving/routes/${routeId}/alert`,
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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      mentorUid?: string;
      currentLoad?: number;
    };
    // Surface the mentor_at_capacity case with a friendly message so
    // the UI can render it directly instead of "http_409".
    if (body.error === 'mentor_at_capacity') {
      throw new Error(
        `mentor_at_capacity: ${body.mentorUid ?? ''} (load=${body.currentLoad ?? '?'})`,
      );
    }
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as {
    ok: true;
    activeAlert: DrivingRouteAlert | null;
  };
  return json.activeAlert;
}

export interface DrivingJourneyPayload {
  action: 'start' | 'end';
  journeyId?: string;
  startedAt?: string;
  endedAt?: string;
  hours?: number;
  routeId?: string;
  note?: string;
}

export interface DrivingJourney {
  id: string;
  workerUid: string;
  startedAt: string;
  endedAt: string | null;
  hours: number | null;
  routeId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export async function recordJourney(
  projectId: string,
  driverUid: string,
  payload: DrivingJourneyPayload,
): Promise<DrivingJourney> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/driving/drivers/${driverUid}/journey`,
    apprentice: ApprenticeRecord;
  };
  return json.apprentice;
}

export interface AuthorizeApprenticePayload {
  taskKind: string;
  toLevel: Exclude<ApprenticeAuthLevel, 'none'>;
  signedByUid: string;
  evidence: string;
}

export interface AuthorizeApprenticeResult {
  ok: true;
  workerUid: string;
  taskKind: string;
  toLevel: Exclude<ApprenticeAuthLevel, 'none'>;
  currentLevel: ApprenticeAuthLevel;
  progress: number;
}

export async function authorizeApprentice(
  projectId: string,
  uid: string,
  payload: AuthorizeApprenticePayload,
): Promise<AuthorizeApprenticeResult> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/apprentices/${uid}/authorize`,
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
  const json = (await res.json()) as { ok: true; journey: DrivingJourney };
  return json.journey;
}

// ────────────────────────────────────────────────────────────────────────
// Sprint K §211-213 — Reportes Confidenciales (Ley Karin 21.643) +
// Canal Denuncias + Detector Represalias
// ────────────────────────────────────────────────────────────────────────

export type ConfidentialReportKindApi =
  | 'harassment'
  | 'safety'
  | 'discrimination'
  | 'violence'
  | 'conflict_of_interest'
  | 'other';

export type ConfidentialReportSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ConfidentialReportStatusApi = 'open' | 'investigating' | 'resolved';

export interface ConfidentialReportApi {
  id: string;
  projectId: string;
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  /** Solo presente si allowsIdentity=true. NUNCA expuesto a no-autorizados. */
  reporterUid?: string;
  /** Pseudónimo one-way. */
  reporterAnonHash: string;
  status: ConfidentialReportStatusApi;
  submittedAt: string;
  firstResponseDueAt: string;
  resolveDueAt: string;
  handlerUid?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface ConfidentialReportsListResponse {
  reports: ConfidentialReportApi[];
  /** 'investigator' = ve todos. 'reporter' = solo los suyos. */
  role: 'investigator' | 'reporter';
}

export interface RetaliationAlertApi {
  reportId: string;
  reporterAnonHash: string;
  reportSubmittedAt: string;
  actionAt: string;
  actionKind:
    | 'termination'
    | 'shift_change'
    | 'role_demotion'
    | 'salary_decrease'
    | 'transfer';
  daysFromReport: number;
  severity: 'high' | 'critical';
}

export interface RetaliationAlertsResponse {
  alerts: RetaliationAlertApi[];
  windowDays: number;
}

export interface ConfidentialReportFilter {
  status?: ConfidentialReportStatusApi;
  category?: ConfidentialReportKindApi;
}

export function useConfidentialReports(
  projectId: string | null,
  opts: ConfidentialReportFilter = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.category) qs.set('category', opts.category);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/confidential-reports${query ? `?${query}` : ''}`;
  }
  return useEndpoint<ConfidentialReportsListResponse>(path);
}

export function useRetaliationAlerts(projectId: string | null) {
  return useEndpoint<RetaliationAlertsResponse>(
    projectId ? `/api/sprint-k/${projectId}/confidential-reports/retaliation-alerts` : null,
  );
}

export interface SubmitConfidentialReportPayload {
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  /**
   * Solo el server respeta este campo cuando allowsIdentity=true. Si
   * allowsIdentity=false, el server JAMÁS lo persiste — pasamos el
   * uid igual aquí únicamente porque el flujo identificado lo necesita.
   */
  reporterUid?: string;
}

export async function submitConfidentialReport(
  projectId: string,
  payload: SubmitConfidentialReportPayload,
): Promise<{
  ok: true;
  report: ConfidentialReportApi;
  sla: { firstResponseDueAt: string; resolveDueAt: string; legalReference: string };
}> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  // Defensa cliente: si allowsIdentity=false NO mandamos reporterUid.
  // El server tiene la misma defensa pero el principio de mínima
  // exposición pide no transmitirlo nunca en ese caso.
  const sanitized: SubmitConfidentialReportPayload = payload.allowsIdentity
    ? payload
    : { ...payload, reporterUid: undefined };
  const res = await fetch(`/api/sprint-k/${projectId}/confidential-reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(sanitized),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as {
    ok: true;
    report: ConfidentialReportApi;
    sla: { firstResponseDueAt: string; resolveDueAt: string; legalReference: string };
  };
}

export async function respondToReport(
  projectId: string,
  reportId: string,
  message: string,
// Sprint K §104 — Panel de Confianza de Datos (calidad para IA)
// ────────────────────────────────────────────────────────────────────────
//
// Hooks fetch-based para `/api/sprint-k/:projectId/data-confidence`. El
// patrón es el mismo que useResidualRisks: `useEndpoint<T>` + mutation
// helper (`dismissDataIssue`) que devuelve `void` y no expone el doc
// crudo de Firestore.

export type DataConfidenceSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DataConfidenceDomain =
  | 'workers'
  | 'incidents'
  | 'training'
  | 'epp'
  | 'permits'
  | 'audits';

export interface DataConfidenceIssue {
  id: string;
  domain: DataConfidenceDomain;
  collection: string;
  severity: DataConfidenceSeverity;
  count: number;
  description: string;
  dismissed: boolean;
  dismissedByUid?: string | null;
  dismissedAt?: string | null;
}

export interface DataConfidenceDomainScore {
  name: DataConfidenceDomain;
  score: number;
  observed: number;
  expected: number;
  staleDays: number;
  detail: string;
}

export interface DataConfidenceTrendPoint {
  date: string;
  overallScore: number;
}

export interface DataConfidenceSnapshot {
  generatedAt: string;
  report: DataConfidenceReport;
  domains: DataConfidenceDomainScore[];
  topIssues: DataConfidenceIssue[];
  trend: DataConfidenceTrendPoint[];
}

export interface DataConfidenceRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  target: number;
  domain: DataConfidenceDomain;
}

export interface DataConfidenceRecommendationsResponse {
  generatedAt: string;
  recommendations: DataConfidenceRecommendation[];
}

export function useDataConfidence(projectId: string | null) {
  return useEndpoint<DataConfidenceSnapshot>(
    projectId ? `/api/sprint-k/${projectId}/data-confidence` : null,
  );
}

export function useDataConfidenceRecommendations(projectId: string | null) {
  return useEndpoint<DataConfidenceRecommendationsResponse>(
    projectId ? `/api/sprint-k/${projectId}/data-confidence/recommendations` : null,
  );
}

export async function dismissDataIssue(
  projectId: string,
  issueId: string,
  reason?: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/confidential-reports/${reportId}/respond`,
  return (await res.json()) as AuthorizeApprenticeResult;
}

export interface RecordExposurePayload {
  taskKind: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
  recordedAt?: string;
  notes?: string;
}

export interface RecordExposureResult {
  ok: true;
  exposure: {
    id: string;
    workerUid: string;
    taskKind: string;
    supervisedBy: string;
    outcome: ApprenticeExposureOutcome;
    recordedAt: string;
    notes?: string;
    createdAt: string;
    createdBy: string;
  };
}

export async function recordExposure(
  projectId: string,
  uid: string,
  payload: RecordExposurePayload,
): Promise<RecordExposureResult> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/apprentices/${uid}/expose`,
// Sprint 42 Fase F.18 — Historial Profesional Portátil del Trabajador
// ────────────────────────────────────────────────────────────────────────
//
// Ley 19.628 (Chile) — datos personales del trabajador. El consent vive
// con el worker (no con la cuadrilla) y se respeta en cada lectura.
//
// 3 wrappers:
//   - useWorkerPortableHistory(projectId, workerUid) → bundle reactivo
//   - updatePortableConsent(projectId, workerUid, flags) → POST consent
//   - exportPortableHistory(projectId, workerUid, format) → blob descarga

export interface PortableHistoryConsent {
  allowsPortableExport: boolean;
  includesIncidents: boolean;
  updatedAt: string;
  updatedByUid: string;
}

export interface PortableHistoryTraining {
  id: string;
  trainingCode?: string;
  trainingName?: string;
  obtainedAt?: string;
  expiresAt?: string | null;
  issuer?: string;
  hours?: number;
  projectId?: string;
}

export interface PortableHistoryEppDelivery {
  id: string;
  eppCategory?: string;
  eppModel?: string;
  deliveredAt?: string;
  nextReplacementAt?: string | null;
}

export interface PortableHistoryAptitude {
  id: string;
  category?: string;
  status?: string;
  recordedAt?: string;
  expiresAt?: string | null;
  source?: string;
}

export interface PortableHistoryCriticalRole {
  id: string;
  roleCode?: string;
  roleName?: string;
  startedAt?: string;
  endedAt?: string | null;
  projectId?: string;
}

export interface PortableHistoryIncident {
  id: string;
  occurredAt?: string;
  severity?: string;
  category?: string;
}

export interface PortableHistorySignature {
  id: string;
  documentKind?: string;
  signedAt?: string;
  documentTitle?: string;
}

export interface PortableHistoryBundle {
  schemaVersion: '1.0.0';
  generatedAt: string;
  workerUid: string;
  consent: PortableHistoryConsent;
  identity: {
    fullName: string;
    rut: string;
    email?: string | null;
  };
  trainings: PortableHistoryTraining[];
  eppDeliveries: PortableHistoryEppDelivery[];
  aptitudes: PortableHistoryAptitude[];
  criticalRoles: PortableHistoryCriticalRole[];
  signatures: PortableHistorySignature[];
  incidents: PortableHistoryIncident[];
  disclaimer: string;
}

export interface PortableHistoryResponse {
  bundle: PortableHistoryBundle;
}

export type PortableHistoryFormat = 'json' | 'pdf';

export function useWorkerPortableHistory(
  projectId: string | null,
  workerUid: string | null,
) {
  return useEndpoint<PortableHistoryResponse>(
    projectId && workerUid
      ? `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history`
      : null,
  );
}

export async function updatePortableConsent(
  projectId: string,
  workerUid: string,
  flags: { allowsPortableExport: boolean; includesIncidents: boolean },
): Promise<PortableHistoryConsent> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history/consent`,
    `/api/sprint-k/${projectId}/data-confidence/dismiss/${encodeURIComponent(issueId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
      body: JSON.stringify(payload),
      body: JSON.stringify(flags),
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}
<<<<<<< HEAD

export async function closeReport(
  projectId: string,
  reportId: string,
  resolution: string,
  outcome: 'substantiated' | 'unsubstantiated' | 'transferred' = 'substantiated',
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/confidential-reports/${reportId}/close`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ resolution, outcome }),
  const json = (await res.json()) as { ok: true; consent: PortableHistoryConsent };
  return json.consent;
}

export async function exportPortableHistory(
  projectId: string,
  workerUid: string,
  format: PortableHistoryFormat = 'json',
): Promise<{ blob: Blob; filename: string; checksum: string | null }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history/export?format=${encodeURIComponent(
      format,
    )}`,
    {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
    if (opts.window) qs.set('window', opts.window);
    if (opts.group) qs.set('group', opts.group);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/incidents/trends${query ? `?${query}` : ''}`;
  }
  return useEndpoint<IncidentTrendsResponse>(path);
  return (await res.json()) as RecordExposureResult;
  const blob = await res.blob();
  const ext = format === 'pdf' ? 'pdf' : 'json';
  const filename = `portable-history-${workerUid}.${ext}`;
  const checksum = res.headers.get('X-Portable-History-Checksum');
  return { blob, filename, checksum };
}
=======
>>>>>>> fd84edc6 (feat(data-confidence): §104 Panel Confianza Datos — endpoint + hook + page wired)
