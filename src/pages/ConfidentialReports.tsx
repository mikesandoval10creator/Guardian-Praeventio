// Praeventio Guard — Sprint K §211-213 page wrapper.
//
// Reportes Confidenciales (Ley 21.643 — "Ley Karin") + Canal de Denuncias +
// Protección contra Represalias. Cierra la pieza UI del módulo
// `confidentialReports` que ya tenía servicio determinístico, motor Karin
// y adapter Firestore, pero quedaba sin ruta navegable.
//
// Privacidad por diseño:
//   - El trabajador elige entre reporte ANÓNIMO (default) o IDENTIFICADO.
//     Si elige anónimo, el client NO envía el uid; el server JAMÁS lo
//     persiste. Sólo se calcula un hash one-way del uid + salt tenant
//     para detección de represalias (nunca reversible).
//   - El banner de privacidad explica la protección legal por Ley 21.643.
//   - El panel de alertas de represalias usa exclusivamente el hash
//     anónimo; nunca expone uid de autores anónimos.
//
// SLA legal:
//   - Primera respuesta: 5 días hábiles (Art. 7 Ley 21.643).
//   - Resolución total: 30 días corridos.
//
// Dos tabs:
//   - "Mis reportes": worker view (lista propia + botón nuevo reporte).
//   - "Inbox investigador": admin/prevencionista view (todos los abiertos +
//     formulario de respuesta + cierre, gated por rol del server).
//
// El rol viene del response (`role: 'investigator' | 'reporter'`) — el
// server decide; el client sólo renderiza la UI consistente.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  Plus,
  X,
  Send,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Inbox,
  AlertCircle,
  EyeOff,
  Clock,
  FileText,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
// 2026-05-17 — migrated from monolithic useSprintK.ts to dedicated hook
// per Sprint K reformulation directive. See docs/SPRINT_K_REFORMULATED.md.
import {
  useConfidentialReports,
  useRetaliationAlerts,
  submitConfidentialReport,
  respondToReport,
  closeReport,
  type ConfidentialReportApi,
  type ConfidentialReportKindApi,
  type ConfidentialReportSeverity,
  type ConfidentialReportStatusApi,
  type RetaliationAlertApi,
} from '../hooks/useConfidentialReports';
import { logger } from '../utils/logger';
import { ConfidentialReportInbox } from '../components/confidentialReports/ConfidentialReportInbox';
import type { ConfidentialReport, ConfidentialReportKind, ReportStatus } from '../services/confidentialReports/confidentialReportsService';
import { humanErrorMessage } from '../lib/humanError';


// ────────────────────────────────────────────────────────────────────────
// Visual helpers
// ────────────────────────────────────────────────────────────────────────

const KIND_META: Record<
  ConfidentialReportKindApi,
  { label: string; color: string; bg: string }
> = {
  harassment: {
    label: 'Acoso (laboral/sexual)',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
  },
  safety: {
    label: 'Comportamiento inseguro',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
  },
  discrimination: {
    label: 'Discriminación',
    color: 'text-violet-600',
    bg: 'bg-violet-500/10',
  },
  violence: {
    label: 'Violencia',
    color: 'text-rose-700',
    bg: 'bg-rose-500/15',
  },
  conflict_of_interest: {
    label: 'Conflicto de interés',
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
  },
  other: {
    label: 'Otro tema sensible',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10',
  },
};

const KIND_OPTIONS: ConfidentialReportKindApi[] = [
  'harassment',
  'safety',
  'discrimination',
  'violence',
  'conflict_of_interest',
  'other',
];

const SEVERITY_META: Record<
  ConfidentialReportSeverity,
  { label: string; color: string }
> = {
  low: { label: 'Baja', color: 'text-zinc-600' },
  medium: { label: 'Media', color: 'text-amber-600' },
  high: { label: 'Alta', color: 'text-rose-600' },
  critical: { label: 'Crítica', color: 'text-rose-700 font-black' },
};

const STATUS_META: Record<
  ConfidentialReportStatusApi,
  { label: string; color: string; bg: string }
