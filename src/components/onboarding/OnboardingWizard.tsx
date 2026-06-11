// Sprint 24 Bucket KK.1 — Self-service tenant onboarding wizard.
//
// 5-step wizard that lets a brand-new tenant configure themselves
// without manual setup by Praeventio staff:
//   1. Industry  — 12 verticals + SII rubro autocomplete + dotación estimada
//   2. Countries — multi-select 7 LATAM + EN
//   3. Tier      — pricing comparison with "Most popular" highlight
//   4. Team      — invite by emails (CSV or comma-separated)
//   5. Project   — first project name + optional CSV worker import +
//                  read-only sector risk-profile summary
//
// Épica Rubros SII — slice 2: the industry step also offers an
// autocomplete over the verified SII economic-activity catalogue
// (`searchRubros`); picking a rubro auto-selects the mapped vertical and
// records `siiCode` + the GP-* `sectorId`. The estimated headcount drives
// an informational DS 44/2024 obligations panel (delegado / CPHS ≥25 /
// +depto ≥100, thresholds read from CL_PACK). The final step shows the
// sector's preventive profile (`getRiskProfileForSector`) — read-only in
// this slice; ZK seed instantiation is slice 3.
//
// State is held in a single reducer (pure, exported for tests). The
// component is a thin shell around it; the back/next/submit handlers
// only dispatch — that keeps the validation logic testable without
// jsdom render gymnastics on every assertion.

import React, { useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Check, Upload, Sparkles } from 'lucide-react';
import { TIERS, type TierId, formatCurrency } from '../../services/pricing/tiers';
import { searchRubros, findByCodigo, formatCodigoSii } from '../../services/sii/rubroSearch';
import {
  getRiskProfileForSector,
  obligacionesPorDotacion,
} from '../../services/sii/industryRiskProfile';
import { CL_PACK } from '../../data/normativa/cl';
import type { SiiActividadEconomica } from '../../data/sii/actividadesEconomicas';

// ───────────────────────── Constants ─────────────────────────

export const INDUSTRIES = [
  { id: 'mining', label: 'Minería' },
  { id: 'construction', label: 'Construcción' },
  { id: 'manufacturing', label: 'Manufactura' },
  { id: 'oil-gas', label: 'Petróleo y Gas' },
  { id: 'agriculture', label: 'Agricultura' },
  { id: 'retail', label: 'Retail' },
  { id: 'healthcare', label: 'Salud' },
  { id: 'education', label: 'Educación' },
  { id: 'finance', label: 'Finanzas' },
  { id: 'transport', label: 'Transporte' },
  { id: 'services', label: 'Servicios' },
  { id: 'public', label: 'Sector Público' },
] as const;

export type IndustryId = (typeof INDUSTRIES)[number]['id'];

export const COUNTRIES = [
  { code: 'CL', label: 'Chile', flag: '🇨🇱' },
  { code: 'AR', label: 'Argentina', flag: '🇦🇷' },
  { code: 'PE', label: 'Perú', flag: '🇵🇪' },
  { code: 'CO', label: 'Colombia', flag: '🇨🇴' },
  { code: 'MX', label: 'México', flag: '🇲🇽' },
  { code: 'BR', label: 'Brasil', flag: '🇧🇷' },
  { code: 'EN', label: 'English (Global)', flag: '🌐' },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]['code'];

/** Tier highlighted as "Most popular" in the comparison table. */
export const POPULAR_TIER: TierId = 'titanio';

// Stripe-style featured/recommended tier — the "Suite Pro" equivalent.
// Titanio is the inflection point where overage charges disappear and
// workspace_tier becomes multi-tenant, which is the business sweet spot.

export const STEPS = ['industry', 'countries', 'tier', 'team', 'project'] as const;
export type Step = (typeof STEPS)[number];

// ───────────────────────── SII rubro ↔ vertical mapping ─────────────────────────

/**
 * Longest-prefix map from the GP-* taxonomy (src/constants.ts) to the 12
 * wizard verticals. Subsector overrides (e.g. GP-MIN-PET → oil-gas) beat
 * their major-sector key. Sectors with no curated vertical fall back to
 * 'services'.
 */
