// Praeventio Guard — Sprint 33 wire W4 (2026-05-17).
//
// `IncidentReport.tsx` — formulario minimalista para reportar near-miss /
// incidente / post-mortem desde mobile/terreno. Wire al endpoint canónico
// `POST /api/incidents/report` (verifyAuth + idempotencyKey + Zod validate).
//
// Diseño:
//   • UI minimalista glove-operable: campos grandes, foco en una tarea
//     (reportar), botones >= 56px de alto.
//   • El "auto-tipo" es near_miss por default — la cultura POSITIVA: la
//     mayoría de los reportes valiosos son near-miss (Heinrich pyramid).
//     El trabajador puede escalar a incident/post_mortem si aplica.
//   • Idempotency-Key derivado de timestamp+rand para evitar duplicados en
//     re-tap accidentales o reconexión offline (mismo pattern que Stripe).
//   • Cero PII en logs del cliente; el server emite el audit row.
//
// Gamificación: la respuesta incluye `xpAwarded`, mostrada como confirmación
// inline (banner "+10 XP por reportar un near-miss"). Refuerzo positivo
// inmediato. Si la app está offline, el banner sólo aparece tras flush.

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Send,
  Sparkles,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { auth } from '../services/firebase';
import { logger } from '../utils/logger';
import { apiAuthHeader } from '../lib/apiAuth';

type IncidentEventType = 'near_miss' | 'incident' | 'post_mortem';
type IncidentSeverity = 'low' | 'med' | 'high' | 'critical';

interface ReportResponse {
  success: boolean;
  incidentId: string;
  path: string;
  xpAwarded: number;
  indexed: boolean;
}

const TYPE_OPTIONS: Array<{
  value: IncidentEventType;
  labelKey: string;
  hintKey: string;
}> = [
  {
    value: 'near_miss',
    labelKey: 'incident_report.type_near_miss_label',
    hintKey: 'incident_report.type_near_miss_hint',
  },
  {
    value: 'incident',
    labelKey: 'incident_report.type_incident_label',
    hintKey: 'incident_report.type_incident_hint',
  },
  {
    value: 'post_mortem',
    labelKey: 'incident_report.type_post_mortem_label',
    hintKey: 'incident_report.type_post_mortem_hint',
  },
];

const SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity;
  labelKey: string;
  badge: string;
}> = [
  { value: 'low', labelKey: 'incident_report.sev_low', badge: 'bg-emerald-500/10 text-emerald-700' },
  { value: 'med', labelKey: 'incident_report.sev_med', badge: 'bg-amber-500/10 text-amber-700' },
  { value: 'high', labelKey: 'incident_report.sev_high', badge: 'bg-orange-500/10 text-orange-700' },
  {
    value: 'critical',
    labelKey: 'incident_report.sev_critical',
    badge: 'bg-rose-500/10 text-rose-700',
  },
];

function generateIdempotencyKey(): string {
  return `inc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function IncidentReport() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [incidentType, setIncidentType] = useState<IncidentEventType>('near_miss');
  const [severity, setSeverity] = useState<IncidentSeverity>('med');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [witnessesText, setWitnessesText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Idempotency key persistente durante el ciclo del formulario — si el
  // worker da re-tap (red flaky), el server replay el mismo response.
  const idempotencyKey = useMemo(() => generateIdempotencyKey(), [result?.incidentId]);

  const canSubmit =
    !submitting &&
    !!selectedProject?.id &&
    description.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        setError(t('incident_report.err_must_login'));
        setSubmitting(false);
        return;
      }
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const witnesses = witnessesText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 50);
      const res = await fetch('/api/incidents/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          projectId: selectedProject!.id,
          incidentType,
          severity,
          description: description.trim(),
          location: location.trim() || undefined,
          witnesses: witnesses.length > 0 ? witnesses : undefined,
          ts: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let parsed: { error?: string } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw */
        }
        setError(parsed.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ReportResponse;
      setResult(data);
      setDescription('');
      setLocation('');
      setWitnessesText('');
    } catch (err) {
      logger.error('incident_report_submit_failed', { error: err });
      setError(t('incident_report.err_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/emergency"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="w-4 h-4" />
          {t('incident_report.back_emergency')}
        </Link>
      </div>

      <header className="mb-6">
        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-700 dark:text-teal-300 bg-teal-500/10 px-3 py-1 rounded-full mb-3">
          <ShieldAlert className="w-3.5 h-3.5" />
          {t('incident_report.badge')}
        </div>
        <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">
          {t('incident_report.title')}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
          {t('incident_report.subtitle')}
        </p>
      </header>

      {!selectedProject && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-sm">
          {t('incident_report.select_project')}
        </div>
      )}

      {result && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-100">
          <div className="flex items-center gap-2 font-bold uppercase tracking-widest text-xs mb-1">
            <CheckCircle2 className="w-4 h-4" />
            {t('incident_report.registered')}
          </div>
          <p className="text-sm">
            {t('incident_report.folio')}: <span className="font-mono">{result.incidentId}</span>
          </p>
          {result.xpAwarded > 0 && (
            <p className="text-sm mt-2 inline-flex items-center gap-1">
              <Sparkles className="w-4 h-4" />
              <strong>+{result.xpAwarded} XP</strong> — {t('incident_report.xp_thanks')}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 mb-2">
            {t('incident_report.label_type')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setIncidentType(opt.value)}
                aria-pressed={incidentType === opt.value}
                className={`min-h-[64px] text-left px-4 py-3 rounded-2xl border transition-all ${
                  incidentType === opt.value
                    ? 'bg-teal-500/10 border-teal-500/50 text-teal-900 dark:text-teal-100'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600'
                }`}
              >
                <div className="font-bold uppercase tracking-widest text-xs">
                  {t(opt.labelKey)}
                </div>
                <div className="text-[11px] mt-1 leading-snug opacity-80">
                  {t(opt.hintKey)}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 mb-2">
            {t('incident_report.label_severity')}
          </label>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSeverity(opt.value)}
                aria-pressed={severity === opt.value}
                className={`px-4 py-3 rounded-full text-xs font-bold uppercase tracking-widest min-h-[44px] ${
                  severity === opt.value
                    ? `${opt.badge} ring-2 ring-offset-2 ring-current`
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="incident-description"
            className="block text-xs font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 mb-2"
          >
            {t('incident_report.label_what_happened')}
          </label>
          <textarea
            id="incident-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder={t('incident_report.what_placeholder')}
            className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-teal-500"
            required
          />
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1">
            {description.length}/4000
          </p>
        </div>

        <div>
          <label
            htmlFor="incident-location"
            className="block text-xs font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 mb-2"
          >
            {t('incident_report.label_location')}
          </label>
          <input
            id="incident-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={256}
            placeholder={t('incident_report.location_placeholder')}
            className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-teal-500"
          />
        </div>

        <div>
          <label
            htmlFor="incident-witnesses"
            className="block text-xs font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 mb-2"
          >
            {t('incident_report.label_witnesses')}
          </label>
          <input
            id="incident-witnesses"
            type="text"
            value={witnessesText}
            onChange={(e) => setWitnessesText(e.target.value)}
            placeholder={t('incident_report.witnesses_placeholder')}
            className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-teal-500"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full min-h-[64px] inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-2xl px-6 py-4 transition-all shadow-lg active:scale-[0.98]"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('incident_report.submitting')}
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              {t('incident_report.submit')}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default IncidentReport;
