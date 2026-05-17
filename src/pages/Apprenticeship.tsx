// Praeventio Guard — Sprint K §244-250 page wrapper.
//
// Aprendices + Mentoría + Autorización Progresiva + Exposición a Tareas.
// Cierra la pieza UI del flujo §244-250 que ya tenía servicio
// determinístico (`apprenticeshipProgressService.ts`) pero no estaba
// accesible desde la navegación: el motor de autorización progresiva
// quedaba inerte aunque calculara correctamente niveles y rotación.
//
// Esta página:
//   1. Columna izquierda — lista de aprendices con su mentor, nivel
//      global (none/observer/supervised/autonomous), barra de progreso
//      hacia autonomía y las 5 exposiciones más recientes.
//   2. Columna derecha — lista de mentores con su carga actual (max 3
//      aprendices por §245). Indicador verde/amber/red según slots
//      disponibles.
//   3. CTA "Registrar aprendiz" → modal con uid + mentorUid + rol +
//      fecha de ingreso.
//   4. CTA "Autorizar" en cada card de aprendiz → modal con taskKind +
//      nivel a otorgar + evidencia. Server valida que el firmante sea
//      el mentor registrado (§245).
//   5. CTA "Registrar exposición" → sub-modal con taskKind + outcome
//      + supervisor presente.
//
// NO bloquea operación. Las exposiciones se registran como
// observación supervisada — la decisión de ejecutar una tarea sigue
// siendo del supervisor. Honor a §246-247: el motor solo alerta sobre
// sobreexposición a tareas repetitivas (riesgo músculo-esquelético),
// no detiene el trabajo.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserCheck,
  WifiOff,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Users,
  ShieldCheck,
  GraduationCap,
  Clock,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useApprentices,
  useMentorAvailability,
  registerApprentice,
  authorizeApprentice,
  recordExposure,
  type ApprenticeRecord,
  type ApprenticeAuthLevel,
  type ApprenticeRole,
  type ApprenticeExposureOutcome,
} from '../hooks/useSprintK';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────

const LEVEL_META: Record<
  ApprenticeAuthLevel,
  { label: string; color: string; bg: string; border: string }