export const GP_TO_INDUSTRY: Record<string, IndustryId> = {
  'GP-AGR': 'agriculture',
  'GP-MIN': 'mining',
  'GP-MIN-PET': 'oil-gas',
  'GP-MANU': 'manufacturing',
  'GP-MANU-COQ': 'oil-gas', // coque y refinación de petróleo
  'GP-ELEC': 'services',
  'GP-ENERG': 'services',
  'GP-CONS': 'construction',
  'GP-COM': 'retail',
  'GP-TRANS': 'transport',
  'GP-ALOJA': 'services',
  'GP-INF': 'services',
  'GP-FIN': 'finance',
  'GP-RE': 'services',
  'GP-PRO': 'services',
  'GP-ADM': 'services',
  'GP-PUB': 'public',
  'GP-EDU': 'education',
  'GP-SAL': 'healthcare',
  'GP-ART': 'services',
  'GP-SER': 'services',
  'GP-HOG': 'services',
  'GP-EXT': 'public',
};

/**
 * Manual-selection fallback: maps a wizard vertical to a representative
 * GP-* sector so the risk-profile summary still works when the user skipped
 * the SII autocomplete. The rubro-derived subsector always wins over this.
 */
export const INDUSTRY_TO_GP: Record<IndustryId, string> = {
  mining: 'GP-MIN',
  construction: 'GP-CONS',
  manufacturing: 'GP-MANU',
  'oil-gas': 'GP-MIN-PET',
  agriculture: 'GP-AGR',
  retail: 'GP-COM',
  healthcare: 'GP-SAL',
  education: 'GP-EDU',
  finance: 'GP-FIN',
  transport: 'GP-TRANS',
  services: 'GP-SER',
  public: 'GP-PUB',
};

/** Longest-prefix lookup of the wizard vertical for a GP-* sector id. */
export function industryForSector(sectorId: string): IndustryId {
  let best: IndustryId = 'services';
  let bestLength = -1;
  for (const [key, value] of Object.entries(GP_TO_INDUSTRY)) {
    if ((sectorId === key || sectorId.startsWith(`${key}-`)) && key.length > bestLength) {
      best = value;
      bestLength = key.length;
    }
  }
  return best;
}

// ───────────────────────── State machine ─────────────────────────

export interface OnboardingState {
  step: Step;
  industry: IndustryId | null;
  /** SII economic-activity code chosen via the autocomplete (null = manual). */
  siiCode: number | null;
  /** GP-* subsector derived from the chosen rubro (null = manual selection). */
  sectorId: string | null;
  /** Estimated headcount for the DS 44/2024 obligations panel (optional). */
  estimatedWorkers: number | null;
  countries: CountryCode[];
  tier: TierId | null;
  inviteEmails: string[];
  projectName: string;
  workersCsv: string | null; // raw CSV text; null = skipped
  submitting: boolean;
  error: string | null;
}

export const INITIAL_STATE: OnboardingState = {
  step: 'industry',
  industry: null,
  siiCode: null,
  sectorId: null,
  estimatedWorkers: null,
  countries: [],
  tier: null,
  inviteEmails: [],
  projectName: '',
  workersCsv: null,
  submitting: false,
  error: null,
};

export type Action =
  | { type: 'SET_INDUSTRY'; industry: IndustryId }
  | { type: 'SET_RUBRO'; codigo: number; sectorId: string }
  | { type: 'SET_WORKER_COUNT'; count: number | null }
  | { type: 'TOGGLE_COUNTRY'; code: CountryCode }
  | { type: 'SET_TIER'; tier: TierId }
  | { type: 'SET_EMAILS'; emails: string[] }
  | { type: 'SET_PROJECT_NAME'; name: string }
  | { type: 'SET_WORKERS_CSV'; csv: string | null }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_FAIL'; error: string }
  | { type: 'SUBMIT_OK' };

/**
 * Effective GP-* sector for the preventive profile: the rubro-derived
 * subsector wins; a manual vertical falls back to its representative
 * GP-* major sector; null until something is selected.
 */
export function effectiveSectorId(
  state: Pick<OnboardingState, 'sectorId' | 'industry'>,
): string | null {
  if (state.sectorId) return state.sectorId;
  if (state.industry) return INDUSTRY_TO_GP[state.industry];
  return null;
}

