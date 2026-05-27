// Praeventio Guard — Bloque 3.13 wire huérfanos: <IndustrySelectorWizard />
//
// 3-step wizard that walks a project owner through:
//   1. select   — pick an industry preset (GP-MIN, GP-CONS, GP-AGR, …)
//   2. review   — see normativa DS 44/2024 + Ley 16.744 + EPP + protocols
//   3. confirm  — apply the preset (caller persists the application)
//
// Mirror del shape de OnboardingWizard: pure reducer + thin component.
// Submission delegates to `selectIndustryRemote` from useIndustryRules.
//
// Founder directives encoded here:
//   • No external organism is contacted — `select` is a local engine call.
//   • Confirmation is opt-in; back/next are free. Nothing is irreversible.
//   • Fuente normativa rendered discretely (small chips + footnote), never
//     as a panic-mode banner.

import { useEffect, useReducer } from 'react';
import { ChevronLeft, ChevronRight, Check, Factory, ListChecks } from 'lucide-react';
import {
  listIndustryPresetsRemote,
  selectIndustryRemote,
  type SelectIndustryResponse,
} from '../../hooks/useIndustryRules';
import type {
  IndustryPreset,
  PresetApplication,
} from '../../services/industryRules/industryRuleEngine';
import { IndustryNormsSummary } from './IndustryNormsSummary';

// ───────────────────────── State machine ─────────────────────────

export const STEPS = ['select', 'review', 'confirm'] as const;
export type Step = (typeof STEPS)[number];

export interface IndustryListItem {
  prefix: string;
  label: string;
}

export interface WizardState {
  step: Step;
  presets: IndustryListItem[];
  presetsLoading: boolean;
  presetsError: string | null;
  selectedPrefix: string | null;
  preview: IndustryPreset | null;
  previewLoading: boolean;
  previewError: string | null;
  application: PresetApplication | null;
  submitting: boolean;
  submitError: string | null;
}

export const INITIAL_STATE: WizardState = {
  step: 'select',
  presets: [],
  presetsLoading: false,
  presetsError: null,
  selectedPrefix: null,
  preview: null,
  previewLoading: false,
  previewError: null,
  application: null,
  submitting: false,
  submitError: null,
};

export type Action =
  | { type: 'LIST_START' }
  | { type: 'LIST_OK'; presets: IndustryListItem[] }
  | { type: 'LIST_FAIL'; error: string }
  | { type: 'SELECT_PREFIX'; prefix: string }
  | { type: 'PREVIEW_START' }
  | { type: 'PREVIEW_OK'; preset: IndustryPreset }
  | { type: 'PREVIEW_FAIL'; error: string }
  | { type: 'SUBMIT_START' }
  | {
      type: 'SUBMIT_OK';
      application: PresetApplication;
      preset: IndustryPreset;
    }
  | { type: 'SUBMIT_FAIL'; error: string }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'RESET' };

export function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'LIST_START':
      return { ...state, presetsLoading: true, presetsError: null };
    case 'LIST_OK':
      return {
        ...state,
        presetsLoading: false,
        presetsError: null,
        presets: action.presets,
      };
    case 'LIST_FAIL':
      return {
        ...state,
        presetsLoading: false,
        presetsError: action.error,
      };
    case 'SELECT_PREFIX':
      // Selecting a new prefix invalidates any cached preview.
      return {
        ...state,
        selectedPrefix: action.prefix,
        preview: null,
        previewError: null,
      };
    case 'PREVIEW_START':
      return { ...state, previewLoading: true, previewError: null };
    case 'PREVIEW_OK':
      return {
        ...state,
        previewLoading: false,
        previewError: null,
        preview: action.preset,
      };
    case 'PREVIEW_FAIL':
      return {
        ...state,
        previewLoading: false,
        previewError: action.error,
      };
    case 'SUBMIT_START':
      return { ...state, submitting: true, submitError: null };
    case 'SUBMIT_OK':
      return {
        ...state,
        submitting: false,
        submitError: null,
        application: action.application,
        preview: action.preset,
      };
    case 'SUBMIT_FAIL':
      return { ...state, submitting: false, submitError: action.error };
    case 'NEXT': {
      const err = validateStep(state);
      if (err) return { ...state, submitError: err };
      const idx = STEPS.indexOf(state.step);
      const next = STEPS[Math.min(idx + 1, STEPS.length - 1)];
      return { ...state, step: next, submitError: null };
    }
    case 'BACK': {
      const idx = STEPS.indexOf(state.step);
      const prev = STEPS[Math.max(idx - 1, 0)];
      return { ...state, step: prev, submitError: null };
    }
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

/** Returns null if the current step is valid, otherwise an error string. */
export function validateStep(state: WizardState): string | null {
  switch (state.step) {
    case 'select':
      return state.selectedPrefix
        ? null
        : 'Selecciona una industria para continuar';
    case 'review':
      return state.preview ? null : 'Carga la vista previa antes de continuar';
    case 'confirm':
      return null;
    default:
      return null;
  }
}

