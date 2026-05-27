// Praeventio Guard — Bloque 3.17: <ChangeDeclarationForm />
//
// Admin form para declarar un cambio operacional (MOC). Recoge:
//   - tipo de cambio (ChangeKind)
//   - whatChanged (descripción de qué cambia)
//   - previousValue / newValue (valor antes/después)
//   - rationale (justificación, mínimo 20 chars — enforce por engine)
//   - impact (low/medium/high)
//   - affectedWorkerUids (chips editables — scope workers)
//   - effectiveFrom (vigencia)
//   - referenceDocumentId? (opcional)
//
// Llama `declareMoc()` del hook al submit. UX: teal primary + amber para
// impacto medio + rose para alto. Dark mode soportado.
//
// Anti-blame: el formulario NO escribe declaredByUid — eso lo fuerza el
// server desde el token. Pero sí requiere declaredByRole (el engine
// valida APPROVER_ROLES).

import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  GitCompare,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import type {
  ChangeKind,
  ChangeImpact,
} from '../../services/changeMgmt/operationalChangeService';
import { declareMoc, type DeclareMocInput } from '../../hooks/useOperationalChange';

const KIND_OPTIONS: ReadonlyArray<{ value: ChangeKind; label: string }> = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'procedure', label: 'Procedimiento' },
  { value: 'equipment', label: 'Equipo' },
  { value: 'shift', label: 'Turno' },
  { value: 'work_zone', label: 'Zona de trabajo' },
  { value: 'mandatory_epp', label: 'EPP obligatorio' },
  { value: 'applicable_norm', label: 'Norma aplicable' },
  { value: 'critical_control', label: 'Control crítico' },
  { value: 'other', label: 'Otro' },
];

const IMPACT_OPTIONS: ReadonlyArray<{ value: ChangeImpact; label: string; tone: string }> = [
  {
    value: 'low',
    label: 'Bajo',
    tone: 'border-teal-300 bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-200',
  },
  {
    value: 'medium',
    label: 'Medio',
    tone: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200',
  },
  {
    value: 'high',
    label: 'Alto',
    tone: 'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-200',
  },
];

const APPROVER_ROLE_OPTIONS = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'prevencionista', label: 'Prevencionista' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'admin', label: 'Administrador' },
];

const MIN_RATIONALE = 20;

export interface ChangeDeclarationFormProps {
  projectId: string;
  /** Default rol del declarante (precarga del UserProfile). */
  defaultDeclaredByRole?: string;
  /** Pool de workers del proyecto para preselección rápida (UIDs). */
  availableWorkerUids?: string[];
  /** Notifica al padre con el cambio recién creado. */
  onDeclared?: (mocId: string) => void;
  /** Notifica errores para toast/log centralizado. */
  onError?: (message: string, code?: string) => void;
}

