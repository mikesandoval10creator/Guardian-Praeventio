// Praeventio Guard — F3 (decisión fundador): Hub de Flujo de Incidentes.
//
// Página dedicada (no inline) que centraliza el flujo de incidentes del
// proyecto. Tres superficies reales:
//
//   1. Menú interactivo de los INCIDENTES OCURRIDOS del proyecto — lista real
//      desde `GET /api/sprint-k/:projectId/incidents/list` (useIncidentList),
//      misma colección `incidents` que alimenta trends. Al seleccionar un
//      incidente se muestra su estado PDCA real (useIncidentFlowStatus) +
//      info accionable para gestionar/decidir.
//   2. Cuando el incidente seleccionado tiene microcapacitaciones asignadas
//      (chain node `microtraining-assigned`), se monta <AssignedMicrotrainingCard>
//      sobre los datos reales (moduleId/assignmentId/workerUid del nodo).
//   3. Reporte de un nuevo incidente con el huérfano <IncidentReportForm>
//      (write real al endpoint de incident-flow). Tras reportar, la lista
//      refetch.
//
// Empty-state HONESTO: si el proyecto no tiene incidentes, NO se inventa
// nada — se muestra la vista mensual/anual de tendencias (useIncidentTrends)
// + un mensaje claro de "sin incidentes registrados". La ausencia de
// incidentes es una buena noticia, no una falla.
//
// Directivas del producto: reportar SIEMPRE suma (cultura positiva); la app
// recomienda y da info para decidir, nunca bloquea ni transfiere pánico.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertOctagon,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  ListChecks,
  MapPin,
  PlusCircle,
  ShieldCheck,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth } from '../services/firebase';
import {
  useIncidentList,
  useIncidentTrends,
  type IncidentListItem,
  type IncidentTrendDirection,
} from '../hooks/useIncidentTrends';
import { useIncidentFlowStatus, type IncidentReportPayload } from '../hooks/useIncidentFlow';
import { IncidentReportForm } from '../components/incidentFlow/IncidentReportForm';
import { AssignedMicrotrainingCard } from '../components/incidentFlow/AssignedMicrotrainingCard';
// Bloque D Rama 3 — LightningTrainingPlayer was a phantom mount (built +
// render-ratchet-baselined but never JSX-rendered): the card's start button
// stayed permanently disabled because no page ever passed `onLaunch`. The
// player now opens as a modal from the card, closing assign→train→certify.
import { LightningTrainingPlayer } from '../components/microtraining/LightningTrainingPlayer';
import { useMicrotrainingCatalog } from '../hooks/useMicrotraining';
import {
  isPassing,
  shouldCertify,
  type MicroTrainingModule,
} from '../services/microtraining/lightningTrainingService';
import { InvestigationPanel } from '../components/incidentFlow/InvestigationPanel';
import { LessonPublishForm } from '../components/incidentFlow/LessonPublishForm';
import { PDCAClosePanel } from '../components/incidentFlow/PDCAClosePanel';

// ────────────────────────────────────────────────────────────────────────
// Visual helpers (puros)
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  baja: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  med: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  media: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  alta: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  critica: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

