// Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-23).
//
// Page `/lone-worker`. Service `loneWorkerService.ts` + card
// `LoneWorkerCard.tsx` existían sin page consumidor.
//
// UX: el supervisor ve todas las sesiones de trabajo solitario activas
// del proyecto. Cada card muestra estado derivado (active / overdue /
// help_requested / ended) + escalamiento sugerido + último check-in.
// Workers reportan check-in vía botón rápido + opcional captura GPS.
//
// Auto-refresh real-time vía Firestore subscription. El estado derivado
// (deriveLoneWorkerStatus) se recomputa cada minuto en cliente para
// transicionar overdue_warning → overdue_critical sin esperar al
// próximo snapshot.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserCheck,
  Plus,
  Loader2,
  AlertTriangle,
  Siren,
  CheckCircle2,
  Square,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { LoneWorkerCard } from '../components/loneWorker/LoneWorkerCard';
import { LoneWorkerAdminPanel } from '../components/loneWorker/LoneWorkerAdminPanel';
import {
  deriveLoneWorkerStatus,
  decideEscalation,
  recordCheckIn,
  endSession,
  type LoneWorkerSession,
} from '../services/loneWorker/loneWorkerService';
import {
  saveLoneWorkerSession,
  patchLoneWorkerSession,
  subscribeActiveLoneWorkerSessions,
} from '../services/loneWorker/loneWorkerStore';
import { startLoneWorkerSessionApi } from '../hooks/useLoneWorker';
import { logger } from '../utils/logger';

const INTERVAL_PRESETS = [15, 30, 60, 120];

