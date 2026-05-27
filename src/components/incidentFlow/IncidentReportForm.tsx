// Praeventio Guard — Bloque 4.3 UI #1: <IncidentReportForm />
//
// Mobile-first form a trabajador para reportar un accidente / near-miss.
// Inputs: tipo (severity), ubicacion, descripcion, foto opcional. Cumple
// con la directiva "nunca XP negativo" — reportar SIEMPRE suma XP, este
// formulario no penaliza al reportante.
//
// Tailwind + teal/amber tokens + dark mode. Color picks honran preferencia
// usuario: teal #4db6ac primario, amber secundario, coral sólo en alerta
// critica.

import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, Camera, MapPin, Send } from 'lucide-react';
import {
  reportIncident,
  type IncidentReportPayload,
} from '../../hooks/useIncidentFlow';

const SEVERITY_OPTIONS = [
  { value: 'low', labelKey: 'incidentFlow.severity.low', labelDefault: 'Bajo', tone: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
  { value: 'medium', labelKey: 'incidentFlow.severity.medium', labelDefault: 'Medio', tone: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  { value: 'high', labelKey: 'incidentFlow.severity.high', labelDefault: 'Alto', tone: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' },
  { value: 'critical', labelKey: 'incidentFlow.severity.critical', labelDefault: 'Critico', tone: 'bg-rose-500/20 text-rose-700 dark:text-rose-300' },
] as const;

interface IncidentReportFormProps {
  projectId: string;
  /** Stable id of the incident the caller wants to create. */
  incidentId: string;
  /** Optional initial photo url (from a previous upload step). */
  initialPhotoUrl?: string;
  onSuccess?: (result: { incidentId: string; nodeIds: string[] }) => void;
  onError?: (err: Error) => void;
}

export function IncidentReportForm({
  projectId,
  incidentId,
  initialPhotoUrl,
  onSuccess,
  onError,
}: IncidentReportFormProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const locationId = useId();

  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<IncidentReportPayload['severity']>('medium');
  const [photoStorageUrl] = useState<string | undefined>(initialPhotoUrl);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSubmit = description.trim().length >= 10 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await reportIncident(projectId, {
        incidentId,
        occurredAtIso: new Date().toISOString(),
        description: description.trim(),
        severity,
        location: location.trim().length > 0 ? location.trim() : undefined,
        photoStorageUrl,
      });
      onSuccess?.({ incidentId: result.incidentId, nodeIds: result.nodeIds });
    } catch (err) {
      const e = err as Error;
      setErrorMsg(e.message);
      onError?.(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-teal-500/30 bg-surface p-4 shadow-mode space-y-3"
      data-testid="incident-report-form"
      aria-label={t('incidentFlow.reportForm.aria', 'Formulario de reporte de accidente') as string}
    >
      <header className="flex items-center gap-2">
        <AlertOctagon className="w-5 h-5 text-teal-600 dark:text-teal-300" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
          {t('incidentFlow.reportForm.title', 'Reportar accidente / casi-accidente')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token leading-snug">
        {t(
          'incidentFlow.reportForm.helper',
          'Reportar siempre suma puntos. No hay penalizacion: reportar temprano salva vidas.',
        )}
      </p>

      {/* Severity picker */}
      <fieldset>
        <legend className="text-[10px] uppercase font-bold tracking-wide text-secondary-token mb-1">
          {t('incidentFlow.reportForm.severityLabel', 'Severidad estimada')}
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {SEVERITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSeverity(opt.value as IncidentReportPayload['severity'])}
              data-testid={`incident-severity-${opt.value}`}
              aria-pressed={severity === opt.value}
              className={`px-2 py-1.5 rounded text-[11px] font-bold border ${
                severity === opt.value
                  ? `${opt.tone} border-current`
                  : 'bg-surface-elevated border-default-token text-secondary-token'
              }`}
            >
              {t(opt.labelKey, opt.labelDefault)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Description */}
      <div>
        <label
          htmlFor={descriptionId}
          className="text-[10px] uppercase font-bold tracking-wide text-secondary-token mb-1 block"
        >
          {t('incidentFlow.reportForm.descriptionLabel', 'Que paso')}
          <span className="text-rose-500 ml-1">*</span>
        </label>
        <textarea
          id={descriptionId}
          data-testid="incident-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(
            'incidentFlow.reportForm.descriptionPlaceholder',
            'Describe el evento sin culpar a personas. Foco en el sistema.',
          ) as string}
          rows={4}
          minLength={10}
          maxLength={4000}
          required
          className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
        <p className="text-[9px] text-secondary-token mt-0.5">
          {description.trim().length}/10 {t('incidentFlow.reportForm.minChars', 'caracteres minimos')}
        </p>
      </div>

      {/* Location */}
      <div>
        <label
          htmlFor={locationId}
          className="text-[10px] uppercase font-bold tracking-wide text-secondary-token mb-1 flex items-center gap-1"
        >
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {t('incidentFlow.reportForm.locationLabel', 'Ubicacion')}
        </label>
        <input
          id={locationId}
          data-testid="incident-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t('incidentFlow.reportForm.locationPlaceholder', 'Faena 7, sector C') as string}
          maxLength={256}
          className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
      </div>

      {/* Photo indicator (upload handled outside this component). */}
      {photoStorageUrl && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-teal-700 dark:text-teal-300"
          data-testid="incident-photo-attached"
        >
          <Camera className="w-3.5 h-3.5" aria-hidden="true" />
          {t('incidentFlow.reportForm.photoAttached', 'Foto adjunta')}
        </div>
      )}

      {errorMsg && (
        <div
          className="text-[11px] rounded bg-rose-500/10 border border-rose-500/30 px-2 py-1.5 text-rose-700 dark:text-rose-300"
          data-testid="incident-error"
          role="alert"
        >
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="incident-submit"
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-teal-600 text-white disabled:opacity-40 hover:bg-teal-700"
      >
        <Send className="w-3.5 h-3.5" aria-hidden="true" />
        {submitting
          ? t('incidentFlow.reportForm.submitting', 'Enviando...')
          : t('incidentFlow.reportForm.submit', 'Enviar reporte')}
      </button>
    </form>
  );
}
