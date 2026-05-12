// Praeventio Guard — Wire UI #8b: <NewEntryForm />
//
// Form to create a new SiteBookEntry. Validates inputs client-side
// (length minimums + required fields), then calls the parent submit
// handler which is expected to call the SiteBookAdapter server-side
// (folio assignment + Firestore write happen there).
//
// Used in: new route `/sitebook/:projectId/new`.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, X } from 'lucide-react';
import type { SiteBookEntryKind } from '../../services/siteBook/siteBookService.js';

interface NewEntryFormProps {
  projectId: string;
  recordedByUid: string;
  recordedByRole: string;
  onSubmit: (input: NewEntryFormPayload) => Promise<void> | void;
  onCancel?: () => void;
}

export interface NewEntryFormPayload {
  projectId: string;
  kind: SiteBookEntryKind;
  occurredAt: string;
  recordedByUid: string;
  recordedByRole: string;
  description: string;
  location?: string;
  involvedWorkerUids?: string[];
}

const KIND_OPTIONS: Array<{ value: SiteBookEntryKind; labelKey: string; fallback: string }> = [
  { value: 'inspection', labelKey: 'sitebook.kind.inspection', fallback: 'Inspección' },
  { value: 'incident', labelKey: 'sitebook.kind.incident', fallback: 'Incidente' },
  { value: 'near_miss', labelKey: 'sitebook.kind.near_miss', fallback: 'Casi accidente' },
  { value: 'visit', labelKey: 'sitebook.kind.visit', fallback: 'Visita' },
  { value: 'change', labelKey: 'sitebook.kind.change', fallback: 'Cambio' },
  { value: 'instruction', labelKey: 'sitebook.kind.instruction', fallback: 'Instrucción' },
  { value: 'stoppage', labelKey: 'sitebook.kind.stoppage', fallback: 'Paralización' },
  { value: 'resumption', labelKey: 'sitebook.kind.resumption', fallback: 'Reanudación' },
  { value: 'document_delivery', labelKey: 'sitebook.kind.document_delivery', fallback: 'Entrega doc.' },
  { value: 'finding_closure', labelKey: 'sitebook.kind.finding_closure', fallback: 'Cierre hallazgo' },
  { value: 'training_event', labelKey: 'sitebook.kind.training_event', fallback: 'Capacitación' },
  { value: 'observation', labelKey: 'sitebook.kind.observation', fallback: 'Observación' },
];

const MIN_DESCRIPTION_LEN = 15;

export function NewEntryForm({
  projectId,
  recordedByUid,
  recordedByRole,
  onSubmit,
  onCancel,
}: NewEntryFormProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SiteBookEntryKind>('inspection');
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [involvedUids, setInvolvedUids] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedDescription = description.trim();
  const valid = trimmedDescription.length >= MIN_DESCRIPTION_LEN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: NewEntryFormPayload = {
        projectId,
        kind,
        occurredAt: new Date(occurredAt).toISOString(),
        recordedByUid,
        recordedByRole,
        description: trimmedDescription,
        location: location.trim() || undefined,
        involvedWorkerUids: involvedUids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await onSubmit(payload);
      // Reset form after success
      setDescription('');
      setLocation('');
      setInvolvedUids('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="sitebook-new-entry-form"
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      aria-label={t('sitebook.new_form.aria', 'Nueva entrada de libro') as string}
    >
      <header>
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('sitebook.new_form.title', 'Nueva entrada Libro de Obra')}
        </h2>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('sitebook.new_form.kind', 'Tipo')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SiteBookEntryKind)}
            data-testid="sitebook-kind"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm text-primary-token"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey, opt.fallback)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('sitebook.new_form.occurred_at', 'Cuándo ocurrió')}
          </span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            data-testid="sitebook-occurred-at"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm text-primary-token"
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-secondary-token">
          {t('sitebook.new_form.description', 'Descripción del hecho')}
          <span className="text-rose-500 ml-1">*</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="sitebook-description"
          minLength={MIN_DESCRIPTION_LEN}
          rows={4}
          className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm text-primary-token"
          placeholder={t(
            'sitebook.new_form.description_placeholder',
            'Mínimo 15 caracteres. Describe el hecho de forma objetiva.',
          ) as string}
          required
        />
        <span
          className={`text-[10px] mt-0.5 inline-block ${valid ? 'text-emerald-600' : 'text-muted-token'}`}
        >
          {trimmedDescription.length}/{MIN_DESCRIPTION_LEN}
        </span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('sitebook.new_form.location', 'Ubicación')}
          </span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            data-testid="sitebook-location"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm text-primary-token"
            placeholder={t('sitebook.new_form.location_placeholder', 'Ej: Sector A Nivel 3') as string}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('sitebook.new_form.involved', 'Trabajadores involucrados (UIDs separados por coma)')}
          </span>
          <input
            type="text"
            value={involvedUids}
            onChange={(e) => setInvolvedUids(e.target.value)}
            data-testid="sitebook-involved"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm text-primary-token"
            placeholder="w1, w2, w3"
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="sitebook-error"
          className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 px-2 py-1 rounded"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            data-testid="sitebook-cancel"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-default-token text-secondary-token text-xs font-semibold hover:bg-surface-elevated"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            {t('common.cancel', 'Cancelar')}
          </button>
        )}
        <button
          type="submit"
          disabled={!valid || submitting}
          data-testid="sitebook-submit"
          className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-600"
        >
          <Save className="w-3 h-3" aria-hidden="true" />
          {submitting
            ? t('sitebook.new_form.saving', 'Guardando...')
            : t('sitebook.new_form.save', 'Guardar entrada')}
        </button>
      </div>
    </form>
  );
}
