// Sprint 24 Bucket KK.1 — Self-service tenant onboarding wizard.
//
// 5-step wizard that lets a brand-new tenant configure themselves
// without manual setup by Praeventio staff:
//   1. Industry  — 12 verticals
//   2. Countries — multi-select 7 LATAM + EN
//   3. Tier      — pricing comparison with "Most popular" highlight
//   4. Team      — invite by emails (CSV or comma-separated)
//   5. Project   — first project name + optional CSV worker import
//
// State is held in a single reducer (pure, exported for tests). The
// component is a thin shell around it; the back/next/submit handlers
// only dispatch — that keeps the validation logic testable without
// jsdom render gymnastics on every assertion.

import React, { useReducer, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Upload, Sparkles } from 'lucide-react';
import { TIERS, type TierId, formatCurrency } from '../../services/pricing/tiers';

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

// ───────────────────────── State machine ─────────────────────────

export interface OnboardingState {
  step: Step;
  industry: IndustryId | null;
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

export function reducer(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case 'SET_INDUSTRY':
      return { ...state, industry: action.industry, error: null };
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
    case 'team':
      // Team invitations are optional but if any provided they must be valid.
      if (state.inviteEmails.length === 0) return null;
      const bad = state.inviteEmails.find((e) => !isValidEmail(e));
      return bad ? `Email inválido: ${bad}` : null;
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
            onChange={(industry) => dispatch({ type: 'SET_INDUSTRY', industry })}
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
  onChange,
}: {
  value: IndustryId | null;
  onChange: (id: IndustryId) => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">¿Cuál es tu industria?</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {INDUSTRIES.map((ind) => (
          <button
            key={ind.id}
            type="button"
            onClick={() => onChange(ind.id)}
            data-testid={`industry-${ind.id}`}
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
}: {
  name: string;
  onNameChange: (s: string) => void;
  workersCsv: string | null;
  onCsvChange: (csv: string | null) => void;
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
    </div>
  );
}

export default OnboardingWizard;
