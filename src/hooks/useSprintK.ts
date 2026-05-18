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
// ScoreBreakdown migró con §90-91 a useSuppliers.ts (2026-05-18).
// PreventiveObjective migró con §291-295 a useAnnualReview.ts (2026-05-18).
// Tipos del engine residual ya no se importan aquí; viven en useResidualRisk.ts (2026-05-18).
// SupervisionDecision/Kind/Ranking migraron con §276-277 a useLeadership.ts (2026-05-18).
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

// §61-63 Culture Pulse hooks migrados a useCulturePulse.ts (2026-05-18).
export {
  useCulturePulse,
  useCulturePulseHistory,
  scheduleCulturePulse,
  submitCulturePulseResponse,
  type CulturePulseQuestionKey,
  type CulturePulseSnapshot,
  type CulturePulseResponse,
  type CulturePulseHistoryPoint,
  type CulturePulseHistoryResponse,
  type CulturePulseSchedulePayload,
  type CulturePulseResponsePayload,
} from "./useCulturePulse";

// §185-190 Knowledge Base hooks migrados a useKnowledgeBase.ts (2026-05-18).
export {
  useKnowledgeBase,
  createKbEntry,
  useKbEntry,
  flagKbObsolete,
  type KbCategory,
  type KbSourceType,
  type KnowledgeEntry,
  type KnowledgeBaseResponse,
  type UseKnowledgeBaseOptions,
  type KbEntryCreatePayload,
} from "./useKnowledgeBase";

// §195-200 PDCA hooks migrados a usePdca.ts (2026-05-18).
export {
  usePdcaCycles,
  usePdcaSummary,
  usePdcaNonConformities,
  createPdcaCycle,
  advancePdcaPhase,
  createPdcaNonConformity,
  type PdcaStage,
  type PdcaOrigin,
  type PdcaEntry,
  type PdcaCycleRecord,
  type PdcaNonConformityRecord,
  type PdcaSummaryResponse,
  type PdcaCyclesResponse,
  type PdcaNonConformitiesResponse,
  type PdcaCreatePayload,
  type PdcaAdvancePayload,
  type PdcaNonConformityPayload,
} from "./usePdca";

// §90-91 Suppliers hooks migrados a useSuppliers.ts (2026-05-18).
export {
  useSuppliers,
  useSupplierRanking,
  registerSupplier,
  recordSupplierIncident,
  recordSupplierAudit,
  type SupplierRiskLevel,
  type SupplierRiskFilter,
  type SupplierTrend,
  type SupplierIncidentSeverity,
  type SupplierIncidentRecord,
  type SupplierAuditRecord,
  type SupplierView,
  type SuppliersResponse,
  type SupplierRankingEntry,
  type SupplierRankingResponse,
  type RegisterSupplierPayload,
  type RecordSupplierIncidentPayload,
  type RecordSupplierAuditPayload,
} from "./useSuppliers";

// §291-295 Annual Review hooks migrados a useAnnualReview.ts (2026-05-18).
export {
  useCurrentAnnualReview,
  setAnnualReviewObjectives,
  attachAnnualReviewEvidence,
  concludeAnnualReview,
  type AnnualReviewEvidence,
  type AnnualReviewSnapshot,
  type AnnualReviewResponse,
  type SetObjectivesInput,
  type AttachEvidenceInput,
  type ConcludeReviewInput,
} from "./useAnnualReview";

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

// §276-277 Leadership hooks migrados a useLeadership.ts (2026-05-18).
export {
  useLeadershipDecisions,
  useLeadershipRanking,
  recordLeadershipDecision,
  type LeadershipPeriod,
  type LeadershipDecisionsResponse,
  type LeadershipRankingResponse,
  type LeadershipDecisionPayload,
} from "./useLeadership";

// §131-138 Project Closure hooks migrados a useProjectClosure.ts (2026-05-18).
export {
  useClosureStatus,
  useClosureSummary,
  initiateClosure,
  captureLesson,
  logDecision,
  finalizeClosure,
  type ClosureRole,
  type ClosureState,
  type ClosureStatusResponse,
  type ClosureSummaryResponse,
  type CaptureLessonPayload,
  type CapturedLesson,
  type LogDecisionPayload,
  type LoggedDecision,
} from "./useProjectClosure";

// §69-71 Driving Safety hooks migrados a useDrivingSafety.ts (2026-05-18).
export {
  useDrivingRoutes,
  useDrivingDrivers,
  useDrivingRanking,
  registerRoute,
  flagRouteAlert,
  recordJourney,
  type DrivingRouteCriticality,
  type DrivingRouteHazard,
  type DrivingRouteAlertKind,
  type DrivingRoutesStatus,
  type DrivingRouteAlert,
  type DrivingRoute,
  type DrivingDriver,
  type DrivingRankingEntry,
  type DrivingRoutesResponse,
  type DrivingDriversResponse,
  type DrivingRankingResponse,
  type DrivingRoutePayload,
  type DrivingRouteAlertPayload,
  type DrivingJourneyPayload,
} from "./useDrivingSafety";

// §244-250 Apprenticeship hooks migrados a useApprenticeship.ts (sesión previa).
// §211-213 Confidential Reports hooks migrados a useConfidentialReports.ts (sesión previa).
// F.29 Incident Trends migrado a useIncidentTrends.ts (sesión previa).
// §104 Data Confidence migrado a useDataConfidence.ts (sesión previa).
// F.18 Portable History migrado a usePortableHistory.ts (sesión previa).
//
// El bloque legacy estaba severamente corrupto (interleaved hooks,
// merge conflict markers, duplicate const declarations). Los hooks
// dedicados ya estaban en producción desde sesiones anteriores y
// las páginas consumían correctamente vía sus imports dedicados.