> = {
  open: { label: 'Abierto', color: 'text-amber-600', bg: 'bg-amber-500/10' },
  investigating: {
    label: 'En investigación',
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
  },
  resolved: {
    label: 'Resuelto',
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10',
  },
  closed: {
    label: 'Cerrado',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10',
  },
  dismissed: {
    label: 'Descartado',
    color: 'text-zinc-500',
    bg: 'bg-zinc-400/10',
  },
};

function formatIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Ley Karin SLA (Ley 21.643) ──────────────────────────────────────────────
// The server already computes firstResponseDueAt (+3 business days) and
// resolveDueAt (+30) on every report (confidentialReports.ts) and the API shape
// carries them (useConfidentialReports). They were never surfaced — the inbox
// could not see which investigations were about to breach a legal deadline.
// Pure + deterministic (Date injected) so it is unit-testable in isolation.

type SlaState = 'on_track' | 'at_risk' | 'breached';

/**
 * SLA badge state for an ACTIONABLE report. Returns null for terminal reports
 * (resolved/closed/dismissed) — there is no live deadline to track. The
 * relevant deadline is the first-response one until the investigator responds,
 * then the resolution one.
 */
export function slaState(
  report: ConfidentialReportApi,
  nowMs: number = Date.now(),
): { state: SlaState; dueIso: string } | null {
  if (
    report.status === 'resolved' ||
    report.status === 'closed' ||
    report.status === 'dismissed'
  ) {
    return null;
  }
  const dueIso = report.respondedAt ? report.resolveDueAt : report.firstResponseDueAt;
  const dueMs = Date.parse(dueIso);
  // Malformed due date → flag for human review (at_risk), never hide it.
  if (Number.isNaN(dueMs)) return { state: 'at_risk', dueIso };
  const msLeft = dueMs - nowMs;
  if (msLeft < 0) return { state: 'breached', dueIso };
  if (msLeft < 24 * 3_600_000) return { state: 'at_risk', dueIso }; // <24h to deadline
  return { state: 'on_track', dueIso };
}

const SLA_META: Record<SlaState, { labelKey: string; cls: string }> = {
  on_track: { labelKey: 'confidentialReports.card.slaOnTrack', cls: 'text-emerald-700 bg-emerald-500/10' },
  at_risk: { labelKey: 'confidentialReports.card.slaAtRisk', cls: 'text-amber-700 bg-amber-500/15' },
  breached: { labelKey: 'confidentialReports.card.slaBreached', cls: 'text-rose-700 bg-rose-500/20' },
};

const SLA_ORDER: Record<SlaState, number> = { breached: 0, at_risk: 1, on_track: 2 };

const API_KIND_TO_SERVICE: Record<ConfidentialReportKindApi, ConfidentialReportKind> = {
  harassment: 'harassment_workplace',
  safety: 'unsafe_behavior',
  discrimination: 'discrimination',
  violence: 'violence',
  conflict_of_interest: 'conflict_of_interest',
  other: 'other_sensitive',
};

const API_STATUS_TO_SERVICE: Record<ConfidentialReportStatusApi, ReportStatus> = {
  open: 'submitted',
  investigating: 'under_investigation',
  resolved: 'resolved_substantiated',
  closed: 'resolved_substantiated',
  dismissed: 'resolved_unsubstantiated',
};

function mapApiReport(r: ConfidentialReportApi): ConfidentialReport {
  return {
    id: r.id,
    authorHash: r.reporterAnonHash,
    authorIdentified: r.allowsIdentity,
    authorUid: r.reporterUid,
    kind: API_KIND_TO_SERVICE[r.kind],
    description: r.narrative,
    involvedUids: [],
    submittedAt: r.submittedAt,
    status: API_STATUS_TO_SERVICE[r.status],
  };
}

/** Inbox sort key: most-urgent SLA first, soonest deadline within a tier;
 *  terminal reports (no live SLA) sink to the bottom. */
