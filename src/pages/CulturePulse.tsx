// Praeventio Guard — Sprint K §61-63 page wrapper.
//
// Cultura Preventiva — Encuesta de Percepción + Índice de Cultura +
// Reconocimiento. Esta página cierra el último eslabón del flujo §61-63
// que ya tenía servicio (`safetyCulturePulse`) + endpoints + hook
// implementados pero no era navegable: el ciclo predictivo
// (Detección Predictiva → Respuesta Adaptativa → Consolidación de
// Conocimiento) quedaba inerte aunque computePulseIndex y
// buildPulseTrend estuvieran listos.
//
// La página:
//   1. Renderiza un gauge circular con el índice de cultura (1-100) +
//      banda de color (rose <40, amber 40-69, teal 70-89, gold ≥90).
//   2. Muestra el sparkline de las últimas 6 olas (tendencia
//      determinística, sin librería externa de gráficos).
//   3. Lista top concerns + top strengths (preguntas con menor / mayor
//      score) para dirigir la respuesta adaptativa.
//   4. Banner activo si hay encuesta en curso → CTA "Responder encuesta"
//      cuando el usuario no ha respondido aún.
//   5. CTA "Nueva encuesta" — sólo admin.
//
// DIRECTIVA DE ANONIMATO (producto):
//   - El cliente NUNCA envía responderUid al servidor; el endpoint
//     deriva el hash desde el token verificado.
//   - El snapshot agrega métricas; nunca expone respuestas
//     individuales ni mapea hash → uid.
//   - El flag `hasResponded` del snapshot existe SÓLO para esconder el
//     CTA después de que el trabajador responde; el servidor compara
//     el hash derivado del caller contra los hashes en Firestore sin
//     reconstruir identidades.

import { useState, useMemo, useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, WifiOff, AlertTriangle, ThumbsUp, Plus, Send, X } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useCulturePulse,
  useCulturePulseHistory,
  scheduleCulturePulse,
  submitCulturePulseResponse,
  type CulturePulseQuestionKey,
  type CulturePulseHistoryPoint,
} from '../hooks/useCulturePulse';
import { logger } from '../utils/logger';
import { CulturePulseDashboard } from '../components/culturePulse/CulturePulseDashboard';

// ─────────────────────────────────────────────────────────────────────
// Color band — directiva de marca del usuario:
//   teal #4db6ac favorito + gold para "fortalezas máximas"; rose para
//   alerta. amber intermedio. No usar coral primario.
// ─────────────────────────────────────────────────────────────────────

interface ColorBand {
  textClass: string;
  bgClass: string;
  ringClass: string;
  label: string;
}

