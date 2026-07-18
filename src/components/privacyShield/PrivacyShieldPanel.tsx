// Praeventio Guard — Bloque D Rama 1: <PrivacyShieldPanel />
//
// Self-contained PII field classifier (Ley 19.628 + GDPR) over the
// pure-compute endpoint POST /api/sprint-k/:projectId/privacy-shield/
// classify-field (src/server/routes/privacyShield.ts), consumed via the
// previously-orphaned hook src/hooks/usePrivacyShield.ts. Minimal v1
// form: one data field → sensitivity, retention and handling obligations.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, AlertTriangle } from 'lucide-react';
import { classifyPiiField } from '../../hooks/usePrivacyShield';
import type {
  ClassificationReport,
  PiiCategory,
} from '../../services/privacyShield/piiClassifier';
import { humanErrorMessage } from '../../lib/humanError';


interface PrivacyShieldPanelProps {
  projectId: string;
}

const CATEGORY_OPTIONS: Array<{ value: PiiCategory; label: string }> = [
  { value: 'identity', label: 'Identidad (nombre, RUT, documento)' },
  { value: 'contact', label: 'Contacto (email, teléfono, dirección)' },
  { value: 'health', label: 'Salud' },
  { value: 'biometric', label: 'Biométrico (huella, rostro, voz)' },
  { value: 'financial', label: 'Financiero (cuenta, tarjeta)' },
  { value: 'judicial', label: 'Judicial (denuncias, antecedentes)' },
  { value: 'location', label: 'Ubicación (GPS, coordenadas)' },
  { value: 'observation', label: 'Observación de comportamiento' },
];

const SENSITIVITY_LABELS: Record<ClassificationReport['sensitivity'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  special_category: 'Categoría especial (Art. 9 GDPR)',
};

const SENSITIVITY_TONES: Record<ClassificationReport['sensitivity'], string> = {
  low: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-sky-600 dark:text-sky-400',
  high: 'text-amber-600 dark:text-amber-400',
  special_category: 'text-rose-600 dark:text-rose-400',
};

function BoolChip({ label, value }: { label: string; value: boolean }) {
  return (
    <p className="text-[11px]">
      <span className="text-secondary-token">{label}: </span>
      <span className={value ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-secondary-token'}>
        {value ? 'Sí' : 'No'}
      </span>
    </p>
  );
}

export function PrivacyShieldPanel({ projectId }: PrivacyShieldPanelProps) {
  const { t } = useTranslation();
  const [fieldPath, setFieldPath] = useState('');
  const [category, setCategory] = useState<PiiCategory>('identity');
  const [encrypted, setEncrypted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ClassificationReport | null>(null);

  const canSubmit = fieldPath.trim().length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await classifyPiiField(projectId, {
        field: { fieldPath: fieldPath.trim(), category, encrypted },
      });
      setReport(res.report);
    } catch (err) {
      setReport(null);
      setError(humanErrorMessage(err instanceof Error ? err.message : 'unknown_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="privacy-shield-panel"
      aria-label={t('privacyShield.panel.aria', 'Clasificador de datos personales') as string}
    >
      <header className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('privacyShield.panel.title', 'Clasificación de campo de datos')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'privacyShield.panel.disclaimer',
          'Ley 19.628 + GDPR — clasifica sensibilidad, retención y obligaciones de manejo por campo.',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('privacyShield.panel.fieldPath', 'Ruta del campo (ej. workers.rut)')}
          </span>
          <input
            type="text"
            value={fieldPath}
            onChange={(e) => setFieldPath(e.target.value)}
            data-testid="privacy-shield-field-path"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('privacyShield.panel.fieldPath', 'Ruta del campo (ej. workers.rut)') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('privacyShield.panel.category', 'Categoría del dato')}
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PiiCategory)}
            data-testid="privacy-shield-category"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            checked={encrypted}
            onChange={(e) => setEncrypted(e.target.checked)}
            data-testid="privacy-shield-encrypted"
            className="rounded border border-default-token"
          />
          <span className="text-[10px] uppercase text-secondary-token">
            {t('privacyShield.panel.encrypted', 'Cifrado en reposo')}
          </span>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="privacy-shield-submit"
          className="col-span-2 rounded-xl bg-violet-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('privacyShield.panel.submit', 'Clasificar campo')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="privacy-shield-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('privacyShield.panel.error', 'No se pudo clasificar el campo.')} ({humanErrorMessage(error)})</span>
        </div>
      )}

      {report && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="privacy-shield-result"
        >
          <p className={`text-sm font-black ${SENSITIVITY_TONES[report.sensitivity]}`}>
            {t('privacyShield.panel.sensitivity', 'Sensibilidad:')}{' '}
            {SENSITIVITY_LABELS[report.sensitivity]}
          </p>
          <p className="text-[11px] text-secondary-token">
            {t('privacyShield.panel.retention', 'Retención:')}{' '}
            <span className="tabular-nums font-bold">{report.retentionDays.toLocaleString()}</span>{' '}
            {t('privacyShield.panel.days', 'días')}
          </p>
          <BoolChip
            label={t('privacyShield.panel.consent', 'Consentimiento explícito requerido')}
            value={report.requiresExplicitConsent}
          />
          <BoolChip
            label={t('privacyShield.panel.mustEncrypt', 'Cifrado en reposo obligatorio')}
            value={report.mustEncryptAtRest}
          />
          <BoolChip
            label={t('privacyShield.panel.maskLogs', 'Mascarado en logs obligatorio')}
            value={report.mustMaskInLogs}
          />
        </div>
      )}
    </section>
  );
}