> = {
  none: {
    label: 'Sin observar',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
  },
  observer: {
    label: 'Observador',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  supervised: {
    label: 'Asistente (supervisado)',
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  autonomous: {
    label: 'Autorizado',
    color: 'text-teal-600',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
  },
};

const ROLE_OPTIONS: { value: ApprenticeRole; label: string }[] = [
  { value: 'aprendiz', label: 'Aprendiz' },
  { value: 'nuevo_ingreso', label: 'Nuevo ingreso' },
  { value: 'practicante', label: 'Practicante' },
  { value: 'trabajador_general', label: 'Trabajador general' },
];

const OUTCOME_META: Record<
  ApprenticeExposureOutcome,
  { label: string; color: string }
> = {
  success: {
    label: 'Sin novedad',
    color: 'text-emerald-600',
  },
  partial: {
    label: 'Parcial',
    color: 'text-amber-600',
  },
  unsafe: {
    label: 'Insegura',
    color: 'text-rose-600',
  },
};

/** Color band para barra de progreso (0..100). */
function progressColor(progress: number): string {
  if (progress >= 80) return 'bg-teal-500';
  if (progress >= 50) return 'bg-blue-500';
  if (progress >= 20) return 'bg-amber-500';
  return 'bg-zinc-400';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────

export function Apprenticeship() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const apprenticesResp = useApprentices(projectId);
  const mentorsResp = useMentorAvailability(projectId);

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [authorizeFor, setAuthorizeFor] = useState<ApprenticeRecord | null>(
    null,
  );
  const [exposeFor, setExposeFor] = useState<ApprenticeRecord | null>(null);

  const apprentices: ApprenticeRecord[] = useMemo(
    () => apprenticesResp.data?.apprentices ?? [],
    [apprenticesResp.data],
  );
  const mentors = useMemo(
    () => mentorsResp.data?.mentors ?? [],
    [mentorsResp.data],
  );
  const maxLoad = mentorsResp.data?.maxLoad ?? 3;

  const loading = apprenticesResp.loading || mentorsResp.loading;
  const error = apprenticesResp.error || mentorsResp.error;

  const refetchAll = () => {
    apprenticesResp.refetch?.();
    mentorsResp.refetch?.();
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto"
        data-testid="apprenticeship-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <UserCheck
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('apprenticeship.page.title', 'Aprendices y Mentores')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'apprenticeship.page.selectProject',
              'Selecciona un proyecto para ver el programa de mentoría y autorización progresiva.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto space-y-4"
      data-testid="apprenticeship-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <UserCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('apprenticeship.page.title', 'Aprendices y Mentores')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'apprenticeship.page.subtitle',
              '§244-250 — Autorización progresiva + Mentoría 1:3 + Exposición a tareas (DS 76 / DS 40).',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="apprenticeship-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowRegisterModal(true)}
          className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-600"
          data-testid="apprenticeship-register-button"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('apprenticeship.action.register', 'Registrar aprendiz')}
        </button>
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="apprenticeship-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="apprenticeship-error"
          role="alert"
        >
          {t(
            'apprenticeship.page.error',
            'No se pudo cargar el programa: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Aprendices column */}
          <section
            className="lg:col-span-2 space-y-3"
            aria-label="Aprendices"
            data-testid="apprenticeship-apprentices-section"
          >
            <h2 className="text-xs font-black uppercase tracking-widest text-secondary-token flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />
              {t('apprenticeship.section.apprentices', 'Aprendices')} ·{' '}
              {apprentices.length}
            </h2>

            {apprentices.length === 0 && (
              <div
                className="rounded-2xl border border-default-token bg-surface p-8 text-center"
                data-testid="apprenticeship-apprentices-empty"
              >
                <GraduationCap
                  className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                  aria-hidden="true"
                />
                <p className="text-sm text-secondary-token italic">
                  {t(
                    'apprenticeship.apprentices.empty',
                    'Aún no hay aprendices registrados. Comienza con "Registrar aprendiz".',
                  )}
                </p>
              </div>
            )}

            {apprentices.length > 0 && (
              <ul
                className="space-y-2"
                data-testid="apprenticeship-apprentices-list"
              >
                {apprentices.map((a) => {
                  const meta = LEVEL_META[a.currentLevel];
                  return (
                    <li
                      key={a.workerUid}
                      className={`rounded-xl border bg-surface p-3 shadow-mode space-y-2 ${meta.border}`}
                      data-testid={`apprenticeship-apprentice-${a.workerUid}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-teal-500/10 text-teal-600 flex items-center justify-center shrink-0">
                          <UserCheck className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-primary-token truncate">
                            {a.workerUid}
                          </p>
                          <p className="text-[11px] text-secondary-token">
                            {t('apprenticeship.card.mentor', 'Mentor')}:{' '}
                            <span className="font-mono">{a.mentorUid}</span> ·{' '}
                            {ROLE_OPTIONS.find((r) => r.value === a.role)
                              ?.label ?? a.role}{' '}
                            · {t('apprenticeship.card.since', 'desde')}{' '}
                            {formatDate(a.startDate)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${meta.color} ${meta.bg} ${meta.border}`}
                          data-testid={`apprenticeship-level-${a.workerUid}`}
                        >
                          {meta.label}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary-token">
                          <span>
                            {t(
                              'apprenticeship.card.progress',
                              'Progreso a autonomía',
                            )}
                          </span>
                          <span
                            className="font-mono font-bold"
                            data-testid={`apprenticeship-progress-${a.workerUid}`}
                          >
                            {a.progress}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                          <div
                            className={`h-full ${progressColor(a.progress)} transition-all`}
                            style={{ width: `${Math.min(100, Math.max(0, a.progress))}%` }}
                          />
                        </div>
                      </div>

                      {/* Recent exposures */}
                      {a.recentExposures.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wide text-secondary-token">
                            {t(
                              'apprenticeship.card.recentExposures',
                              'Exposiciones recientes',
                            )}
                          </p>
                          <ul
                            className="space-y-0.5"
                            data-testid={`apprenticeship-exposures-${a.workerUid}`}
                          >
                            {a.recentExposures.slice(0, 3).map((e) => {
                              const om = OUTCOME_META[e.outcome];
                              return (
                                <li
                                  key={e.id}
                                  className="flex items-center gap-1.5 text-[11px]"
                                >
                                  <Clock
                                    className="w-3 h-3 text-secondary-token shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span className="text-primary-token truncate flex-1">
                                    {e.taskKind}
                                  </span>
                                  <span
                                    className={`shrink-0 font-bold ${om.color}`}
                                  >
                                    {om.label}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => setExposeFor(a)}
                          className="rounded-md border border-default-token px-2.5 py-1 text-[11px] font-bold text-secondary-token hover:text-primary-token transition-colors"
                          data-testid={`apprenticeship-expose-button-${a.workerUid}`}
                        >
                          {t(
                            'apprenticeship.action.expose',
                            'Registrar exposición',
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuthorizeFor(a)}
                          className="rounded-md bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:bg-blue-500/20 transition-colors"
                          data-testid={`apprenticeship-authorize-button-${a.workerUid}`}
                        >
                          {t('apprenticeship.action.authorize', 'Autorizar')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Mentores column */}
          <section
            className="space-y-3"
            aria-label="Mentores"
            data-testid="apprenticeship-mentors-section"
          >
            <h2 className="text-xs font-black uppercase tracking-widest text-secondary-token flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              {t('apprenticeship.section.mentors', 'Mentores')} ·{' '}
              {mentors.length}
            </h2>

            {mentors.length === 0 && (
              <div
                className="rounded-2xl border border-default-token bg-surface p-6 text-center"
                data-testid="apprenticeship-mentors-empty"
              >
                <Users
                  className="w-8 h-8 mx-auto mb-2 text-secondary-token"
                  aria-hidden="true"
                />
                <p className="text-xs text-secondary-token italic">
                  {t(
                    'apprenticeship.mentors.empty',
                    'No hay mentores asignados todavía. Al registrar un aprendiz se calcula la carga del mentor.',
                  )}
                </p>
              </div>
            )}

            {mentors.length > 0 && (
              <ul
                className="space-y-2"
                data-testid="apprenticeship-mentors-list"
              >
                {mentors.map((m) => (
                  <li
                    key={m.mentorUid}
                    className={`rounded-xl border bg-surface p-3 shadow-mode ${
                      m.available
                        ? 'border-emerald-500/30'
                        : 'border-rose-500/30'
                    }`}
                    data-testid={`apprenticeship-mentor-${m.mentorUid}`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          m.available
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-primary-token truncate font-mono">
                          {m.mentorUid}
                        </p>
                        <p className="text-[11px] text-secondary-token">
                          {t('apprenticeship.mentor.load', 'Carga')}:{' '}
                          <span
                            className="font-bold"
                            data-testid={`apprenticeship-mentor-load-${m.mentorUid}`}
                          >
                            {m.currentLoad}/{m.maxLoad}
                          </span>
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase ${
                          m.available
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                        data-testid={`apprenticeship-mentor-status-${m.mentorUid}`}
                      >
                        {m.available
                          ? `${m.availableSlots} ${t('apprenticeship.mentor.slots', 'slot(s)')}`
                          : t('apprenticeship.mentor.full', 'Tope')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-secondary-token italic px-1">
              {t(
                'apprenticeship.mentor.maxNote',
                'Máx. {{max}} aprendices simultáneos por mentor (§245).',
                { max: maxLoad },
              )}
            </p>
          </section>
        </div>
      )}

      {/* Register apprentice modal */}
      {showRegisterModal && projectId && (
        <RegisterApprenticeModal
          projectId={projectId}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={() => {
            setShowRegisterModal(false);
            refetchAll();
          }}
        />
      )}

      {/* Authorize modal */}
      {authorizeFor && projectId && (
        <AuthorizeApprenticeModal
          projectId={projectId}
          apprentice={authorizeFor}
          onClose={() => setAuthorizeFor(null)}
          onSuccess={() => {
            setAuthorizeFor(null);
            refetchAll();
          }}
        />
      )}

      {/* Expose modal */}
      {exposeFor && projectId && (
        <RecordExposureModal
          projectId={projectId}
          apprentice={exposeFor}
          onClose={() => setExposeFor(null)}
          onSuccess={() => {
            setExposeFor(null);
            refetchAll();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Inline modals
// ────────────────────────────────────────────────────────────────────────

interface RegisterModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function RegisterApprenticeModal({
  projectId,
  onClose,
  onSuccess,
}: RegisterModalProps) {
  const { t } = useTranslation();
  const [uid, setUid] = useState('');
  const [mentorUid, setMentorUid] = useState('');
  const [role, setRole] = useState<ApprenticeRole>('aprendiz');
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (uid.trim().length < 1) {
      setError(
        t(
          'apprenticeship.register.errorUid',
          'El UID del aprendiz es obligatorio.',
        ) as string,
      );
      return;
    }
    if (mentorUid.trim().length < 1) {
      setError(
        t(
          'apprenticeship.register.errorMentor',
          'El UID del mentor es obligatorio.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await registerApprentice(projectId, {
        uid: uid.trim(),
        mentorUid: mentorUid.trim(),
        role,
        startDate: new Date(startDate).toISOString(),
      });
      logger.info('apprenticeship.register.ok', { projectId, uid, role });
      onSuccess();
    } catch (err) {
      logger.error('apprenticeship.register.failed', err);
      setError(
        (err as Error).message ||
          (t(
            'apprenticeship.register.errorSubmit',
            'No se pudo registrar el aprendiz.',
          ) as string),
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
      data-testid="apprenticeship-register-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-teal-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('apprenticeship.register.title', 'Registrar aprendiz')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid="apprenticeship-register-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.register.uid', 'UID del aprendiz')}
            </span>
            <input
              type="text"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              placeholder="uid_aprendiz"
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm font-mono"
              data-testid="apprenticeship-register-modal-uid"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.register.mentor', 'UID del mentor')}
            </span>
            <input
              type="text"
              value={mentorUid}
              onChange={(e) => setMentorUid(e.target.value)}
              placeholder="uid_mentor"
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm font-mono"
              data-testid="apprenticeship-register-modal-mentor"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.register.role', 'Rol')}
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ApprenticeRole)}
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-register-modal-role"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.register.startDate', 'Fecha de ingreso')}
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-register-modal-date"
            />
          </label>
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="apprenticeship-register-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="apprenticeship-register-modal-cancel"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="apprenticeship-register-modal-submit"
          >
            {submitting
              ? t('common.submitting', 'Guardando…')
              : t('apprenticeship.register.submit', 'Registrar')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AuthorizeModalProps {
  projectId: string;
  apprentice: ApprenticeRecord;
  onClose: () => void;
  onSuccess: () => void;
}

function AuthorizeApprenticeModal({
  projectId,
  apprentice,
  onClose,
  onSuccess,
}: AuthorizeModalProps) {
  const { t } = useTranslation();
  const [taskKind, setTaskKind] = useState('');
  const [toLevel, setToLevel] =
    useState<Exclude<ApprenticeAuthLevel, 'none'>>('observer');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (taskKind.trim().length < 1) {
      setError(
        t(
          'apprenticeship.authorize.errorTaskKind',
          'Indica la tarea a autorizar.',
        ) as string,
      );
      return;
    }
    if (evidence.trim().length < 3) {
      setError(
        t(
          'apprenticeship.authorize.errorEvidence',
          'La evidencia debe tener al menos 3 caracteres.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authorizeApprentice(projectId, apprentice.workerUid, {
        taskKind: taskKind.trim(),
        toLevel,
        signedByUid: apprentice.mentorUid,
        evidence: evidence.trim(),
      });
      logger.info('apprenticeship.authorize.ok', {
        projectId,
        workerUid: apprentice.workerUid,
        taskKind,
        toLevel,
      });
      onSuccess();
    } catch (err) {
      logger.error('apprenticeship.authorize.failed', err);
      setError(
        (err as Error).message ||
          (t(
            'apprenticeship.authorize.errorSubmit',
            'No se pudo autorizar.',
          ) as string),
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
      data-testid="apprenticeship-authorize-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <CheckCircle2
            className="w-5 h-5 text-blue-500"
            aria-hidden="true"
          />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('apprenticeship.authorize.title', 'Autorizar tarea')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid="apprenticeship-authorize-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <p className="text-xs text-secondary-token">
          {t('apprenticeship.authorize.intro', 'Aprendiz')}:{' '}
          <span className="font-mono font-bold text-primary-token">
            {apprentice.workerUid}
          </span>{' '}
          · {t('apprenticeship.card.mentor', 'Mentor')}:{' '}
          <span className="font-mono">{apprentice.mentorUid}</span>
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.authorize.taskKind', 'Tarea')}
            </span>
            <input
              type="text"
              value={taskKind}
              onChange={(e) => setTaskKind(e.target.value)}
              placeholder="loto_basico"
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-authorize-modal-task"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.authorize.toLevel', 'Nivel a otorgar')}
            </span>
            <select
              value={toLevel}
              onChange={(e) =>
                setToLevel(
                  e.target.value as Exclude<ApprenticeAuthLevel, 'none'>,
                )
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-authorize-modal-level"
            >
              <option value="observer">{LEVEL_META.observer.label}</option>
              <option value="supervised">{LEVEL_META.supervised.label}</option>
              <option value="autonomous">{LEVEL_META.autonomous.label}</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.authorize.evidence', 'Evidencia')}
            </span>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={3}
              placeholder={
                t(
                  'apprenticeship.authorize.evidencePlaceholder',
                  'Ej: 10 ejecuciones supervisadas sin incidentes, evaluación oral OK.',
                ) as string
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-authorize-modal-evidence"
            />
          </label>
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="apprenticeship-authorize-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="apprenticeship-authorize-modal-cancel"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="apprenticeship-authorize-modal-submit"
          >
            {submitting
              ? t('common.submitting', 'Guardando…')
              : t('apprenticeship.authorize.submit', 'Autorizar')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExposeModalProps {
  projectId: string;
  apprentice: ApprenticeRecord;
  onClose: () => void;
  onSuccess: () => void;
}

function RecordExposureModal({
  projectId,
  apprentice,
  onClose,
  onSuccess,
}: ExposeModalProps) {
  const { t } = useTranslation();
  // Pre-fill task list from the apprentice's existing authorizations so
  // the supervisor doesn't have to retype task names. Empty string means
  // "use the custom input below".
  const knownTasks = useMemo(
    () => Object.keys(apprentice.taskAuthorizations ?? {}),
    [apprentice.taskAuthorizations],
  );
  const [selectedKnown, setSelectedKnown] = useState<string>(
    knownTasks[0] ?? '',
  );
  const [customTask, setCustomTask] = useState('');
  const [supervisedBy, setSupervisedBy] = useState(apprentice.mentorUid);
  const [outcome, setOutcome] =
    useState<ApprenticeExposureOutcome>('success');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const taskKind = (customTask.trim() || selectedKnown).trim();
    if (taskKind.length < 1) {
      setError(
        t(
          'apprenticeship.expose.errorTask',
          'Indica la tarea ejecutada.',
        ) as string,
      );
      return;
    }
    if (supervisedBy.trim().length < 1) {
      setError(
        t(
          'apprenticeship.expose.errorSupervisor',
          'Indica el supervisor presente.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recordExposure(projectId, apprentice.workerUid, {
        taskKind,
        supervisedBy: supervisedBy.trim(),
        outcome,
        notes: notes.trim() || undefined,
      });
      logger.info('apprenticeship.expose.ok', {
        projectId,
        workerUid: apprentice.workerUid,
        taskKind,
        outcome,
      });
      onSuccess();
    } catch (err) {
      logger.error('apprenticeship.expose.failed', err);
      setError(
        (err as Error).message ||
          (t(
            'apprenticeship.expose.errorSubmit',
            'No se pudo registrar la exposición.',
          ) as string),
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
      data-testid="apprenticeship-expose-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-teal-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('apprenticeship.expose.title', 'Registrar exposición')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid="apprenticeship-expose-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <p className="text-xs text-secondary-token">
          {t('apprenticeship.expose.intro', 'Aprendiz')}:{' '}
          <span className="font-mono font-bold text-primary-token">
            {apprentice.workerUid}
          </span>
        </p>

        <div className="space-y-3">
          {knownTasks.length > 0 && (
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                {t('apprenticeship.expose.knownTask', 'Tarea conocida')}
              </span>
              <select
                value={selectedKnown}
                onChange={(e) => {
                  setSelectedKnown(e.target.value);
                  setCustomTask('');
                }}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="apprenticeship-expose-modal-known"
              >
                {knownTasks.map((k) => (
                  <option key={k} value={k}>
                    {k} ({apprentice.taskAuthorizations[k]})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.expose.customTask', 'O tarea nueva')}
            </span>
            <input
              type="text"
              value={customTask}
              onChange={(e) => setCustomTask(e.target.value)}
              placeholder="loto_avanzado"
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-expose-modal-custom"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t(
                'apprenticeship.expose.supervisedBy',
                'Supervisor presente (UID)',
              )}
            </span>
            <input
              type="text"
              value={supervisedBy}
              onChange={(e) => setSupervisedBy(e.target.value)}
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm font-mono"
              data-testid="apprenticeship-expose-modal-supervisor"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.expose.outcome', 'Resultado')}
            </span>
            <select
              value={outcome}
              onChange={(e) =>
                setOutcome(e.target.value as ApprenticeExposureOutcome)
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-expose-modal-outcome"
            >
              <option value="success">{OUTCOME_META.success.label}</option>
              <option value="partial">{OUTCOME_META.partial.label}</option>
              <option value="unsafe">{OUTCOME_META.unsafe.label}</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('apprenticeship.expose.notes', 'Notas (opcional)')}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="apprenticeship-expose-modal-notes"
            />
          </label>
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="apprenticeship-expose-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="apprenticeship-expose-modal-cancel"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="apprenticeship-expose-modal-submit"
          >
            {submitting
              ? t('common.submitting', 'Guardando…')
              : t('apprenticeship.expose.submit', 'Registrar')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Apprenticeship;