function bandFor(index: number): ColorBand {
  if (index < 40) {
    return {
      textClass: 'text-rose-500',
      bgClass: 'bg-rose-500/10',
      ringClass: 'ring-rose-500',
      label: 'Crítica',
    };
  }
  if (index < 70) {
    return {
      textClass: 'text-amber-500',
      bgClass: 'bg-amber-500/10',
      ringClass: 'ring-amber-500',
      label: 'En desarrollo',
    };
  }
  if (index < 90) {
    return {
      textClass: 'text-teal-500',
      bgClass: 'bg-teal-500/10',
      ringClass: 'ring-teal-500',
      label: 'Sólida',
    };
  }
  return {
    textClass: 'text-yellow-500',
    bgClass: 'bg-yellow-500/10',
    ringClass: 'ring-yellow-500',
    label: 'Ejemplar',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Gauge circular SVG — índice 0-100
// ─────────────────────────────────────────────────────────────────────

function CultureGauge({
  index,
  band,
}: {
  index: number;
  band: ColorBand;
}): ReactElement {
  // Mínimo 5% para que el arco se vea aún en índice 0.
  const pct = Math.max(0.05, Math.min(1, index / 100));
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const dash = pct * circumference;

  return (
    <div
      className={`relative w-44 h-44 rounded-full ${band.bgClass} flex items-center justify-center ring-2 ${band.ringClass}/40 shadow-lg`}
      data-testid="culture-pulse-gauge"
      data-index={index}
    >
      <svg
        className="absolute inset-0 -rotate-90"
        viewBox="0 0 160 160"
        aria-hidden="true"
      >
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="8"
        />
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={band.textClass}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center">
        <span
          className={`text-5xl font-black tabular-nums ${band.textClass}`}
          aria-label={`Índice ${index} de 100`}
        >
          {index}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mt-0.5">
          {band.label}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sparkline — últimas 6 olas, polyline SVG simple
// ─────────────────────────────────────────────────────────────────────

function Sparkline({
  points,
}: {
  points: CulturePulseHistoryPoint[];
}): ReactElement {
  if (points.length === 0) {
    return (
      <p className="text-xs text-secondary-token" data-testid="culture-pulse-sparkline-empty">
        Sin historial todavía. Programa la primera encuesta para empezar a medir.
      </p>
    );
  }
  const width = 240;
  const height = 60;
  const padding = 4;
  const maxValue = 100;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const xStep =
    points.length > 1 ? innerW / (points.length - 1) : 0;

  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = padding + innerH - (p.cultureIndex / maxValue) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const last = points[points.length - 1];
  const lastBand = bandFor(last.cultureIndex);

  return (
    <div data-testid="culture-pulse-sparkline" className="flex flex-col gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Tendencia últimas ${points.length} olas`}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={lastBand.textClass}
        />
        {points.map((p, i) => {
          const x = padding + i * xStep;
          const y = padding + innerH - (p.cultureIndex / maxValue) * innerH;
          return (
            <circle
              key={p.surveyId}
              cx={x}
              cy={y}
              r={i === points.length - 1 ? 3.5 : 2.5}
              className={
                i === points.length - 1 ? lastBand.textClass : 'text-secondary-token'
              }
              fill="currentColor"
            />
          );
        })}
      </svg>
      <p className="text-[11px] text-secondary-token">
        {points.length === 1
          ? `1 ola — índice ${last.cultureIndex}`
          : `${points.length} olas — actual ${last.cultureIndex}`}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Schedule modal — admin "Nueva encuesta"
// ─────────────────────────────────────────────────────────────────────

function ScheduleSurveyModal({
  projectId,
  onClose,
  onScheduled,
}: {
  projectId: string;
  onClose: () => void;
  onScheduled: () => void;
}): ReactElement {
  const [title, setTitle] = useState('');
  const [expected, setExpected] = useState('20');
  const [windowDays, setWindowDays] = useState('14');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const now = new Date();
      const closeAt = new Date(now);
      const days = Math.max(1, parseInt(windowDays, 10) || 14);
      closeAt.setDate(closeAt.getDate() + days);
      // Sanitize ID to passing regex on the server side.
      const safeId = `pulse-${now.toISOString().slice(0, 10).replace(/[^0-9-]/g, '')}-${now.getTime()}`;
      await scheduleCulturePulse(projectId, {
        surveyId: safeId,
        openAt: now.toISOString(),
        closeAt: closeAt.toISOString(),
        title: title.trim() || undefined,
        expectedRespondents: parseInt(expected, 10) || undefined,
      });
      onScheduled();
      onClose();
    } catch (err) {
      logger.error('culturePulse.schedule.failed', err);
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="culture-pulse-schedule-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-black uppercase tracking-tight text-primary-token">
            Nueva encuesta de cultura
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-secondary-token">
          La encuesta es anónima por diseño. Las respuestas no carrearán
          el identificador del trabajador.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-bold uppercase text-secondary-token">
            Título (opcional)
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-default-token bg-surface-2 px-3 py-2 text-sm text-primary-token"
              placeholder="Pulso mensual de cultura"
              data-testid="culture-pulse-modal-title"
            />
          </label>
          <label className="block text-xs font-bold uppercase text-secondary-token">
            Trabajadores esperados
            <input
              type="number"
              min={1}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="mt-1 w-full rounded-md border border-default-token bg-surface-2 px-3 py-2 text-sm text-primary-token"
              data-testid="culture-pulse-modal-expected"
            />
          </label>
          <label className="block text-xs font-bold uppercase text-secondary-token">
            Días abierta
            <input
              type="number"
              min={1}
              max={60}
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              className="mt-1 w-full rounded-md border border-default-token bg-surface-2 px-3 py-2 text-sm text-primary-token"
              data-testid="culture-pulse-modal-window"
            />
          </label>
        </div>
        {error && (
          <p
            className="mt-3 text-xs text-rose-500"
            role="alert"
            data-testid="culture-pulse-modal-error"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-xs font-bold text-secondary-token hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
            data-testid="culture-pulse-modal-submit"
          >
            <Plus className="w-3.5 h-3.5" /> Programar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Respond modal
// ─────────────────────────────────────────────────────────────────────

const PULSE_QUESTIONS: Array<{
  key: CulturePulseQuestionKey;
  label: string;
}> = [
  { key: 'felt_safe_today', label: 'Me sentí seguro hoy' },
  { key: 'manager_listens', label: 'Mi jefe escucha mis inquietudes' },
  { key: 'free_to_stop', label: 'Me siento libre de detener un trabajo inseguro' },
  { key: 'reported_incident_safely', label: 'Puedo reportar incidentes sin miedo' },
  { key: 'has_resources_to_be_safe', label: 'Tengo los recursos para trabajar seguro' },
];

function RespondModal({
  projectId,
  surveyId,
  onClose,
  onResponded,
}: {
  projectId: string;
  surveyId: string;
  onClose: () => void;
  onResponded: () => void;
}): ReactElement {
  const [answers, setAnswers] = useState<Record<CulturePulseQuestionKey, number>>({
    felt_safe_today: 3,
    manager_listens: 3,
    free_to_stop: 3,
    reported_incident_safely: 3,
    has_resources_to_be_safe: 3,
  });
  const [workerRole, setWorkerRole] = useState('worker');
  const [area, setArea] = useState('general');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitCulturePulseResponse(projectId, surveyId, {
        workerRole,
        area,
        answers,
      });
      onResponded();
      onClose();
    } catch (err) {
      logger.error('culturePulse.respond.failed', err);
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="culture-pulse-respond-modal"
    >
      <div className="w-full max-w-lg rounded-2xl border border-default-token bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-black uppercase tracking-tight text-primary-token">
            Responder encuesta
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-secondary-token">
          Tus respuestas son anónimas. Cada pregunta es 1 (muy en desacuerdo)
          a 5 (muy de acuerdo).
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-[11px] font-bold uppercase text-secondary-token">
            Rol
            <input
              type="text"
              value={workerRole}
              onChange={(e) => setWorkerRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-default-token bg-surface-2 px-2 py-1.5 text-sm text-primary-token"
              data-testid="culture-pulse-respond-role"
            />
          </label>
          <label className="block text-[11px] font-bold uppercase text-secondary-token">
            Área
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="mt-1 w-full rounded-md border border-default-token bg-surface-2 px-2 py-1.5 text-sm text-primary-token"
              data-testid="culture-pulse-respond-area"
            />
          </label>
        </div>
        <div className="mt-4 space-y-3">
          {PULSE_QUESTIONS.map((q) => (
            <div key={q.key} data-testid={`culture-pulse-respond-q-${q.key}`}>
              <p className="text-sm font-medium text-primary-token">{q.label}</p>
              <div
                className="mt-1 flex items-center gap-1"
                role="radiogroup"
                aria-label={q.label}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      setAnswers((prev) => ({ ...prev, [q.key]: n }))
                    }
                    className={`flex-1 rounded-md border px-2 py-1.5 text-sm font-bold ${
                      answers[q.key] === n
                        ? 'border-teal-500 bg-teal-500/10 text-teal-500'
                        : 'border-default-token text-secondary-token hover:bg-surface-2'
                    }`}
                    aria-pressed={answers[q.key] === n}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <p
            className="mt-3 text-xs text-rose-500"
            role="alert"
            data-testid="culture-pulse-respond-error"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-xs font-bold text-secondary-token hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
            data-testid="culture-pulse-respond-submit"
          >
            <Send className="w-3.5 h-3.5" /> Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export function CulturePulse(): ReactElement {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { isAdmin } = useFirebase();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const pulseResp = useCulturePulse(projectId);
  const historyResp = useCulturePulseHistory(projectId);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showRespondModal, setShowRespondModal] = useState(false);

  const snapshot = pulseResp.data?.snapshot ?? null;
  const history = useMemo(
    () => historyResp.data?.history ?? [],
    [historyResp.data],
  );

  const handleRefresh = () => {
    pulseResp.refetch();
    historyResp.refetch();
  };

  // Auto-close respond CTA after the page refetches `hasResponded=true`.
  useEffect(() => {
    if (snapshot?.hasResponded) {
      setShowRespondModal(false);
    }
  }, [snapshot?.hasResponded]);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="culture-pulse-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <HeartPulse className="w-12 h-12 mx-auto mb-4 text-rose-500" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('culturePulse.page.title', 'Cultura Preventiva')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'culturePulse.page.selectProject',
              'Selecciona un proyecto para ver el pulso de cultura preventiva.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const loading = pulseResp.loading || historyResp.loading;
  const error = pulseResp.error || historyResp.error;

  // The gauge defaults to 0 / band 'low' when snapshot is null.
  const cultureIndex = snapshot?.cultureIndex ?? 0;
  const band = bandFor(cultureIndex);
  const activeSurvey =
    snapshot && snapshot.surveyId && snapshot.status === 'open'
      ? snapshot
      : null;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="culture-pulse-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <HeartPulse className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('culturePulse.page.title', 'Cultura Preventiva')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'culturePulse.page.subtitle',
              'Encuesta de Percepción + Índice de Cultura — Sprint K §61-63. Anónimo por diseño.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="culture-pulse-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowScheduleModal(true)}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-2 text-xs font-bold uppercase text-white"
            data-testid="culture-pulse-new-survey-btn"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva encuesta
          </button>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="culture-pulse-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="culture-pulse-error"
          role="alert"
        >
          {t('culturePulse.page.error', 'No se pudo cargar el pulso: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Active survey banner */}
          {activeSurvey && (
            <div
              className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 flex flex-wrap items-center gap-3"
              data-testid="culture-pulse-active-banner"
            >
              <HeartPulse className="w-5 h-5 text-teal-500 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-primary-token">
                  Encuesta en curso —{' '}
                  {activeSurvey.totalResponses} respuestas
                  {typeof activeSurvey.participationRate === 'number' &&
                    ` (${Math.round(activeSurvey.participationRate * 100)}% participación)`}
                </p>
                <p className="text-xs text-secondary-token">
                  Cierra el {new Date(activeSurvey.closeAt ?? '').toLocaleDateString()}
                </p>
              </div>
              {!activeSurvey.hasResponded && (
                <button
                  type="button"
                  onClick={() => setShowRespondModal(true)}
                  className="flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-2 text-xs font-bold uppercase text-white"
                  data-testid="culture-pulse-respond-btn"
                >
                  <Send className="w-3.5 h-3.5" /> Responder encuesta
                </button>
              )}
              {activeSurvey.hasResponded && (
                <span
                  className="text-[11px] font-bold uppercase text-teal-600 dark:text-teal-400"
                  data-testid="culture-pulse-already-responded"
                >
                  Ya respondiste — gracias
                </span>
              )}
            </div>
          )}

          {/*
            Codex P1 #3 (PR #323) — Anonymity threshold banner.
            Cuando el snapshot suprime agregados por anonimato, NO renderizamos
            gauge, top concerns ni top strengths. Mostramos en su lugar un
            panel explicando por qué el sistema espera más respuestas. Es
            UX-positivo: el trabajador entiende que su privacidad se respeta.
          */}
          {snapshot?.insufficientResponses ? (
            <div
              className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5"
              data-testid="culture-pulse-anonymity-gate"
            >
              <div className="flex items-start gap-3">
                <HeartPulse className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
                    Anonimato protegido — esperando más respuestas
                  </h2>
                  <p className="mt-1 text-xs text-secondary-token">
                    Para garantizar que las respuestas sean realmente anónimas,
                    el panel se desbloquea cuando hay al menos{' '}
                    <strong>{snapshot.threshold ?? 5} respuestas</strong>.
                    Llevamos{' '}
                    <strong>
                      {snapshot.currentCount ?? snapshot.totalResponses ?? 0} de{' '}
                      {snapshot.threshold ?? 5}
                    </strong>
                    .
                  </p>
                  <p className="mt-1 text-[11px] text-secondary-token">
                    Mostrar agregados con pocas respuestas podría permitir
                    inferir quién respondió qué — y la directiva del producto
                    es que ningún supervisor pueda re-identificar voces.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Gauge + sparkline */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-default-token bg-surface p-5 flex flex-col items-center justify-center gap-3">
                  <CultureGauge index={cultureIndex} band={band} />
                  <p className="text-[11px] uppercase tracking-widest text-secondary-token">
                    Índice de Cultura Preventiva
                  </p>
                  {snapshot?.punitiveCulturedFlagged && (
                    <p
                      className="text-[11px] font-bold uppercase tracking-widest text-rose-500 flex items-center gap-1"
                      data-testid="culture-pulse-punitive-flag"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Posible cultura punitiva
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-default-token bg-surface p-5">
                  <h2 className="text-xs font-black uppercase tracking-widest text-secondary-token mb-3">
                    Tendencia — últimas {history.length || 0} olas
                  </h2>
                  <Sparkline points={history} />
                </div>
              </div>

              {/* Top concerns + strengths */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4"
                  data-testid="culture-pulse-concerns"
                >
                  <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-3">
                    <AlertTriangle className="w-3.5 h-3.5" /> Prioridades
                  </h2>
                  {snapshot && snapshot.topConcerns.length > 0 ? (
                    <ul className="space-y-2">
                      {snapshot.topConcerns.slice(0, 5).map((c) => (
                        <li
                          key={c.key}
                          className="flex items-center justify-between gap-2 text-sm text-primary-token"
                          data-testid={`culture-pulse-concern-${c.key}`}
                        >
                          <span className="truncate">{c.label}</span>
                          <span className="text-xs font-bold tabular-nums text-rose-500">
                            {c.score.toFixed(1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-secondary-token">
                      Sin respuestas todavía.
                    </p>
                  )}
                </div>
                <div
                  className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4"
                  data-testid="culture-pulse-strengths"
                >
                  <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 mb-3">
                    <ThumbsUp className="w-3.5 h-3.5" /> Fortalezas
                  </h2>
                  {snapshot && snapshot.topStrengths.length > 0 ? (
                    <ul className="space-y-2">
                      {snapshot.topStrengths.slice(0, 5).map((s) => (
                        <li
                          key={s.key}
                          className="flex items-center justify-between gap-2 text-sm text-primary-token"
                          data-testid={`culture-pulse-strength-${s.key}`}
                        >
                          <span className="truncate">{s.label}</span>
                          <span className="text-xs font-bold tabular-nums text-teal-500">
                            {s.score.toFixed(1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-secondary-token">
                      Sin respuestas todavía.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <CulturePulseDashboard responses={[]} />

      {showScheduleModal && projectId && (
        <ScheduleSurveyModal
          projectId={projectId}
          onClose={() => setShowScheduleModal(false)}
          onScheduled={handleRefresh}
        />
      )}
      {showRespondModal && projectId && activeSurvey?.surveyId && (
        <RespondModal
          projectId={projectId}
          surveyId={activeSurvey.surveyId}
          onClose={() => setShowRespondModal(false)}
          onResponded={handleRefresh}
        />
      )}
    </div>
  );
}

export default CulturePulse;