// ───────────────────────── Component ─────────────────────────

export interface IndustrySelectorWizardProps {
  /** Project being configured. Required for project-membership gating. */
  projectId: string;
  /** Called once the preset is applied successfully. */
  onApplied?: (result: {
    application: PresetApplication;
    preset: IndustryPreset;
  }) => void;
  /** Optional cancel handler (e.g. close modal). */
  onCancel?: () => void;
  /**
   * Optional overrides for tests / Storybook. When omitted, the real
   * `useIndustryRules` HTTP wrappers are used.
   */
  listFn?: (projectId: string) => Promise<{ presets: IndustryListItem[] }>;
  selectFn?: (
    projectId: string,
    input: { industryPrefix: string },
    idempotencyKey?: string,
  ) => Promise<SelectIndustryResponse>;
  /** Provide a deterministic id in tests. */
  idempotencyKey?: string;
}

async function defaultList(projectId: string) {
  return listIndustryPresetsRemote(projectId);
}

async function defaultSelect(
  projectId: string,
  input: { industryPrefix: string },
  idempotencyKey?: string,
): Promise<SelectIndustryResponse> {
  return selectIndustryRemote(projectId, input, idempotencyKey);
}

export function IndustrySelectorWizard({
  projectId,
  onApplied,
  onCancel,
  listFn,
  selectFn,
  idempotencyKey,
}: IndustrySelectorWizardProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const list = listFn ?? defaultList;
  const select = selectFn ?? defaultSelect;

  // Load the catalog on mount.
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'LIST_START' });
    list(projectId)
      .then((resp) => {
        if (cancelled) return;
        dispatch({ type: 'LIST_OK', presets: resp.presets });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Error de red';
        dispatch({ type: 'LIST_FAIL', error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, list]);

  // Load preview when entering the "review" step (or when the prefix
  // changes after a back-and-forth).
  useEffect(() => {
    if (state.step !== 'review') return;
    if (!state.selectedPrefix) return;
    if (state.preview && state.preview.industryPrefix === state.selectedPrefix)
      return;
    let cancelled = false;
    dispatch({ type: 'PREVIEW_START' });
    select(projectId, { industryPrefix: state.selectedPrefix })
      .then((resp) => {
        if (cancelled) return;
        dispatch({ type: 'PREVIEW_OK', preset: resp.preset });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Error de red';
        dispatch({ type: 'PREVIEW_FAIL', error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [state.step, state.selectedPrefix, state.preview, projectId, select]);

  async function handleConfirm() {
    if (!state.selectedPrefix) return;
    dispatch({ type: 'SUBMIT_START' });
    try {
      const resp = await select(
        projectId,
        { industryPrefix: state.selectedPrefix },
        idempotencyKey,
      );
      dispatch({
        type: 'SUBMIT_OK',
        application: resp.application,
        preset: resp.preset,
      });
      onApplied?.({ application: resp.application, preset: resp.preset });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al aplicar preset';
      dispatch({ type: 'SUBMIT_FAIL', error: msg });
    }
  }

  const stepIdx = STEPS.indexOf(state.step);
  const isLast = state.step === 'confirm';
  const nextDisabled =
    state.step === 'select'
      ? !state.selectedPrefix
      : state.step === 'review'
        ? !state.preview || state.previewLoading
        : false;

  return (
    <div
      data-testid="industry-wizard"
      className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 shadow-md p-6 space-y-5"
    >
      <header className="flex items-center gap-2">
        <Factory
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Configurar industria del proyecto
        </h1>
      </header>

      <ProgressDots current={stepIdx} total={STEPS.length} />

      {state.step === 'select' && (
        <SelectStep
          presets={state.presets}
          loading={state.presetsLoading}
          error={state.presetsError}
          value={state.selectedPrefix}
          onChange={(prefix) => dispatch({ type: 'SELECT_PREFIX', prefix })}
        />
      )}

      {state.step === 'review' && (
        <ReviewStep
          loading={state.previewLoading}
          error={state.previewError}
          preset={state.preview}
        />
      )}

      {state.step === 'confirm' && (
        <ConfirmStep
          preset={state.preview}
          application={state.application}
          submitting={state.submitting}
          onConfirm={handleConfirm}
        />
      )}

      {state.submitError && (
        <div
          data-testid="industry-wizard.error"
          role="alert"
          className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-200"
        >
          {state.submitError}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="industry-wizard.back"
            onClick={() => dispatch({ type: 'BACK' })}
            disabled={stepIdx === 0 || state.submitting}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-sm"
          >
            <ChevronLeft size={14} aria-hidden="true" /> Atrás
          </button>
          {onCancel && (
            <button
              type="button"
              data-testid="industry-wizard.cancel"
              onClick={onCancel}
              disabled={state.submitting}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-40"
            >
              Cancelar
            </button>
          )}
        </div>

        {isLast ? (
          <button
            type="button"
            data-testid="industry-wizard.confirm"
            onClick={handleConfirm}
            disabled={state.submitting || state.application !== null}
            className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white flex items-center gap-1.5 text-sm"
          >
            {state.application
              ? 'Aplicado'
              : state.submitting
                ? 'Aplicando…'
                : 'Aplicar preset'}{' '}
            <Check size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="industry-wizard.next"
            onClick={() => dispatch({ type: 'NEXT' })}
            disabled={nextDisabled}
            className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white flex items-center gap-1.5 text-sm"
          >
            Siguiente <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Step components ─────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      className="flex gap-2"
      data-testid="industry-wizard.progress"
      aria-label={`Paso ${current + 1} de ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-testid={`industry-wizard.progress.${i}`}
          className={`h-2 flex-1 rounded-full transition-colors ${
            i <= current
              ? 'bg-teal-500 dark:bg-teal-400'
              : 'bg-slate-200 dark:bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}

function SelectStep({
  presets,
  loading,
  error,
  value,
  onChange,
}: {
  presets: IndustryListItem[];
  loading: boolean;
  error: string | null;
  value: string | null;
  onChange: (prefix: string) => void;
}) {
  return (
    <section data-testid="industry-wizard.step-select" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        ¿Cuál es la industria principal del proyecto?
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        El preset incluye normativa DS 44/2024 + Ley 16.744 + EPP + protocolos
        MINSAL. Podrás ajustarlo después.
      </p>
      {loading && (
        <p
          data-testid="industry-wizard.list-loading"
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          Cargando catálogo…
        </p>
      )}
      {error && (
        <p
          data-testid="industry-wizard.list-error"
          role="alert"
          className="text-xs text-red-600 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {!loading && !error && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Industria"
        >
          {presets.map((p) => {
            const selected = value === p.prefix;
            return (
              <button
                key={p.prefix}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`industry-wizard.option-${p.prefix}`}
                onClick={() => onChange(p.prefix)}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-500 text-teal-800 dark:text-teal-100'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-teal-400 text-slate-700 dark:text-slate-200'
                }`}
              >
                <div className="font-semibold">{p.label}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-0.5">
                  {p.prefix}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReviewStep({
  loading,
  error,
  preset,
}: {
  loading: boolean;
  error: string | null;
  preset: IndustryPreset | null;
}) {
  return (
    <section data-testid="industry-wizard.step-review" className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <ListChecks
          className="w-4 h-4 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        Revisa lo que se aplicará
      </h2>
      {loading && (
        <p
          data-testid="industry-wizard.preview-loading"
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          Calculando preset…
        </p>
      )}
      {error && (
        <p
          data-testid="industry-wizard.preview-error"
          role="alert"
          className="text-xs text-red-600 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {!loading && !error && preset && <IndustryNormsSummary preset={preset} />}
    </section>
  );
}

function ConfirmStep({
  preset,
  application,
  submitting,
  onConfirm,
}: {
  preset: IndustryPreset | null;
  application: PresetApplication | null;
  submitting: boolean;
  onConfirm: () => void;
}) {
  return (
    <section data-testid="industry-wizard.step-confirm" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        Confirma la aplicación del preset
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Esto activará automáticamente: riesgos típicos, documentos
        obligatorios, capacitaciones mínimas, EPP base, normativa aplicable
        y protocolos MINSAL. Recomendación inicial — siempre ajustable.
      </p>
      {preset && (
        <div
          data-testid="industry-wizard.confirm-summary"
          className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/20 p-3 text-xs text-slate-700 dark:text-slate-200 space-y-1"
        >
          <div>
            <strong>Industria:</strong> {preset.label} ({preset.industryPrefix})
          </div>
          <div>
            <strong>Riesgos:</strong> {preset.typicalRisks.length}
          </div>
          <div>
            <strong>Documentos:</strong> {preset.mandatoryDocuments.length}
          </div>
          <div>
            <strong>Capacitaciones:</strong> {preset.mandatoryTrainings.length}
          </div>
          <div>
            <strong>EPP:</strong> {preset.baseEpp.length}
          </div>
          <div>
            <strong>Normativa:</strong> {preset.applicableRegulations.length}
          </div>
          <div>
            <strong>Protocolos MINSAL:</strong> {preset.minsalProtocols.length}
          </div>
        </div>
      )}
      {application && (
        <div
          data-testid="industry-wizard.applied-banner"
          role="status"
          className="rounded-lg bg-teal-100 dark:bg-teal-800/40 border border-teal-300 dark:border-teal-700 px-3 py-2 text-sm text-teal-800 dark:text-teal-100"
        >
          Preset aplicado. El proyecto ya tiene la configuración base.
        </div>
      )}
      {!application && (
        <button
          type="button"
          data-testid="industry-wizard.confirm-inline"
          onClick={onConfirm}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-sm font-semibold text-white flex items-center gap-1.5"
        >
          {submitting ? 'Aplicando…' : 'Aplicar ahora'}{' '}
          <Check size={14} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export default IndustrySelectorWizard;
