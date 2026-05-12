// Praeventio Guard — Wire UI #22: <VisitorCheckInForm />
//
// Formulario rápido de registro de visita con validación pre-check-in,
// induction QR display, asignación de host.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, AlertCircle, Save } from 'lucide-react';
import {
  validateCheckIn,
  type VisitorKind,
} from '../../services/visitors/visitorAccessService.js';

interface VisitorCheckInFormProps {
  /** Hosts internos disponibles para asignar. */
  availableHosts: Array<{ uid: string; name: string }>;
  onSubmit: (payload: VisitorCheckInPayload) => Promise<void> | void;
  onCancel?: () => void;
}

export interface VisitorCheckInPayload {
  fullName: string;
  identityDocument: string;
  organization: string;
  kind: VisitorKind;
  hostUid: string;
  notes?: string;
}

const KIND_OPTIONS: Array<{ value: VisitorKind; label: string }> = [
  { value: 'mandante', label: 'Mandante / cliente' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'fiscalizador', label: 'Fiscalizador' },
  { value: 'mutualidad', label: 'Mutualidad' },
  { value: 'auditor_externo', label: 'Auditor externo' },
  { value: 'cliente_comercial', label: 'Cliente comercial' },
  { value: 'prensa', label: 'Prensa' },
  { value: 'familiar_trabajador', label: 'Familiar trabajador' },
];

export function VisitorCheckInForm({
  availableHosts,
  onSubmit,
  onCancel,
}: VisitorCheckInFormProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [identityDocument, setIdentityDocument] = useState('');
  const [organization, setOrganization] = useState('');
  const [kind, setKind] = useState<VisitorKind>('mandante');
  const [hostUid, setHostUid] = useState(availableHosts[0]?.uid ?? '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validation = validateCheckIn({
      fullName,
      identityDocument,
      organization,
      hostUid,
    });
    if (!validation.passed) {
      setError(validation.blockingIssues.join(' · '));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        identityDocument: identityDocument.trim(),
        organization: organization.trim(),
        kind,
        hostUid,
        notes: notes.trim() || undefined,
      });
      // Reset form
      setFullName('');
      setIdentityDocument('');
      setOrganization('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="visitor-checkin-form"
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      aria-label={t('visitor.checkInAria', 'Registro de visita') as string}
    >
      <header className="flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('visitor.checkInTitle', 'Registro de Visita')}
        </h2>
      </header>

      <label className="block">
        <span className="text-xs font-semibold text-secondary-token">
          {t('visitor.fullName', 'Nombre completo')}
          <span className="text-rose-500 ml-1">*</span>
        </span>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          data-testid="visitor-fullname"
          className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
          required
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('visitor.document', 'Documento ID')}
            <span className="text-rose-500 ml-1">*</span>
          </span>
          <input
            type="text"
            value={identityDocument}
            onChange={(e) => setIdentityDocument(e.target.value)}
            data-testid="visitor-document"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            required
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('visitor.organization', 'Organización')}
            <span className="text-rose-500 ml-1">*</span>
          </span>
          <input
            type="text"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            data-testid="visitor-organization"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            required
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('visitor.kind', 'Tipo')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as VisitorKind)}
            data-testid="visitor-kind"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-secondary-token">
            {t('visitor.host', 'Acompañante (host)')}
            <span className="text-rose-500 ml-1">*</span>
          </span>
          <select
            value={hostUid}
            onChange={(e) => setHostUid(e.target.value)}
            data-testid="visitor-host"
            className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            required
          >
            <option value="">— {t('visitor.selectHost', 'Seleccionar')} —</option>
            {availableHosts.map((h) => (
              <option key={h.uid} value={h.uid}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-secondary-token">
          {t('visitor.notes', 'Notas (opcional)')}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="visitor-notes"
          rows={2}
          className="mt-1 w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
        />
      </label>

      {error && (
        <p
          role="alert"
          data-testid="visitor-error"
          className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 px-2 py-1 rounded flex items-center gap-1"
        >
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            data-testid="visitor-cancel"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-default-token"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          data-testid="visitor-submit"
          className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50"
        >
          <Save className="w-3 h-3" aria-hidden="true" />
          {submitting
            ? t('visitor.saving', 'Guardando...')
            : t('visitor.checkIn', 'Registrar entrada')}
        </button>
      </div>
    </form>
  );
}