function severityTone(sev: string | null): string {
  if (!sev) return 'bg-zinc-500/15 text-secondary-token';
  return SEVERITY_TONE[sev.trim().toLowerCase()] ?? 'bg-zinc-500/15 text-secondary-token';
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'Sin abrir',
  plan: 'Planificar',
  do: 'Hacer',
  check: 'Verificar',
  act: 'Actuar',
  closed: 'Cerrado',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // DD-MM-YYYY (convención es-CL).
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

const TREND_TONE: Record<IncidentTrendDirection, string> = {
  improving: 'text-emerald-600 dark:text-emerald-400',
  stable: 'text-zinc-600 dark:text-zinc-400',
  worsening: 'text-rose-600 dark:text-rose-400',
};

/** Normaliza la severidad libre del listado al union del payload de reporte. */
function normalizeSeverity(sev: string | null): IncidentReportPayload['severity'] {
  const s = (sev ?? '').trim().toLowerCase();
  if (s === 'info') return 'info';
  if (s === 'low' || s === 'baja') return 'low';
  if (s === 'high' || s === 'alta') return 'high';
  if (s === 'critical' || s === 'critica' || s === 'crítica') return 'critical';
  return 'medium';
}

/** Conclusión de la investigación — alimenta <LessonPublishForm>. */
type LessonConclusion = {
  concludedAtIso: string;
  rootCauseSummary: string;
  contributingFactor?: string;
  preventiveActions: string[];
  closedByUid: string;
};

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export function IncidentFlowHub() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const workerUid = auth.currentUser?.uid ?? null;

  const listResp = useIncidentList(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  // PDCA management surfaces (investigación / lección / cierre) — colapsadas por
  // defecto para no recargar la vista del trabajador; el supervisor las abre.
  const [showManage, setShowManage] = useState(false);
  // Conclusión capturada por incidente al concluir la investigación; habilita
  // la publicación de la lección (paso Check del PDCA) con datos reales.
  const [conclusionByIncident, setConclusionByIncident] = useState<Record<string, LessonConclusion>>({});
  // Bloque D Rama 3 — LightningTrainingPlayer wiring. The card's onLaunch
  // resolves a Promise with the worker's result once the player finishes (the
  // card then POSTs the completion itself). Catalog gives the full module
  // (content blocks) the player needs; the assignment only carries moduleId.
  const catalogResp = useMicrotrainingCatalog(projectId);
  const [playerState, setPlayerState] = useState<{
    module: MicroTrainingModule;
    workerUid: string;
    resolve: (r: { score: number; passed: boolean; certified: boolean } | null) => void;
  } | null>(null);

  const incidents = useMemo<IncidentListItem[]>(
    () => listResp.data?.incidents ?? [],
    [listResp.data],
  );
  const hasIncidents = incidents.length > 0;

  // Status del incidente seleccionado — datos reales del chain PDCA.
  const statusResp = useIncidentFlowStatus(projectId, selectedId);
  const status = statusResp.data?.status ?? null;
  // Solo las microcapacitaciones del worker actual (vista de trabajador).
  const myTrainings = useMemo(
    () =>
      (statusResp.data?.assignedMicrotrainings ?? []).filter(
        (a) => !workerUid || a.workerUid === workerUid,
      ),
    [statusResp.data, workerUid],
  );

  // Tendencias para el fallback mensual/anual (solo se consume si NO hay
  // incidentes — sigue siendo dato real de la misma colección).
  const trendsResp = useIncidentTrends(hasIncidents ? null : projectId, {
    window: '12m',
    group: 'month',
  });
  const trends = trendsResp.data;

  // Un id determinístico para un nuevo reporte (mismo patrón que IncidentReport).
  // Se regenera cada vez que el panel de reporte cambia de visibilidad para que
  // un segundo reporte no reuse el incidentId del anterior.
  const newIncidentId = useMemo(
    () => `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showReport],
  );

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="incident-flow-hub-no-project"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <AlertOctagon
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentFlowHub.title', 'Flujo de Incidentes')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'incidentFlowHub.selectProject',
              'Selecciona un proyecto para ver los incidentes y su gestión.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="incident-flow-hub"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <ListChecks className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentFlowHub.title', 'Flujo de Incidentes')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'incidentFlowHub.subtitle',
              'Incidentes ocurridos del proyecto, su gestión PDCA y microcapacitaciones derivadas.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="incident-flow-hub-offline"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowReport((v) => !v)}
          data-testid="incident-flow-hub-toggle-report"
          aria-expanded={showReport}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white hover:bg-teal-700"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {t('incidentFlowHub.report', 'Reportar incidente')}
        </button>
      </header>

      {/* Reporte de nuevo incidente — monta el huérfano IncidentReportForm. */}
      {showReport && (
        <section data-testid="incident-flow-hub-report-panel" aria-label="Reportar incidente">
          <IncidentReportForm
            projectId={selectedProject.id}
            incidentId={newIncidentId}
            onSuccess={() => {
              setShowReport(false);
              listResp.refetch();
            }}
          />
        </section>
      )}

      {/* Loading / error de la lista */}
      {listResp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="incident-flow-hub-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}
      {listResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="incident-flow-hub-error"
          role="alert"
        >
          {t('incidentFlowHub.error', 'No se pudo cargar los incidentes: {{msg}}', {
            msg: listResp.error.message,
          })}
        </div>
      )}

      {/* Menú interactivo de incidentes ocurridos (dato real). */}
      {!listResp.loading && !listResp.error && hasIncidents && (
        <section
          aria-label="Incidentes del proyecto"
          data-testid="incident-flow-hub-list"
          className="space-y-2"
        >
          <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
            {t('incidentFlowHub.listTitle', 'Incidentes ocurridos')}{' '}
            <span className="text-secondary-token font-mono">({listResp.data?.total ?? incidents.length})</span>
          </h2>
          <ul className="space-y-1.5">
            {incidents.map((inc) => {
              const isSel = inc.id === selectedId;
              return (
                <li key={inc.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(isSel ? null : inc.id)}
                    aria-pressed={isSel}
                    data-testid={`incident-flow-hub-item-${inc.id}`}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      isSel
                        ? 'border-teal-500 bg-teal-500/5'
                        : 'border-default-token bg-surface hover:border-teal-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${severityTone(inc.severity)}`}
                        data-testid={`incident-flow-hub-item-sev-${inc.id}`}
                      >
                        {inc.severity ?? t('incidentFlowHub.unknownSeverity', 's/sev')}
                      </span>
                      {inc.nearMiss && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-700 dark:text-teal-300">
                          {t('incidentFlowHub.nearMiss', 'Casi-accidente')}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-secondary-token">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {formatDate(inc.occurredAt)}
                      </span>
                      <ChevronRight
                        className={`w-4 h-4 text-secondary-token transition-transform ${isSel ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-1 text-sm text-primary-token line-clamp-2">
                      {inc.summary ?? t('incidentFlowHub.noSummary', 'Sin descripción registrada.')}
                    </p>
                    {inc.location && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-secondary-token">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {inc.location}
                      </p>
                    )}
                  </button>

                  {/* Detalle del incidente seleccionado — estado PDCA real. */}
                  {isSel && (
                    <div
                      className="mt-1.5 ml-2 rounded-xl border border-default-token bg-surface-elevated p-3 space-y-2"
                      data-testid={`incident-flow-hub-detail-${inc.id}`}
                    >
                      {statusResp.loading && (
                        <p
                          className="text-xs text-secondary-token"
                          data-testid="incident-flow-hub-detail-loading"
                        >
                          {t('common.loading', 'Cargando…')}
                        </p>
                      )}
                      {status && (
                        <div data-testid="incident-flow-hub-pdca">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-300" aria-hidden="true" />
                            <span className="text-xs font-bold uppercase tracking-wide text-primary-token">
                              {t('incidentFlowHub.pdcaPhase', 'Fase PDCA')}:
                            </span>
                            <span
                              className="text-xs font-black text-teal-700 dark:text-teal-300"
                              data-testid="incident-flow-hub-pdca-phase"
                            >
                              {t(`incidentFlowHub.phase.${status.phase}`, PHASE_LABEL[status.phase] ?? status.phase)}
                            </span>
                            {status.isClosed && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] text-secondary-token">
                            {t(
                              'incidentFlowHub.pdcaClosure',
                              'Cierre de capacitación: {{done}}/{{assigned}} trabajadores ({{pct}}%).',
                              {
                                done: status.completedWorkerCount,
                                assigned: status.assignedWorkerCount,
                                pct: status.closurePercent,
                              },
                            )}
                          </p>
                        </div>
                      )}

                      {/* Gestión PDCA (supervisor): investigación → conclusión →
                          publicar lección → cierre. Monta los 3 paneles antes
                          huérfanos (InvestigationPanel / LessonPublishForm /
                          PDCAClosePanel). Colapsado por defecto. */}
                      <div className="pt-1" data-testid="incident-flow-hub-manage">
                        <button
                          type="button"
                          onClick={() => setShowManage((v) => !v)}
                          aria-expanded={showManage}
                          data-testid="incident-flow-hub-manage-toggle"
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary-token hover:text-primary-token"
                        >
                          <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                          {showManage
                            ? t('incidentFlowHub.manage.hide', 'Ocultar gestión PDCA')
                            : t('incidentFlowHub.manage.show', 'Gestión PDCA (supervisor)')}
                        </button>
                        {showManage && (
                          <div className="mt-2 space-y-3" data-testid="incident-flow-hub-manage-panels">
                            <PDCAClosePanel projectId={selectedProject.id} incidentId={inc.id} />
                            {workerUid && (
                              <InvestigationPanel
                                projectId={selectedProject.id}
                                incidentId={inc.id}
                                investigatorUid={workerUid}
                                report={{
                                  incidentId: inc.id,
                                  occurredAtIso: inc.occurredAt ?? new Date().toISOString(),
                                  description: inc.summary ?? '',
                                  severity: normalizeSeverity(inc.severity),
                                  location: inc.location ?? undefined,
                                }}
                                onConcluded={(c) =>
                                  setConclusionByIncident((prev) => ({ ...prev, [inc.id]: c }))
                                }
                              />
                            )}
                            {conclusionByIncident[inc.id] && (
                              <LessonPublishForm
                                projectId={selectedProject.id}
                                incidentId={inc.id}
                                defaultLessonId={`lesson-${inc.id}`}
                                conclusion={conclusionByIncident[inc.id]}
                                defaultAudienceUids={[]}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Microcapacitaciones asignadas — monta el huérfano
                          AssignedMicrotrainingCard sobre datos reales. */}
                      {myTrainings.length > 0 && (
                        <div
                          className="space-y-2"
                          data-testid="incident-flow-hub-trainings"
                        >
                          <h3 className="text-[11px] font-bold uppercase tracking-wide text-secondary-token">
                            {t('incidentFlowHub.myTrainings', 'Tu microcapacitación derivada')}
                          </h3>
                          {myTrainings.map((a) => (
                            <AssignedMicrotrainingCard
                              key={a.assignmentId}
                              projectId={selectedProject.id}
                              incidentId={inc.id}
                              assignmentId={a.assignmentId}
                              moduleId={a.moduleId}
                              moduleTitle={a.moduleId}
                              workerUid={a.workerUid}
                              lessonSummary={
                                a.derivedFromLessonId ??
                                t('incidentFlowHub.lessonFallback', 'Lección del incidente')
                              }
                              assignment={{
                                assignedAtIso: a.assignedAtIso ?? new Date().toISOString(),
                                assignedByUid: a.assignedByUid ?? a.workerUid,
                                derivedFromLessonId: a.derivedFromLessonId ?? a.moduleId,
                              }}
                              onLaunch={() => {
                                const module = catalogResp.data?.modules.find(
                                  (m) => m.id === a.moduleId,
                                );
                                if (!module) return Promise.resolve(null);
                                return new Promise((resolve) =>
                                  setPlayerState({ module, workerUid: a.workerUid, resolve }),
                                );
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Empty-state HONESTO: sin incidentes → vista mensual/anual real. */}
      {!listResp.loading && !listResp.error && !hasIncidents && (
        <section
          aria-label="Sin incidentes — vista de tendencias"
          data-testid="incident-flow-hub-empty"
          className="space-y-3"
        >
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <CheckCircle2
              className="w-10 h-10 mx-auto mb-3 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-sm font-bold text-primary-token">
              {t('incidentFlowHub.empty', 'Sin incidentes registrados en este proyecto.')}
            </p>
            <p className="mt-1 text-xs text-secondary-token">
              {t(
                'incidentFlowHub.emptyHint',
                'Buena noticia. Aquí verás la vista anual cuando haya datos, o reporta un casi-accidente para fortalecer la cultura preventiva.',
              )}
            </p>
          </div>

          {/* Tendencia mensual/anual — mismo dato real (colección incidents). */}
          <div
            className="rounded-2xl border border-default-token bg-surface p-4"
            data-testid="incident-flow-hub-trends"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
                {t('incidentFlowHub.annualView', 'Vista anual (12 meses)')}
              </h2>
            </div>
            {trendsResp.loading && (
              <p
                className="mt-2 text-xs text-secondary-token"
                data-testid="incident-flow-hub-trends-loading"
              >
                {t('common.loading', 'Cargando…')}
              </p>
            )}
            {trends && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span data-testid="incident-flow-hub-trends-total" className="text-secondary-token">
                  {t('incidentFlowHub.trendsTotal', '{{count}} incidentes en 12 meses', {
                    count: trends.totalIncidents,
                  })}
                </span>
                <span
                  className={`font-bold ${TREND_TONE[trends.trend]}`}
                  data-testid="incident-flow-hub-trends-direction"
                >
                  {t(`incidentFlowHub.trend.${trends.trend}`, trends.trend)}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Bloque D Rama 3 — the (formerly phantom) LightningTrainingPlayer,
          opened by AssignedMicrotrainingCard's start button. Closing without
          finishing resolves null (the card simply re-enables). */}
      {playerState && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
          data-testid="lightning-player-modal"
        >
          <div className="relative w-full max-w-lg">
            <button
              type="button"
              data-testid="lightning-player-close"
              aria-label={t('common.close', 'Cerrar')}
              onClick={() => {
                playerState.resolve(null);
                setPlayerState(null);
              }}
              className="absolute -top-3 -right-3 z-10 rounded-full bg-zinc-900 text-white w-8 h-8 flex items-center justify-center border border-white/20 hover:bg-zinc-700"
            >
              ×
            </button>
            <LightningTrainingPlayer
              module={playerState.module}
              workerUid={playerState.workerUid}
              onComplete={(session) => {
                const score = session.score ?? 0;
                playerState.resolve({
                  score,
                  passed: isPassing(score),
                  certified: shouldCertify({ ...session, score }, playerState.module),
                });
                setPlayerState(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default IncidentFlowHub;