export function LoneWorkerMonitor() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [sessions, setSessions] = useState<LoneWorkerSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Force re-render every 60s so deriveLoneWorkerStatus recomputa
  // overdue_warning → overdue_critical sin esperar al próximo snapshot
  // de Firestore (que solo dispara on update remoto).
  const [tickSec, setTickSec] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTickSec((s) => s + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [intervalMin, setIntervalMin] = useState(30);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setSessions([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    // Plan §B.5 (2026-05-23): subscribeActiveLoneWorkerSessions trae solo
    // sesiones "vivas" (active|overdue_*|help_requested) — reduce reads
    // ~80% en proyectos con muchas sesiones ended. El historial reciente
    // de cerradas se removió de esta page (ya estaba slice de 5; el
    // audit-trail tiene el flujo completo con paginación).
    const unsub = subscribeActiveLoneWorkerSessions(
      projectId,
      (list) => {
        setSessions(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('lone_worker_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  // Status derivation runs on every render (cheap pure function).
  const sessionsWithStatus = useMemo(() => {
    void tickSec; // re-derivar al pasar el minuto
    const now = new Date();
    return sessions.map((s) => ({
      session: s,
      status: deriveLoneWorkerStatus(s, now),
      escalation: decideEscalation(s, now),
    }));
  }, [sessions, tickSec]);

  // Server-side filter ya excluye 'ended' — `sessions` solo contiene
  // active|overdue_*|help_requested. El filter client-side se mantiene
  // como guard defensivo por si el status del client deriva 'ended'
  // (deriveLoneWorkerStatus puede marcar ended por timeout local antes
  // del próximo write Firestore).
  const activeSessions = useMemo(
    () => sessionsWithStatus.filter((x) => x.status !== 'ended'),
    [sessionsWithStatus],
  );

  // §B.5 — historial in-page removido (server filter excluye ended). Para
  // ver finalizadas usar /audit-trail (con paginación + filtros).
  const endedSessions: typeof sessionsWithStatus = [];

  // Geolocalización opcional — el check-in graba lat/lng si el browser
  // tiene permiso. Si no, graba check-in sin coords (sigue válido).
  const requestLocation = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    if (!('geolocation' in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 },
      );
    });
  }, []);

  const handleStartSession = useCallback(async () => {
    if (!user || !selectedProject) {
      setFeedback('Necesitás un proyecto activo y estar autenticado.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const startedAt = new Date().toISOString();
      const loc = await requestLocation();
      // Audited server creation point (same as LoneWorker.tsx): the route
      // stamps workerUid from the token + mints the id (no client RNG) + writes
      // audit_logs. This page is self-tracking ("vos sos el worker"), so the
      // token uid matches the worker. Call the route FIRST, then persist the
      // canonical session it returns — a route failure (403/network) blocks
      // before any persist so the worker is never falsely told it started.
      const { session: started } = await startLoneWorkerSessionApi(selectedProject.id, {
        checkInIntervalMin: intervalMin,
        startedAt,
        ...(loc ? { lastKnownLocation: { ...loc, at: startedAt } } : {}),
      });
      await saveLoneWorkerSession(selectedProject.id, started);
      setFeedback(`Sesión iniciada (${started.id.slice(0, 12)}). Recordá hacer check-in cada ${intervalMin} min.`);
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('start lone worker failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }, [user, selectedProject, intervalMin, requestLocation]);

  const handleCheckIn = useCallback(
    async (session: LoneWorkerSession, status: 'ok' | 'help' = 'ok') => {
      if (!selectedProject) return;
      try {
        const loc = await requestLocation();
        const updated = recordCheckIn(session, {
          status,
          lat: loc?.lat,
          lng: loc?.lng,
        });
        await patchLoneWorkerSession(selectedProject.id, session.id, {
          checkIns: updated.checkIns,
          lastKnownLocation: updated.lastKnownLocation,
          status: updated.status,
        });
        setFeedback(
          status === 'help'
            ? t('lone_worker_page.feedback.help_recorded', 'Solicitud de ayuda registrada.')
            : t('lone_worker_page.feedback.checkin_recorded', 'Check-in registrado.'),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('checkIn failed', { err: msg });
        setFeedback(msg);
      }
    },
    [selectedProject, requestLocation, t],
  );

  const handleEndSession = useCallback(
    async (session: LoneWorkerSession) => {
      if (!selectedProject) return;
      try {
        const ended = endSession(session);
        await patchLoneWorkerSession(selectedProject.id, session.id, {
          endedAt: ended.endedAt,
          status: ended.status,
        });
        setFeedback(
          t('lone_worker_page.feedback.session_ended', {
            defaultValue: 'Sesión {{id}} finalizada.',
            id: session.id.slice(0, 12),
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('endSession failed', { err: msg });
        setFeedback(msg);
      }
    },
    [selectedProject, t],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary-token tracking-tight flex items-center gap-2">
              <UserCheck className="w-6 h-6 text-teal-500" /> {t('lone_worker_page.title', 'Trabajo solitario')}
            </h1>
            <p className="text-xs text-muted-token mt-1 max-w-2xl">
              {t(
                'lone_worker_page.subtitle',
                'Control de trabajadores operando en zonas remotas o aisladas. Check-in periódico obligatorio; sin respuesta se escala automáticamente (supervisor → brigada → servicios de emergencia).',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('lone_worker_page.cta_start', 'Iniciar sesión')}
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-default-token bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-muted-token">
            {t('lone_worker_page.empty.select_project', 'Seleccioná un proyecto para iniciar sesiones de trabajo solitario.')}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-muted-token">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {showForm && (
              <section className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-4 space-y-3">
                <h2 className="text-sm font-black text-teal-700 dark:text-teal-300 uppercase tracking-widest">
                  {t('lone_worker_page.form.heading', 'Nueva sesión')}
                </h2>
                <div className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('lone_worker_page.form.interval_label', 'Intervalo de check-in (minutos)')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {INTERVAL_PRESETS.map((min) => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => setIntervalMin(min)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                          intervalMin === min
                            ? 'bg-teal-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {t('lone_worker_page.form.interval_minutes', { defaultValue: '{{n}} min', n: min })}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-token">
                  {t(
                    'lone_worker_page.form.geo_note',
                    'Si activás la geolocalización, el check-in incluirá las coordenadas. La sesión es self-tracking (vos sos el worker).',
                  )}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-secondary-token hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    {t('common.cancel', 'Cancelar')}
                  </button>
                  <button
                    type="button"
                    onClick={handleStartSession}
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                    {t('lone_worker_page.form.submit', 'Iniciar')}
                  </button>
                </div>
              </section>
            )}

            {/* Supervisor overview: dense, criticality-sorted table whose
                status + escalation are computed SERVER-SIDE (authoritative
                "now", immune to device-clock skew that could silently bury an
                overdue). Fed the SAME real Firestore session list this page
                already subscribes to — no fabricated data. */}
            {selectedProject && (
              <section className="space-y-2" data-testid="lone_worker_page.admin_section">
                <h2 className="text-xs font-black text-muted-token uppercase tracking-widest">
                  {t('lone_worker_page.admin_panel.heading', 'Vista de supervisión')}
                </h2>
                <p className="text-[11px] text-muted-token">
                  {t(
                    'lone_worker_page.admin_panel.note',
                    'Estado y escalamiento calculados en el servidor (hora autoritativa, sin desfase de reloj del dispositivo). Ordenado por criticidad.',
                  )}
                </p>
                <LoneWorkerAdminPanel
                  projectId={selectedProject.id}
                  sessions={sessions}
                />
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-xs font-black text-muted-token uppercase tracking-widest">
                {t('lone_worker_page.active.heading', {
                  defaultValue: 'Sesiones activas ({{count}})',
                  count: activeSessions.length,
                })}
              </h2>
              {activeSessions.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('lone_worker_page.active.empty', 'No hay trabajadores solitarios activos en este proyecto.')}
                </div>
              ) : (
                <ul className="space-y-3">
                  {activeSessions.map(({ session, status, escalation }) => (
                    <li key={session.id} className="space-y-2">
                      <LoneWorkerCard
                        session={session}
                        status={status}
                        escalation={escalation}
                      />
                      <div className="flex flex-wrap gap-2">
                        {/* Botón check-in OK — visible para el worker de la sesión. */}
                        {user?.uid === session.workerUid && status !== 'ended' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCheckIn(session, 'ok')}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t('lone_worker_page.action.checkin_ok', 'Check-in OK')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCheckIn(session, 'help')}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5"
                            >
                              <Siren className="w-3.5 h-3.5" />
                              {t('lone_worker_page.action.help', 'Pedir ayuda')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEndSession(session)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-400 dark:hover:bg-zinc-600 flex items-center gap-1.5"
                            >
                              <Square className="w-3.5 h-3.5" />
                              {t('lone_worker_page.action.end', 'Finalizar')}
                            </button>
                          </>
                        )}
                        {/* Supervisor también puede forzar fin de sesión. */}
                        {user?.uid !== session.workerUid && status !== 'ended' && (
                          <button
                            type="button"
                            onClick={() => handleEndSession(session)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-400 dark:hover:bg-zinc-600"
                          >
                            {t('lone_worker_page.action.close_supervisor', 'Cerrar (supervisor)')}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {endedSessions.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-black text-muted-token uppercase tracking-widest">
                  {t('lone_worker_page.history.heading', 'Historial reciente')}
                </h2>
                <ul className="space-y-1">
                  {endedSessions.map(({ session }) => (
                    <li
                      key={session.id}
                      className="rounded-lg border border-default-token bg-white dark:bg-zinc-900/40 p-2 text-xs flex items-center gap-2"
                    >
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                        {t('lone_worker_page.history.closed_badge', 'Cerrada')}
                      </span>
                      <span className="text-secondary-token flex-1 truncate">
                        {t('lone_worker_page.history.row_summary', {
                          defaultValue: 'Worker {{uid}} · {{count}} check-ins',
                          uid: session.workerUid.slice(0, 12),
                          count: session.checkIns.length,
                        })}
                      </span>
                      <span className="text-[10px] text-muted-token">
                        {new Date(session.startedAt).toLocaleDateString('es-CL')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default LoneWorkerMonitor;