export function reducer(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case 'SET_INDUSTRY':
      // Manual pick overrides (and clears) a previously chosen SII rubro —
      // keeping a stale siiCode would persist a code that contradicts the
      // vertical the user explicitly selected.
      return { ...state, industry: action.industry, siiCode: null, sectorId: null, error: null };
    case 'SET_RUBRO':
      return {
        ...state,
        siiCode: action.codigo,
        sectorId: action.sectorId,
        industry: industryForSector(action.sectorId),
        error: null,
      };
    case 'SET_WORKER_COUNT':
      return { ...state, estimatedWorkers: action.count, error: null };
    case 'TOGGLE_COUNTRY': {
      const has = state.countries.includes(action.code);
      const countries = has
        ? state.countries.filter((c) => c !== action.code)
        : [...state.countries, action.code];
      return { ...state, countries, error: null };
    }
    case 'SET_TIER':
      return { ...state, tier: action.tier, error: null };
    case 'SET_EMAILS':
      return { ...state, inviteEmails: action.emails, error: null };
    case 'SET_PROJECT_NAME':
      return { ...state, projectName: action.name, error: null };
    case 'SET_WORKERS_CSV':
      return { ...state, workersCsv: action.csv, error: null };
    case 'NEXT': {
      const err = validateStep(state);
      if (err) return { ...state, error: err };
      const idx = STEPS.indexOf(state.step);
      const next = STEPS[Math.min(idx + 1, STEPS.length - 1)];
      return { ...state, step: next, error: null };
    }
    case 'BACK': {
      const idx = STEPS.indexOf(state.step);
      const prev = STEPS[Math.max(idx - 1, 0)];
      return { ...state, step: prev, error: null };
    }
    case 'SUBMIT_START':
      return { ...state, submitting: true, error: null };
    case 'SUBMIT_FAIL':
      return { ...state, submitting: false, error: action.error };
    case 'SUBMIT_OK':
      return { ...state, submitting: false, error: null };
    default:
      return state;
  }
}

/** Returns null if the current step is valid, otherwise an error string. */
export function validateStep(state: OnboardingState): string | null {
  switch (state.step) {
    case 'industry':
      return state.industry ? null : 'Selecciona una industria';
    case 'countries':
      return state.countries.length > 0 ? null : 'Selecciona al menos un país';
    case 'tier':
      return state.tier ? null : 'Selecciona un plan';
    case 'team': {
      // Team invitations are optional but if any provided they must be valid.
      if (state.inviteEmails.length === 0) return null;
      const bad = state.inviteEmails.find((e) => !isValidEmail(e));
      return bad ? `Email inválido: ${bad}` : null;
    }
    case 'project':
      return state.projectName.trim().length >= 2
        ? null
        : 'Nombre de proyecto debe tener al menos 2 caracteres';
    default:
      return null;
  }
}