export function ChangeDeclarationForm({
  projectId,
  defaultDeclaredByRole = 'supervisor',
  availableWorkerUids = [],
  onDeclared,
  onError,
}: ChangeDeclarationFormProps) {
  const [kind, setKind] = useState<ChangeKind>('procedure');
  const [whatChanged, setWhatChanged] = useState('');
  const [previousValue, setPreviousValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [rationale, setRationale] = useState('');
  const [impact, setImpact] = useState<ChangeImpact>('medium');
  const [affectedWorkerUids, setAffectedWorkerUids] = useState<string[]>([]);
  const [newWorkerUid, setNewWorkerUid] = useState('');
  const [declaredByRole, setDeclaredByRole] = useState(defaultDeclaredByRole);
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [referenceDocumentId, setReferenceDocumentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addWorker(uid: string) {
    const v = uid.trim();
    if (!v) return;
    if (affectedWorkerUids.includes(v)) return;
    setAffectedWorkerUids((prev) => [...prev, v]);
    setNewWorkerUid('');
  }

  function removeWorker(uid: string) {
    setAffectedWorkerUids((prev) => prev.filter((u) => u !== uid));
  }

  const whatChangedOk = whatChanged.trim().length > 0;
  const rationaleOk = rationale.trim().length >= MIN_RATIONALE;
  const valuesDiffer =
    previousValue.trim().length > 0 || newValue.trim().length > 0
      ? previousValue !== newValue
      : false;
  const needsAffected = impact !== 'low';
  const affectedOk = !needsAffected || affectedWorkerUids.length > 0;
  const formValid =
    whatChangedOk && rationaleOk && valuesDiffer && affectedOk && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setError(null);
    setSubmitting(true);
    try {
      const input: DeclareMocInput = {
        kind,
        whatChanged: whatChanged.trim(),
        previousValue: previousValue.trim(),
        newValue: newValue.trim(),
        rationale: rationale.trim(),
        impact,
        affectedWorkerUids,
        declaredByRole,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        referenceDocumentId: referenceDocumentId.trim() || undefined,
      };
      const { change } = await declareMoc(projectId, input);
      onDeclared?.(change.id);
      // reset form for next declaration
      setWhatChanged('');
      setPreviousValue('');
      setNewValue('');
      setRationale('');
      setAffectedWorkerUids([]);
      setReferenceDocumentId('');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error desconocido al declarar';
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : undefined;
      setError(msg);
      onError?.(msg, code);
    } finally {
      setSubmitting(false);
    }
  }

  const impactTone =
    IMPACT_OPTIONS.find((o) => o.value === impact)?.tone ?? '';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-5"
      data-testid="moc.declarationForm"
      aria-label="Declarar cambio operacional"
    >
      <header className="flex items-center gap-2">
        <GitCompare className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Declarar cambio operacional (MOC)
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Tipo de cambio
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ChangeKind)}
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.kind"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Rol del declarante
          </span>
          <select
            value={declaredByRole}
            onChange={(e) => setDeclaredByRole(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.declaredByRole"
          >
            {APPROVER_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs">
        <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
          ¿Qué cambia? (resumen corto)
        </span>
        <input
          type="text"
          value={whatChanged}
          onChange={(e) => setWhatChanged(e.target.value)}
          maxLength={2000}
          placeholder="Ej: cambio supervisor turno noche zona A"
          className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          data-testid="moc.form.whatChanged"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Valor anterior
          </span>
          <input
            type="text"
            value={previousValue}
            onChange={(e) => setPreviousValue(e.target.value)}
            maxLength={2000}
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.previousValue"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Valor nuevo
          </span>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            maxLength={2000}
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.newValue"
          />
        </label>
      </div>

      <label className="block text-xs">
        <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
          Justificación / análisis de riesgo y medidas preventivas
        </span>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          maxLength={5000}
          rows={4}
          placeholder={`Mínimo ${MIN_RATIONALE} caracteres. Describe por qué este cambio es necesario y qué controles se aplicaron.`}
          className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          data-testid="moc.form.rationale"
        />
        <span
          className={`text-[10px] ${
            rationaleOk
              ? 'text-teal-700 dark:text-teal-300'
              : 'text-amber-700 dark:text-amber-300'
          }`}
          data-testid="moc.form.rationaleCount"
        >
          {rationale.trim().length}/{MIN_RATIONALE} caracteres mínimos
        </span>
      </label>

      <fieldset className="space-y-1">
        <legend className="font-bold uppercase text-xs text-slate-600 dark:text-slate-400">
          Impacto
        </legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Impacto">
          {IMPACT_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex-1 cursor-pointer text-center text-xs font-bold px-3 py-2 rounded border ${
                impact === opt.value
                  ? opt.tone
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              <input
                type="radio"
                name="impact"
                value={opt.value}
                checked={impact === opt.value}
                onChange={() => setImpact(opt.value)}
                className="sr-only"
                data-testid={`moc.form.impact.${opt.value}`}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="font-bold uppercase text-xs text-slate-600 dark:text-slate-400">
          Trabajadores afectados (scope)
        </legend>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newWorkerUid}
            onChange={(e) => setNewWorkerUid(e.target.value)}
            placeholder="UID de trabajador"
            className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.newWorkerUid"
            list={availableWorkerUids.length > 0 ? 'moc-worker-pool' : undefined}
          />
          {availableWorkerUids.length > 0 && (
            <datalist id="moc-worker-pool">
              {availableWorkerUids.map((uid) => (
                <option key={uid} value={uid} />
              ))}
            </datalist>
          )}
          <button
            type="button"
            onClick={() => addWorker(newWorkerUid)}
            disabled={!newWorkerUid.trim()}
            className="rounded bg-teal-600 hover:bg-teal-700 disabled:bg-slate-400 dark:disabled:bg-slate-700 text-white text-xs font-bold px-3 py-1.5 inline-flex items-center gap-1"
            data-testid="moc.form.addWorker"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            Agregar
          </button>
        </div>
        {affectedWorkerUids.length > 0 && (
          <ul className="flex flex-wrap gap-1 mt-1" data-testid="moc.form.workerChips">
            {affectedWorkerUids.map((uid) => (
              <li
                key={uid}
                className="inline-flex items-center gap-1 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 text-[11px] px-2 py-0.5"
              >
                <span>{uid}</span>
                <button
                  type="button"
                  onClick={() => removeWorker(uid)}
                  aria-label={`Quitar ${uid}`}
                  className="hover:text-rose-600 dark:hover:text-rose-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {needsAffected && affectedWorkerUids.length === 0 && (
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            Impacto {impact === 'medium' ? 'medio' : 'alto'} requiere identificar
            trabajadores afectados.
          </p>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Vigencia desde
          </span>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.effectiveFrom"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold uppercase text-slate-600 dark:text-slate-400">
            Documento referencia (opcional)
          </span>
          <input
            type="text"
            value={referenceDocumentId}
            onChange={(e) => setReferenceDocumentId(e.target.value)}
            placeholder="ID procedimiento/política"
            className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            data-testid="moc.form.referenceDocumentId"
          />
        </label>
      </div>

      <div
        className={`flex items-center gap-2 rounded p-2 text-xs ${impactTone}`}
        role="note"
        data-testid="moc.form.impactBanner"
      >
        <AlertCircle className="w-4 h-4" aria-hidden="true" />
        <span>
          Una vez declarado, los trabajadores afectados recibirán un banner para
          confirmar lectura. El MOC NO podrá cerrarse hasta que el 100% confirme.
        </span>
      </div>

      {error && (
        <p
          className="rounded border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 text-xs px-3 py-2"
          role="alert"
          data-testid="moc.form.error"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!formValid}
        className="w-full rounded bg-teal-600 hover:bg-teal-700 disabled:bg-slate-400 dark:disabled:bg-slate-700 text-white text-sm font-bold py-2 inline-flex items-center justify-center gap-2"
        data-testid="moc.form.submit"
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="w-4 h-4" aria-hidden="true" />
        )}
        {submitting ? 'Declarando…' : 'Declarar cambio'}
      </button>
    </form>
  );
}