export function slaSortKey(
  report: ConfidentialReportApi,
  nowMs: number = Date.now(),
): { rank: number; dueMs: number } {
  const s = slaState(report, nowMs);
  if (!s) return { rank: 3, dueMs: Number.MAX_SAFE_INTEGER };
  const dueMs = Date.parse(s.dueIso);
  return { rank: SLA_ORDER[s.state], dueMs: Number.isNaN(dueMs) ? 0 : dueMs };
}

export function ConfidentialReports() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [activeTab, setActiveTab] = useState<'mis' | 'inbox'>('mis');
  const [showNewModal, setShowNewModal] = useState(false);
  const [respondingTo, setRespondingTo] = useState<ConfidentialReportApi | null>(null);
  const [closingTo, setClosingTo] = useState<ConfidentialReportApi | null>(null);

  const reportsResp = useConfidentialReports(projectId);
  const retaliationResp = useRetaliationAlerts(projectId);

  const role: 'investigator' | 'reporter' =
    reportsResp.data?.role ?? 'reporter';
  const isInvestigator = role === 'investigator';

  const allReports: ConfidentialReportApi[] = useMemo(
    () => reportsResp.data?.reports ?? [],
    [reportsResp.data],
  );

  // "Mis reportes" en cualquier vista: los del autor (identificado o
  // anónimo — el server ya filtra correctamente). Para el investigator
  // mostramos sus propios reportes filtrando por reporterUid (si está
  // identificado) — los anónimos del propio investigator NO los
  // separamos de los demás porque no podemos diferenciarlos sin
  // de-anonimizar. Es coherente con la filosofía "anónimo es anónimo".
  const myReports = useMemo(() => {
    if (!user) return allReports;
    return allReports.filter(
      (r) => r.allowsIdentity && r.reporterUid === user.uid,
    );
  }, [allReports, user]);

  // Inbox del investigator: los que están abiertos o en investigación.
  const inboxReports = useMemo(
    () =>
      allReports
        .filter((r) => r.status === 'open' || r.status === 'investigating')
        .slice()
        // Ley Karin: surface the most-urgent SLA first so an investigator
        // never misses a breaching deadline buried mid-list.
        .sort((a, b) => {
          const ka = slaSortKey(a);
          const kb = slaSortKey(b);
          return ka.rank - kb.rank || ka.dueMs - kb.dueMs;
        }),
    [allReports],
  );

  const retaliationAlerts: RetaliationAlertApi[] = useMemo(
    () => retaliationResp.data?.alerts ?? [],
    [retaliationResp.data],
  );

  const retaliationReportIds = useMemo(
    () => new Set(retaliationAlerts.map((a) => a.reportId)),
    [retaliationAlerts],
  );

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="confidential-reports-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldAlert
            className="w-12 h-12 mx-auto mb-4 text-rose-500"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'confidentialReports.page.title',
              'Reportes Confidenciales',
            )}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'confidentialReports.page.selectProject',
              'Selecciona un proyecto para acceder al canal de denuncias.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="confidential-reports-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'confidentialReports.page.title',
              'Reportes Confidenciales',
            )}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'confidentialReports.page.subtitle',
              'Canal §211-213 — Ley 21.643 (Ley Karin) + protección represalias.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="confidential-reports-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-rose-600"
          data-testid="confidential-reports-new-button"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('confidentialReports.action.new', 'Nuevo reporte')}
        </button>
      </header>

      {/* PRIVACY BANNER — Ley 21.643 protection. */}
      <div
        className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 flex items-start gap-3"
        data-testid="confidential-reports-privacy-banner"
        role="note"
      >
        <Lock
          className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="text-sm text-primary-token">
          <p className="font-bold text-teal-700 dark:text-teal-300">
            {t(
              'confidentialReports.privacy.title',
              'Sus datos están protegidos por la Ley 21.643',
            )}
          </p>
          <p className="mt-1 text-xs text-secondary-token">
            {t(
              'confidentialReports.privacy.body',
              'Puede reportar de forma anónima o identificada. La identidad anónima JAMÁS se guarda — solo un código seudónimo irreversible para detectar represalias. Cualquier acción adversa post-reporte (despido, cambio de turno, sanción) queda registrada para revisión legal.',
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        className="flex gap-1 border-b border-default-token"
        data-testid="confidential-reports-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mis'}
          onClick={() => setActiveTab('mis')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
            activeTab === 'mis'
              ? 'border-rose-500 text-rose-600 dark:text-rose-400'
              : 'border-transparent text-secondary-token hover:text-primary-token'
          }`}
          data-testid="confidential-reports-tab-mis"
        >
          <FileText className="w-4 h-4" aria-hidden="true" />
          {t('confidentialReports.tab.mis', 'Mis reportes')}
        </button>
        {isInvestigator && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inbox'}
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
              activeTab === 'inbox'
                ? 'border-rose-500 text-rose-600 dark:text-rose-400'
                : 'border-transparent text-secondary-token hover:text-primary-token'
            }`}
            data-testid="confidential-reports-tab-inbox"
          >
            <Inbox className="w-4 h-4" aria-hidden="true" />
            {t('confidentialReports.tab.inbox', 'Inbox investigador')}
          </button>
        )}
      </div>

      {/* Hook-level error or loading */}
      {reportsResp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="confidential-reports-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {reportsResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="confidential-reports-error"
          role="alert"
        >
          {t(
            'confidentialReports.error',
            'No se pudieron cargar los reportes: {{msg}}',
            { msg: reportsResp.error.message },
          )}
        </div>
      )}

      {/* Mis reportes tab */}
      {!reportsResp.loading && !reportsResp.error && activeTab === 'mis' && (
        <section
          aria-label="Mis reportes"
          data-testid="confidential-reports-mis-section"
        >
          {myReports.length === 0 ? (
            <div
              className="rounded-2xl border border-default-token bg-surface p-8 text-center"
              data-testid="confidential-reports-mis-empty"
            >
              <ShieldCheck
                className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                aria-hidden="true"
              />
              <p className="text-sm text-secondary-token italic">
                {t(
                  'confidentialReports.mis.empty',
                  'No tienes reportes en este proyecto. Los reportes anónimos no aparecen aquí por diseño — solo los identificados.',
                )}
              </p>
            </div>
          ) : (
            <ul
              className="space-y-2"
              data-testid="confidential-reports-mis-list"
            >
              {myReports.map((r) => (
                <ReportCard key={r.id} report={r} variant="mis" />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Investigator inbox tab */}
      {!reportsResp.loading &&
        !reportsResp.error &&
        activeTab === 'inbox' &&
        isInvestigator && (
          <section
            aria-label="Inbox investigador"
            data-testid="confidential-reports-inbox-section"
          >
            {inboxReports.length === 0 ? (
              <div
                className="rounded-2xl border border-default-token bg-surface p-8 text-center"
                data-testid="confidential-reports-inbox-empty"
              >
                <Inbox
                  className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                  aria-hidden="true"
                />
                <p className="text-sm text-secondary-token italic">
                  {t(
                    'confidentialReports.inbox.empty',
                    'Sin reportes pendientes. Bandeja vacía.',
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 transition-all duration-300 ease-in-out">
                  <ConfidentialReportInbox
                    reports={inboxReports.map(mapApiReport)}
                    retaliationReportIds={retaliationReportIds}
                    // Distinct prefix so this SLA summary does not collide with
                    // the actionable ReportCard list below (both render one node
                    // per report under `confidential-report-${id}` by default).
                    testIdPrefix="confidential-inbox-report"
                  />
                </div>
                <ul
                  className="space-y-2"
                  data-testid="confidential-reports-inbox-list"
                >
                  {inboxReports.map((r) => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      variant="inbox"
                      onRespond={() => setRespondingTo(r)}
                      onClose={() => setClosingTo(r)}
                    />
                  ))}
                </ul>
              </>
            )}

            {/* Retaliation alerts panel — only investigators see it. */}
            <div
              className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4"
              data-testid="confidential-reports-retaliation-panel"
            >
              <header className="flex items-center gap-2 mb-3">
                <AlertTriangle
                  className="w-5 h-5 text-rose-600"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-black uppercase tracking-tight text-rose-700 dark:text-rose-300">
                  {t(
                    'confidentialReports.retaliation.title',
                    'Alertas de represalia (ventana 90d)',
                  )}
                </h2>
              </header>
              <p className="text-[11px] text-secondary-token mb-3">
                {t(
                  'confidentialReports.retaliation.disclaimer',
                  'Patrón detectado por hash anónimo — NO de-anonimiza. Investigación humana obligatoria antes de concluir.',
                )}
              </p>

              {retaliationResp.loading && (
                <p
                  className="text-xs text-secondary-token"
                  data-testid="confidential-reports-retaliation-loading"
                >
                  {t('common.loading', 'Cargando…')}
                </p>
              )}

              {retaliationResp.error && (
                <p
                  className="text-xs text-rose-600 dark:text-rose-400"
                  data-testid="confidential-reports-retaliation-error"
                  role="alert"
                >
                  {retaliationResp.error.message}
                </p>
              )}

              {!retaliationResp.loading &&
                !retaliationResp.error &&
                retaliationAlerts.length === 0 && (
                  <p
                    className="text-xs italic text-secondary-token"
                    data-testid="confidential-reports-retaliation-empty"
                  >
                    {t(
                      'confidentialReports.retaliation.empty',
                      'Sin patrones de represalia detectados en los últimos 90 días.',
                    )}
                  </p>
                )}

              {!retaliationResp.loading &&
                !retaliationResp.error &&
                retaliationAlerts.length > 0 && (
                  <ul
                    className="space-y-2"
                    data-testid="confidential-reports-retaliation-list"
                  >
                    {retaliationAlerts.map((a, idx) => (
                      <li
                        key={`${a.reportId}_${a.actionAt}_${idx}`}
                        className={`rounded-lg border p-2 text-xs ${
                          a.severity === 'critical'
                            ? 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300'
                            : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                        }`}
                        data-testid={`confidential-reports-retaliation-${a.reportId}`}
                      >
                        <div className="flex items-center gap-2">
                          <EyeOff className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="font-bold uppercase tracking-wider">
                            {a.severity === 'critical' ? 'Crítica' : 'Alta'}
                          </span>
                          <span>
                            {t(
                              'confidentialReports.retaliation.entry',
                              '{{kind}} a {{days}}d del reporte (hash: {{hash}}…)',
                              {
                                kind: a.actionKind,
                                days: a.daysFromReport,
                                hash: a.reporterAnonHash.slice(0, 8),
                              },
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </section>
        )}

      {/* Modals */}
      {showNewModal && projectId && user && (
        <NewReportModal
          projectId={projectId}
          uid={user.uid}
          onClose={() => setShowNewModal(false)}
          onSuccess={() => {
            setShowNewModal(false);
            reportsResp.refetch?.();
          }}
        />
      )}

      {respondingTo && projectId && (
        <RespondModal
          projectId={projectId}
          report={respondingTo}
          onClose={() => setRespondingTo(null)}
          onSuccess={() => {
            setRespondingTo(null);
            reportsResp.refetch?.();
          }}
        />
      )}

      {closingTo && projectId && (
        <CloseModal
          projectId={projectId}
          report={closingTo}
          onClose={() => setClosingTo(null)}
          onSuccess={() => {
            setClosingTo(null);
            reportsResp.refetch?.();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

interface ReportCardProps {
  report: ConfidentialReportApi;
  variant: 'mis' | 'inbox';
  onRespond?: () => void;
  onClose?: () => void;
}

function ReportCard({ report, variant, onRespond, onClose }: ReportCardProps) {
  const { t } = useTranslation();
  const kindMeta = KIND_META[report.kind];
  const sevMeta = SEVERITY_META[report.severity];
  const statusMeta = STATUS_META[report.status];
  return (
    <li
      className="rounded-xl border border-default-token bg-surface p-3 shadow-mode"
      data-testid={`confidential-report-${report.id}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${kindMeta.color} ${kindMeta.bg}`}
        >
          {kindMeta.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-primary-token whitespace-pre-wrap">
            {report.narrative}
          </p>
          {report.evidence && (
            <p className="mt-1 text-xs italic text-secondary-token">
              {t('confidentialReports.card.evidence', 'Evidencia')}: {report.evidence}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
            <span className={`font-bold ${sevMeta.color}`}>
              {t('confidentialReports.card.severity', 'Severidad')}: {sevMeta.label}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-bold ${statusMeta.color} ${statusMeta.bg}`}
            >
              {statusMeta.label}
            </span>
            {(() => {
              const s = slaState(report);
              return s ? (
                <span
                  className={`rounded px-1.5 py-0.5 font-bold inline-flex items-center gap-1 ${SLA_META[s.state].cls}`}
                  data-testid={`confidential-report-sla-${report.id}`}
                  title={`${t('confidentialReports.card.slaDue', 'Vence')}: ${formatIso(s.dueIso)}`}
                >
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {t(SLA_META[s.state].labelKey)}
                </span>
              ) : null;
            })()}
            <span className="text-secondary-token inline-flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {formatIso(report.submittedAt)}
            </span>
            {!report.allowsIdentity && (
              <span className="text-teal-600 inline-flex items-center gap-1 font-bold">
                <EyeOff className="w-3 h-3" aria-hidden="true" />
                {t('confidentialReports.card.anonymous', 'Anónimo')}
              </span>
            )}
          </div>
          {report.resolution && (
            <p className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300">
              <strong className="block uppercase tracking-wide">
                {t('confidentialReports.card.resolution', 'Resolución')}:
              </strong>
              {report.resolution}
            </p>
          )}
        </div>
        {variant === 'inbox' && report.status !== 'resolved' && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onRespond}
              className="flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-bold text-blue-600 hover:bg-blue-500/20"
              data-testid={`confidential-report-respond-${report.id}`}
            >
              <Send className="w-3 h-3" aria-hidden="true" />
              {t('confidentialReports.action.respond', 'Responder')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-600 hover:bg-emerald-500/20"
              data-testid={`confidential-report-close-${report.id}`}
            >
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
              {t('confidentialReports.action.close', 'Cerrar')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

interface NewReportModalProps {
  projectId: string;
  uid: string;
  onClose: () => void;
  onSuccess: () => void;
}

function NewReportModal({ projectId, uid, onClose, onSuccess }: NewReportModalProps) {
  const { t } = useTranslation();
  // Default: ANÓNIMO. Privacy-by-default — el trabajador opta explícitamente
  // por identificarse, no al revés.
  const [allowsIdentity, setAllowsIdentity] = useState(false);
  const [kind, setKind] = useState<ConfidentialReportKindApi>('harassment');
  const [severity, setSeverity] = useState<ConfidentialReportSeverity>('medium');
  const [narrative, setNarrative] = useState('');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (narrative.trim().length < 10) {
      setError(
        t(
          'confidentialReports.modal.errorNarrative',
          'La descripción debe tener al menos 10 caracteres.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // CRITICAL: si allowsIdentity=false, NO mandamos reporterUid.
      // El hook ya tiene defensa adicional pero el principio de mínima
      // exposición pide no transmitirlo nunca en ese caso.
      await submitConfidentialReport(projectId, {
        kind,
        severity,
        narrative: narrative.trim(),
        evidence: evidence.trim() || undefined,
        allowsIdentity,
        reporterUid: allowsIdentity ? uid : undefined,
      });
      logger.info('confidentialReport.submitted', {
        projectId,
        kind,
        severity,
        anonymous: !allowsIdentity,
      });
      setConfirmation(
        t(
          'confidentialReports.modal.confirmation',
          'Reporte enviado. Recibirá respuesta en 5 días hábiles (Art. 7 Ley 21.643).',
        ) as string,
      );
      // Wait briefly so the user sees confirmation, then close.
      setTimeout(() => onSuccess(), 1800);
    } catch (err) {
      logger.error('confidentialReport.submit.failed', err);
      setError(
        humanErrorMessage(
          (err as Error).message ||
            (t(
              'confidentialReports.modal.errorSubmit',
              'No se pudo enviar el reporte.',
            ) as string),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="confidential-reports-new-modal"
    >
      <div className="w-full max-w-lg rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <header className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('confidentialReports.modal.title', 'Nuevo reporte confidencial')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid="confidential-reports-new-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {confirmation ? (
          <div
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2"
            data-testid="confidential-reports-new-modal-confirmation"
            role="status"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <p>{confirmation}</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {/* Anonymous vs identified toggle — default anonymous. */}
              <fieldset
                className="rounded-md border border-teal-500/30 bg-teal-500/5 p-3"
                data-testid="confidential-reports-anon-toggle"
              >
                <legend className="text-[11px] uppercase font-bold text-teal-700 dark:text-teal-300 px-1">
                  {t(
                    'confidentialReports.modal.identityLegend',
                    'Identidad',
                  )}
                </legend>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="identity"
                    checked={!allowsIdentity}
                    onChange={() => setAllowsIdentity(false)}
                    className="mt-1"
                    data-testid="confidential-reports-anon-radio"
                  />
                  <span>
                    <strong>
                      {t(
                        'confidentialReports.modal.anonymousLabel',
                        'Anónimo (recomendado)',
                      )}
                    </strong>
                    <span className="block text-xs text-secondary-token">
                      {t(
                        'confidentialReports.modal.anonymousHelp',
                        'Su identidad NUNCA se guarda. Solo un código irreversible para detectar represalias.',
                      )}
                    </span>
                  </span>
                </label>
                <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="identity"
                    checked={allowsIdentity}
                    onChange={() => setAllowsIdentity(true)}
                    className="mt-1"
                    data-testid="confidential-reports-identified-radio"
                  />
                  <span>
                    <strong>
                      {t(
                        'confidentialReports.modal.identifiedLabel',
                        'Identificado',
                      )}
                    </strong>
                    <span className="block text-xs text-secondary-token">
                      {t(
                        'confidentialReports.modal.identifiedHelp',
                        'Permite seguimiento personalizado del caso. Mantenido en estricta confidencialidad.',
                      )}
                    </span>
                  </span>
                </label>
              </fieldset>

              <label className="block">
                <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                  {t('confidentialReports.modal.kind', 'Categoría')}
                </span>
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as ConfidentialReportKindApi)
                  }
                  className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                  data-testid="confidential-reports-new-modal-kind"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                  {t('confidentialReports.modal.severity', 'Severidad')}
                </span>
                <select
                  value={severity}
                  onChange={(e) =>
                    setSeverity(e.target.value as ConfidentialReportSeverity)
                  }
                  className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                  data-testid="confidential-reports-new-modal-severity"
                >
                  {(['low', 'medium', 'high', 'critical'] as ConfidentialReportSeverity[]).map(
                    (s) => (
                      <option key={s} value={s}>
                        {SEVERITY_META[s].label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                  {t('confidentialReports.modal.narrative', 'Descripción')}
                </span>
                <textarea
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  rows={5}
                  placeholder={
                    t(
                      'confidentialReports.modal.narrativePlaceholder',
                      'Describa el hecho con detalle: qué ocurrió, cuándo, dónde, quién(es).',
                    ) as string
                  }
                  className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                  data-testid="confidential-reports-new-modal-narrative"
                />
              </label>

              <label className="block">
                <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                  {t(
                    'confidentialReports.modal.evidence',
                    'Evidencia (opcional)',
                  )}
                </span>
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  rows={2}
                  placeholder={
                    t(
                      'confidentialReports.modal.evidencePlaceholder',
                      'Testigos, documentos, correos, mensajes.',
                    ) as string
                  }
                  className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                  data-testid="confidential-reports-new-modal-evidence"
                />
              </label>
            </div>

            {error && (
              <p
                className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
                data-testid="confidential-reports-new-modal-error"
                role="alert"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{humanErrorMessage(error)}</span>
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
                data-testid="confidential-reports-new-modal-cancel"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid="confidential-reports-new-modal-submit"
              >
                {submitting
                  ? t('common.submitting', 'Enviando…')
                  : t('confidentialReports.modal.submit', 'Reportar')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface RespondModalProps {
  projectId: string;
  report: ConfidentialReportApi;
  onClose: () => void;
  onSuccess: () => void;
}

function RespondModal({ projectId, report, onClose, onSuccess }: RespondModalProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (message.trim().length < 1) {
      setError(
        t(
          'confidentialReports.respond.errorEmpty',
          'El mensaje no puede estar vacío.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await respondToReport(projectId, report.id, message.trim());
      logger.info('confidentialReport.responded', { projectId, reportId: report.id });
      onSuccess();
    } catch (err) {
      logger.error('confidentialReport.respond.failed', err);
      setError(humanErrorMessage((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="confidential-reports-respond-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <Send className="w-5 h-5 text-blue-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('confidentialReports.respond.title', 'Responder al reporte')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            {t('confidentialReports.respond.message', 'Mensaje')}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={
              t(
                'confidentialReports.respond.placeholder',
                'Describa el avance, próximos pasos, o solicitud de información adicional.',
              ) as string
            }
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="confidential-reports-respond-message"
          />
        </label>

        {error && (
          <p
            className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            role="alert"
          >
            {humanErrorMessage(error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="confidential-reports-respond-submit"
          >
            {submitting
              ? t('common.submitting', 'Enviando…')
              : t('confidentialReports.respond.submit', 'Enviar respuesta')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CloseModalProps {
  projectId: string;
  report: ConfidentialReportApi;
  onClose: () => void;
  onSuccess: () => void;
}

function CloseModal({ projectId, report, onClose, onSuccess }: CloseModalProps) {
  const { t } = useTranslation();
  const [resolution, setResolution] = useState('');
  const [outcome, setOutcome] = useState<
    'substantiated' | 'unsubstantiated' | 'transferred'
  >('substantiated');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (resolution.trim().length < 1) {
      setError(
        t(
          'confidentialReports.close.errorEmpty',
          'La resolución no puede estar vacía.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await closeReport(projectId, report.id, resolution.trim(), outcome);
      logger.info('confidentialReport.closed', {
        projectId,
        reportId: report.id,
        outcome,
      });
      onSuccess();
    } catch (err) {
      logger.error('confidentialReport.close.failed', err);
      setError(humanErrorMessage((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="confidential-reports-close-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <CheckCircle2
            className="w-5 h-5 text-emerald-500"
            aria-hidden="true"
          />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('confidentialReports.close.title', 'Cerrar reporte')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            {t('confidentialReports.close.outcome', 'Resultado')}
          </span>
          <select
            value={outcome}
            onChange={(e) =>
              setOutcome(
                e.target.value as
                  | 'substantiated'
                  | 'unsubstantiated'
                  | 'transferred',
              )
            }
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="confidential-reports-close-outcome"
          >
            <option value="substantiated">
              {t('confidentialReports.close.substantiated', 'Fundado')}
            </option>
            <option value="unsubstantiated">
              {t('confidentialReports.close.unsubstantiated', 'No fundado')}
            </option>
            <option value="transferred">
              {t(
                'confidentialReports.close.transferred',
                'Derivado a autoridad externa',
              )}
            </option>
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            {t('confidentialReports.close.resolution', 'Resolución')}
          </span>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={5}
            placeholder={
              t(
                'confidentialReports.close.placeholder',
                'Describa la resolución del caso, medidas adoptadas, y plan de seguimiento.',
              ) as string
            }
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="confidential-reports-close-resolution"
          />
        </label>

        {error && (
          <p
            className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            role="alert"
          >
            {humanErrorMessage(error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="confidential-reports-close-submit"
          >
            {submitting
              ? t('common.submitting', 'Cerrando…')
              : t('confidentialReports.close.submit', 'Cerrar reporte')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfidentialReports;