export function isValidEmail(s: string): boolean {
  // Pragmatic check: one @, dot in domain, no spaces. Server does the
  // authoritative validation when it actually sends the invite.
  if (!s || /\s/.test(s)) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const domain = s.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * Parse a comma/semicolon/newline-separated email blob into a deduplicated
 * trimmed list. Used by both the textarea handler and the CSV upload path.
 */
export function parseEmailBlob(blob: string): string[] {
  if (!blob) return [];
  const parts = blob
    .split(/[,;\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

// ───────────────────────── Component ─────────────────────────

export interface OnboardingWizardProps {
  onComplete?: () => void;
  /** Override fetch for tests / Storybook. */
  submitFn?: (payload: OnboardingSubmitPayload) => Promise<void>;
}

export interface OnboardingSubmitPayload {
  industry: IndustryId;
  countries: CountryCode[];
  tier: TierId;
  inviteEmails: string[];
  projectName: string;
  workersCsv: string | null;
  /** SII rubro chosen via autocomplete; the server re-derives the GP sector. */
  siiCode: number | null;
  /** Estimated headcount (informational; drives DS 44/2024 obligations). */
  estimatedWorkers: number | null;
}

async function defaultSubmit(payload: OnboardingSubmitPayload): Promise<void> {
  const res = await fetch('/api/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export function OnboardingWizard({ onComplete, submitFn }: OnboardingWizardProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [emailsRaw, setEmailsRaw] = useState('');

  const submit = submitFn ?? defaultSubmit;

  async function handleFinish() {
    const err = validateStep(state);
    if (err) {
      dispatch({ type: 'SUBMIT_FAIL', error: err });
      return;
    }
    if (!state.industry || !state.tier) {
      dispatch({ type: 'SUBMIT_FAIL', error: 'Estado inválido' });
      return;
    }
    dispatch({ type: 'SUBMIT_START' });
    try {
      await submit({
        industry: state.industry,
        countries: state.countries,
        tier: state.tier,
        inviteEmails: state.inviteEmails,
        projectName: state.projectName.trim(),
        workersCsv: state.workersCsv,
        siiCode: state.siiCode,
        estimatedWorkers: state.estimatedWorkers,
      });
      dispatch({ type: 'SUBMIT_OK' });
      onComplete?.();
    } catch (e) {
      dispatch({
        type: 'SUBMIT_FAIL',
        error: e instanceof Error ? e.message : 'Error inesperado',
      });
    }
  }

  const stepIdx = STEPS.indexOf(state.step);
  const isLast = state.step === 'project';

  return (
    <div
      data-testid="onboarding-wizard"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6"
    >
      <div className="w-full max-w-3xl bg-slate-900 rounded-2xl shadow-2xl p-8 border border-teal-700/30">
        <ProgressDots current={stepIdx} total={STEPS.length} />

        <h1 className="text-2xl font-bold mt-6 mb-2">
          Bienvenido a Guardian Praeventio
        </h1>
        <p className="text-slate-400 mb-6 text-sm">
          Configura tu cuenta en 5 pasos rápidos.
        </p>

        {state.step === 'industry' && (
          <IndustryStep
            value={state.industry}
            siiCode={state.siiCode}
            sectorId={state.sectorId}
            estimatedWorkers={state.estimatedWorkers}
            onChange={(industry) => dispatch({ type: 'SET_INDUSTRY', industry })}
            onRubro={(rubro) =>
              dispatch({ type: 'SET_RUBRO', codigo: rubro.codigo, sectorId: rubro.sectorId })
            }
            onWorkerCount={(count) => dispatch({ type: 'SET_WORKER_COUNT', count })}
          />
        )}

        {state.step === 'countries' && (
          <CountriesStep
            value={state.countries}
            onToggle={(code) => dispatch({ type: 'TOGGLE_COUNTRY', code })}
          />
        )}

        {state.step === 'tier' && (
          <TierStep
            value={state.tier}
            onChange={(tier) => dispatch({ type: 'SET_TIER', tier })}
          />
        )}

        {state.step === 'team' && (
          <TeamStep
            raw={emailsRaw}
            onRawChange={(raw) => {
              setEmailsRaw(raw);
              dispatch({ type: 'SET_EMAILS', emails: parseEmailBlob(raw) });
            }}
            onCsvUpload={async (file) => {
              const text = await file.text();
              setEmailsRaw(text);
              dispatch({ type: 'SET_EMAILS', emails: parseEmailBlob(text) });
            }}
            parsed={state.inviteEmails}
          />
        )}

        {state.step === 'project' && (
          <ProjectStep
            name={state.projectName}
            onNameChange={(name) => dispatch({ type: 'SET_PROJECT_NAME', name })}
            workersCsv={state.workersCsv}
            onCsvChange={(csv) => dispatch({ type: 'SET_WORKERS_CSV', csv })}
            sectorId={effectiveSectorId(state)}
          />
        )}

        {state.error && (
          <div
            data-testid="onboarding-error"
            className="mt-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-800 text-red-200 text-sm"
          >
            {state.error}
          </div>
        )}

        <div className="flex justify-between mt-8">
          <button
            type="button"
            onClick={() => dispatch({ type: 'BACK' })}
            disabled={stepIdx === 0 || state.submitting}
            data-testid="back-button"
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ChevronLeft size={16} /> Atrás
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleFinish}
              disabled={state.submitting}
              data-testid="finish-button"
              className="px-6 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold flex items-center gap-2"
            >
              {state.submitting ? 'Configurando…' : 'Completar setup'} <Check size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dispatch({ type: 'NEXT' })}
              data-testid="next-button"
              className="px-6 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 font-semibold flex items-center gap-2"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Step components ─────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 justify-center" data-testid="progress-dots">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-testid={`progress-dot-${i}`}
          className={`h-2 w-2 rounded-full transition-colors ${
            i <= current ? 'bg-teal-400' : 'bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}

function IndustryStep({
  value,
  siiCode,
  sectorId,
  estimatedWorkers,
  onChange,
  onRubro,
  onWorkerCount,
}: {
  value: IndustryId | null;
  siiCode: number | null;
  sectorId: string | null;
  estimatedWorkers: number | null;
  onChange: (id: IndustryId) => void;
  onRubro: (rubro: SiiActividadEconomica) => void;
  onWorkerCount: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const results = trimmed.length >= 2 ? searchRubros(trimmed, 8) : [];
  const selectedRubro = siiCode != null ? findByCodigo(siiCode) : undefined;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">¿Cuál es tu industria?</h2>

      {/* SII autocomplete — picks the rubro and auto-selects the vertical. */}
      <label className="block text-sm text-slate-300 mb-1" htmlFor="sii-search-input">
        {t('onboarding.sii.searchLabel', 'Busca tu rubro SII (código o actividad)')}
      </label>
      <input
        id="sii-search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('onboarding.sii.searchPlaceholder', 'Ej: 410010 o extracción de cobre')}
        data-testid="sii-search-input"
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:border-teal-500 focus:outline-none"
      />
      {trimmed.length >= 2 && results.length > 0 && (
        <ul
          data-testid="sii-results"
          className="mt-2 rounded-lg border border-slate-700 divide-y divide-slate-800 overflow-hidden"
        >
          {results.map((r) => (
            <li key={r.codigo}>
              <button
                type="button"
                data-testid={`sii-result-${r.codigo}`}
                onClick={() => {
                  onRubro(r);
                  setQuery('');
                }}
                className="w-full text-left px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700"
              >
                <span className="font-mono text-teal-400 mr-2">{formatCodigoSii(r.codigo)}</span>
                {r.descripcion}
              </button>
            </li>
          ))}
        </ul>
      )}
      {trimmed.length >= 2 && results.length === 0 && (
        <p data-testid="sii-no-results" className="mt-2 text-xs text-slate-400">
          {t(
            'onboarding.sii.noResults',
            'Sin resultados. Puedes elegir la industria manualmente abajo.',
          )}
        </p>
      )}
      {siiCode != null && sectorId && (
        <div
          data-testid="sii-selected"
          className="mt-2 px-3 py-2 rounded-lg bg-teal-950/40 border border-teal-700/50 text-xs text-teal-200"
        >
          <span className="font-semibold mr-1">
            {t('onboarding.sii.selectedLabel', 'Rubro SII seleccionado')}:
          </span>
          <span className="font-mono">{formatCodigoSii(siiCode)}</span>
          {selectedRubro ? ` — ${selectedRubro.descripcion}` : null}
          <span className="block text-teal-400/80 mt-0.5">
            {t('onboarding.sii.sectorAuto', 'Sector preventivo asignado')}: {sectorId}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        {INDUSTRIES.map((ind) => (
          <button
            key={ind.id}
            type="button"
            onClick={() => onChange(ind.id)}
            data-testid={`industry-${ind.id}`}
            aria-pressed={value === ind.id}
            className={`px-4 py-3 rounded-lg text-sm border transition-colors ${
              value === ind.id
                ? 'bg-teal-600 border-teal-400 text-white'
                : 'bg-slate-800 border-slate-700 hover:border-teal-500'
            }`}
          >
            {ind.label}
          </button>
        ))}
      </div>

      <DotacionSection estimatedWorkers={estimatedWorkers} onWorkerCount={onWorkerCount} />
    </div>
  );
}

function DotacionSection({
  estimatedWorkers,
  onWorkerCount,
}: {
  estimatedWorkers: number | null;
  onWorkerCount: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const obligaciones =
    estimatedWorkers != null && estimatedWorkers > 0
      ? obligacionesPorDotacion(estimatedWorkers, CL_PACK).obligaciones
      : null;

  return (
    <div className="mt-6">
      <label className="block text-sm text-slate-300 mb-1" htmlFor="workers-count-input">
        {t('onboarding.dotacion.label', '¿Cuántas personas trabajan en tu empresa? (estimado)')}
      </label>
      <input
        id="workers-count-input"
        type="number"
        min={1}
        value={estimatedWorkers ?? ''}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onWorkerCount(Number.isInteger(n) && n > 0 ? n : null);
        }}
        placeholder="30"
        data-testid="workers-count-input"
        className="w-full sm:w-48 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:border-teal-500 focus:outline-none"
      />
      {obligaciones && (
        <div
          data-testid="dotacion-obligaciones"
          className="mt-3 px-4 py-3 rounded-lg bg-slate-800/70 border border-slate-700 text-xs text-slate-300"
        >
          <p className="font-semibold text-slate-200 mb-2">
            {t(
              'onboarding.dotacion.obligationsTitle',
              'Obligaciones preventivas en Chile según tu dotación',
            )}
          </p>
          <ul className="list-disc list-inside space-y-1">
            {obligaciones.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CountriesStep({
  value,
  onToggle,
}: {
  value: CountryCode[];
  onToggle: (code: CountryCode) => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">¿En qué países operas?</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {COUNTRIES.map((c) => {
          const selected = value.includes(c.code);
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => onToggle(c.code)}
              data-testid={`country-${c.code}`}
              aria-pressed={selected}
              className={`px-4 py-3 rounded-lg text-sm border flex items-center gap-2 transition-colors ${
                selected
                  ? 'bg-teal-600 border-teal-400 text-white'
                  : 'bg-slate-800 border-slate-700 hover:border-teal-500'
              }`}
            >
              <span className="text-xl" aria-hidden="true">
                {c.flag}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TierStep({
  value,
  onChange,
}: {
  value: TierId | null;
  onChange: (id: TierId) => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Elige tu plan</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TIERS.map((t) => {
          const selected = value === t.id;
          const popular = t.id === POPULAR_TIER;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              data-testid={`tier-${t.id}`}
              className={`relative text-left px-4 py-4 rounded-lg border transition-colors ${
                selected
                  ? 'bg-teal-600/20 border-teal-400'
                  : popular
                    ? 'bg-slate-800 border-amber-500/60 hover:border-amber-400'
                    : 'bg-slate-800 border-slate-700 hover:border-teal-500'
              }`}
            >
              {popular && (
                <span
                  data-testid="popular-badge"
                  className="absolute -top-2 right-3 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500 text-slate-900 flex items-center gap-1"
                >
                  <Sparkles size={10} /> Most popular
                </span>
              )}
              <div className="font-semibold">{t.nombre}</div>
              <div className="text-2xl font-bold mt-2">
                {t.clpRegular === 0 ? 'Gratis' : formatCurrency(t.clpRegular, 'CLP')}
                {t.clpRegular > 0 && (
                  <span className="text-xs font-normal text-slate-400">/mes</span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-2">
                {t.trabajadoresMax >= 999_999
                  ? 'Trabajadores ilimitados'
                  : `Hasta ${t.trabajadoresMax} trabajadores`}
              </div>
              <div className="text-xs text-slate-400">
                {t.proyectosMax >= 999_999
                  ? 'Proyectos ilimitados'
                  : `Hasta ${t.proyectosMax} proyectos`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamStep({
  raw,
  onRawChange,
  onCsvUpload,
  parsed,
}: {
  raw: string;
  onRawChange: (s: string) => void;
  onCsvUpload: (file: File) => Promise<void> | void;
  parsed: string[];
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Invita a tu equipo</h2>
      <p className="text-slate-400 text-sm mb-3">
        Opcional. Pega emails separados por coma o sube un CSV.
      </p>
      <textarea
        value={raw}
        onChange={(e) => onRawChange(e.target.value)}
        placeholder="ana@empresa.cl, jorge@empresa.cl, …"
        rows={4}
        data-testid="emails-textarea"
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:border-teal-500 focus:outline-none"
      />
      <div className="flex items-center justify-between mt-2 text-xs">
        <label
          className="flex items-center gap-2 cursor-pointer text-teal-400 hover:text-teal-300"
          data-testid="csv-upload-label"
        >
          <Upload size={14} /> Subir CSV
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            data-testid="csv-upload-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await onCsvUpload(f);
            }}
          />
        </label>
        <span data-testid="emails-count" className="text-slate-400">
          {parsed.length} email{parsed.length === 1 ? '' : 's'} válido
          {parsed.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function ProjectStep({
  name,
  onNameChange,
  workersCsv,
  onCsvChange,
  sectorId,
}: {
  name: string;
  onNameChange: (s: string) => void;
  workersCsv: string | null;
  onCsvChange: (csv: string | null) => void;
  sectorId: string | null;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Tu primer proyecto</h2>
      <label className="block text-sm text-slate-300 mb-1">Nombre del proyecto</label>
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Faena Norte 2026"
        data-testid="project-name-input"
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:border-teal-500 focus:outline-none"
      />

      <label className="block text-sm text-slate-300 mt-4 mb-1">
        Importar trabajadores (CSV opcional)
      </label>
      <div className="flex items-center gap-3">
        <label
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-teal-500 text-sm cursor-pointer flex items-center gap-2"
          data-testid="workers-csv-label"
        >
          <Upload size={14} /> {workersCsv ? 'Reemplazar CSV' : 'Subir CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            data-testid="workers-csv-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const text = await f.text();
                onCsvChange(text);
              }
            }}
          />
        </label>
        {workersCsv && (
          <button
            type="button"
            onClick={() => onCsvChange(null)}
            data-testid="workers-csv-clear"
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Quitar
          </button>
        )}
        <span className="text-xs text-slate-500">
          Puedes saltarte este paso e importar después.
        </span>
      </div>

      {sectorId && <RiskProfileSummary sectorId={sectorId} />}
    </div>
  );
}

/**
 * Read-only preventive-profile summary for the chosen sector (slice 2):
 * applicable regulations + typical EPP + seed hazards. Instantiating the
 * seeds as project hazards (ZK) is slice 3 — nothing here writes anywhere.
 */
function RiskProfileSummary({ sectorId }: { sectorId: string }) {
  const { t } = useTranslation();
  const profile = getRiskProfileForSector(sectorId);

  return (
    <div
      data-testid="risk-profile-summary"
      className="mt-6 px-4 py-4 rounded-lg bg-slate-800/70 border border-slate-700 text-xs text-slate-300"
    >
      <p className="font-semibold text-slate-100 text-sm">
        {t('onboarding.profile.title', 'Perfil preventivo de tu sector')}{' '}
        <span className="font-mono text-teal-400">{profile.sectorId}</span>
      </p>
      <p className="text-slate-500 mt-0.5 mb-3">
        {t(
          'onboarding.profile.readOnlyHint',
          'Información referencial: podrás generar tu matriz de riesgos desde el panel.',
        )}
      </p>

      <p className="font-semibold text-slate-200 mb-1">
        {t('onboarding.profile.regulations', 'Normativa aplicable')}
      </p>
      <ul className="list-disc list-inside space-y-0.5 mb-3">
        {profile.regulations.map((r) => (
          <li key={r.id}>{r.title}</li>
        ))}
      </ul>

      <p className="font-semibold text-slate-200 mb-1">
        {t('onboarding.profile.epp', 'EPP típico')}
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        {profile.epp.map((e) => (
          <span
            key={e.label}
            className="px-2 py-1 rounded-full bg-slate-900 border border-slate-700"
          >
            <span aria-hidden="true">{e.emoji}</span> {e.label}
          </span>
        ))}
      </div>

      <p className="font-semibold text-slate-200 mb-1">
        {t('onboarding.profile.risks', 'Riesgos típicos a evaluar')}
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {profile.riesgosTipicos.map((riesgo) => (
          <li key={riesgo}>{riesgo}</li>
        ))}
      </ul>

      {profile.notasPreventivas.length > 0 && (
        <>
          <p className="font-semibold text-slate-200 mt-3 mb-1">
            {t('onboarding.profile.notes', 'Notas preventivas')}
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {profile.notasPreventivas.map((nota) => (
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default OnboardingWizard;
