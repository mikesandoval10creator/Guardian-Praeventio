// @vitest-environment jsdom
//
// Sprint 24 Bucket KK.5 — OnboardingWizard tests.
//
// Coverage: 8 tests over the wizard's core invariants.
//   1. Initial state lands on the industry step.
//   2. parseEmailBlob: comma/semicolon/newline + dedup + trim.
//   3. isValidEmail: positive + negative cases.
//   4. validateStep blocks NEXT until each step's required field is set.
//   5. Reducer NEXT/BACK respects step order and step bounds.
//   6. TOGGLE_COUNTRY adds and removes (idempotent toggle).
//   7. Tier step renders all 10 tiers and the "Most popular" badge on titanio.
//   8. Submit calls the injected submitFn with the full payload, then onComplete.
//
// We deliberately exercise the reducer + helpers directly (faster, no
// jsdom flakiness) and only mount the component for the tier-rendering
// and end-to-end submit tests where DOM behavior is the contract.
//
// Épica Rubros SII — slice 2 additions:
//   9.  SET_RUBRO stores siiCode/sectorId and auto-selects the mapped vertical.
//   10. Manual SET_INDUSTRY clears a previously chosen rubro.
//   11. effectiveSectorId: rubro sectorId wins, manual industry falls back to GP-*.
//   12. Autocomplete by code '410010' selects construcción.
//   13. Autocomplete by free text selects minería ('extracción de cobre').
//   14. Dotación 30 → CPHS obligation; 10 → delegado(a) SST; 120 → +depto prevención.
//   15. Final step renders the read-only sector risk-profile summary.
//   16. Submit payload carries siiCode + estimatedWorkers.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import {
  OnboardingWizard,
  reducer,
  validateStep,
  isValidEmail,
  parseEmailBlob,
  effectiveSectorId,
  INITIAL_STATE,
  STEPS,
  POPULAR_TIER,
  type OnboardingState,
} from './OnboardingWizard';

// The wizard resolves its slice-2 copy through i18n; return the inline
// es-CL default so assertions read like the real UI (same pattern as
// PymeOnboardingPlanPanel.test.tsx).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OnboardingWizard — pure helpers', () => {
  it('1. initial state starts on the "industry" step', () => {
    expect(INITIAL_STATE.step).toBe('industry');
    expect(INITIAL_STATE.industry).toBeNull();
    expect(INITIAL_STATE.countries).toEqual([]);
    expect(STEPS).toEqual(['industry', 'countries', 'tier', 'team', 'project']);
  });

  it('2. parseEmailBlob splits on commas/semicolons/newlines, trims, dedups', () => {
    const blob = '  ana@x.cl, jorge@x.cl;\n ana@x.cl\nmaria@y.cl  ;;';
    expect(parseEmailBlob(blob)).toEqual([
      'ana@x.cl',
      'jorge@x.cl',
      'maria@y.cl',
    ]);
    expect(parseEmailBlob('')).toEqual([]);
    expect(parseEmailBlob('   ,;\n  ')).toEqual([]);
  });

  it('3. isValidEmail accepts valid emails and rejects malformed ones', () => {
    // Valid
    expect(isValidEmail('a@b.cl')).toBe(true);
    expect(isValidEmail('user.name+tag@sub.domain.cl')).toBe(true);
    // Invalid
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('no-at')).toBe(false);
    expect(isValidEmail('a@')).toBe(false);
    expect(isValidEmail('@b.cl')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false); // no dot in domain
    expect(isValidEmail('a @b.cl')).toBe(false); // whitespace
    expect(isValidEmail('a@.cl')).toBe(false); // domain starts with dot
  });

  it('4. validateStep returns an error string until each step is satisfied', () => {
    let s: OnboardingState = INITIAL_STATE;
    expect(validateStep(s)).toMatch(/industria/i);
    s = reducer(s, { type: 'SET_INDUSTRY', industry: 'mining' });
    expect(validateStep(s)).toBeNull();

    s = reducer(s, { type: 'NEXT' });
    expect(s.step).toBe('countries');
    expect(validateStep(s)).toMatch(/país/i);
    s = reducer(s, { type: 'TOGGLE_COUNTRY', code: 'CL' });
    expect(validateStep(s)).toBeNull();

    s = reducer(s, { type: 'NEXT' });
    expect(s.step).toBe('tier');
    expect(validateStep(s)).toMatch(/plan/i);
    s = reducer(s, { type: 'SET_TIER', tier: 'titanio' });
    expect(validateStep(s)).toBeNull();

    s = reducer(s, { type: 'NEXT' });
    expect(s.step).toBe('team');
    // Team step accepts empty list (invitations are optional).
    expect(validateStep(s)).toBeNull();
    s = reducer(s, { type: 'SET_EMAILS', emails: ['bad-email'] });
    expect(validateStep(s)).toMatch(/inválido/i);
    s = reducer(s, { type: 'SET_EMAILS', emails: ['ana@x.cl'] });
    expect(validateStep(s)).toBeNull();

    s = reducer(s, { type: 'NEXT' });
    expect(s.step).toBe('project');
    expect(validateStep(s)).toMatch(/2 caracteres/i);
    s = reducer(s, { type: 'SET_PROJECT_NAME', name: 'X' });
    expect(validateStep(s)).toMatch(/2 caracteres/i);
    s = reducer(s, { type: 'SET_PROJECT_NAME', name: 'Faena Norte' });
    expect(validateStep(s)).toBeNull();
  });

  it('5. NEXT does not advance past the last step; BACK does not go below 0', () => {
    let s: OnboardingState = {
      ...INITIAL_STATE,
      step: 'project',
      industry: 'mining',
      countries: ['CL'],
      tier: 'gratis',
      projectName: 'Faena Norte',
    };
    s = reducer(s, { type: 'NEXT' });
    expect(s.step).toBe('project'); // clamped at last
    s = reducer(s, { type: 'BACK' });
    expect(s.step).toBe('team');

    let t: OnboardingState = INITIAL_STATE;
    t = reducer(t, { type: 'BACK' });
    expect(t.step).toBe('industry'); // clamped at first
  });

  it('6. TOGGLE_COUNTRY adds on first toggle and removes on second', () => {
    let s: OnboardingState = INITIAL_STATE;
    s = reducer(s, { type: 'TOGGLE_COUNTRY', code: 'CL' });
    expect(s.countries).toEqual(['CL']);
    s = reducer(s, { type: 'TOGGLE_COUNTRY', code: 'AR' });
    expect(s.countries).toEqual(['CL', 'AR']);
    s = reducer(s, { type: 'TOGGLE_COUNTRY', code: 'CL' });
    expect(s.countries).toEqual(['AR']);
  });
});

describe('OnboardingWizard — component', () => {
  it('7. renders the popular badge on the configured POPULAR_TIER tile', async () => {
    const { getAllByTestId, getByTestId, queryByTestId } = render(
      <OnboardingWizard submitFn={async () => {}} />,
    );
    // Advance industry → countries → tier
    fireEvent.click(getByTestId('industry-mining'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('country-CL'));
    fireEvent.click(getByTestId('next-button'));

    // Now on tier step. The popular tier tile must render the badge.
    const popularTile = getByTestId(`tier-${POPULAR_TIER}`);
    expect(popularTile.querySelector('[data-testid="popular-badge"]')).not.toBeNull();
    // A non-popular tier (e.g. gratis) must NOT render the badge.
    const gratisTile = getByTestId('tier-gratis');
    expect(gratisTile.querySelector('[data-testid="popular-badge"]')).toBeNull();
    // 5 progress dots
    expect(getAllByTestId(/^progress-dot-/).length).toBe(5);
    // No error banner.
    expect(queryByTestId('onboarding-error')).toBeNull();
  });

  it('8. clicking Finish on the last step calls submitFn with the full payload and then onComplete', async () => {
    const submitFn = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const { getByTestId } = render(
      <OnboardingWizard submitFn={submitFn} onComplete={onComplete} />,
    );

    // Step 1 — industry
    fireEvent.click(getByTestId('industry-construction'));
    fireEvent.click(getByTestId('next-button'));
    // Step 2 — country
    fireEvent.click(getByTestId('country-CL'));
    fireEvent.click(getByTestId('country-AR'));
    fireEvent.click(getByTestId('next-button'));
    // Step 3 — tier
    fireEvent.click(getByTestId('tier-titanio'));
    fireEvent.click(getByTestId('next-button'));
    // Step 4 — team (skip emails)
    fireEvent.click(getByTestId('next-button'));
    // Step 5 — project
    fireEvent.change(getByTestId('project-name-input'), {
      target: { value: 'Faena Norte 2026' },
    });

    await act(async () => {
      fireEvent.click(getByTestId('finish-button'));
    });

    expect(submitFn).toHaveBeenCalledTimes(1);
    expect(submitFn).toHaveBeenCalledWith({
      industry: 'construction',
      countries: ['CL', 'AR'],
      tier: 'titanio',
      inviteEmails: [],
      projectName: 'Faena Norte 2026',
      workersCsv: null,
      siiCode: null,
      estimatedWorkers: null,
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingWizard — rubros SII (slice 2, reducer + helpers)', () => {
  it('9. SET_RUBRO stores siiCode/sectorId and auto-selects the mapped vertical', () => {
    let s: OnboardingState = INITIAL_STATE;
    s = reducer(s, { type: 'SET_RUBRO', codigo: 410010, sectorId: 'GP-CONS-RES' });
    expect(s.siiCode).toBe(410010);
    expect(s.sectorId).toBe('GP-CONS-RES');
    expect(s.industry).toBe('construction');
    // Petróleo subsector maps to the oil-gas vertical, not mining.
    s = reducer(s, { type: 'SET_RUBRO', codigo: 61000, sectorId: 'GP-MIN-PET' });
    expect(s.industry).toBe('oil-gas');
  });

  it('10. manual SET_INDUSTRY clears a previously chosen rubro', () => {
    let s: OnboardingState = INITIAL_STATE;
    s = reducer(s, { type: 'SET_RUBRO', codigo: 410010, sectorId: 'GP-CONS-RES' });
    s = reducer(s, { type: 'SET_INDUSTRY', industry: 'mining' });
    expect(s.industry).toBe('mining');
    expect(s.siiCode).toBeNull();
    expect(s.sectorId).toBeNull();
  });

  it('11. effectiveSectorId prefers the rubro sectorId and falls back to the manual vertical', () => {
    expect(
      effectiveSectorId({ ...INITIAL_STATE, sectorId: 'GP-CONS-RES', industry: 'construction' }),
    ).toBe('GP-CONS-RES');
    expect(effectiveSectorId({ ...INITIAL_STATE, industry: 'mining' })).toBe('GP-MIN');
    expect(effectiveSectorId({ ...INITIAL_STATE, industry: 'oil-gas' })).toBe('GP-MIN-PET');
    expect(effectiveSectorId(INITIAL_STATE)).toBeNull();
  });

  it('SET_WORKER_COUNT stores the estimated headcount (null clears it)', () => {
    let s: OnboardingState = INITIAL_STATE;
    s = reducer(s, { type: 'SET_WORKER_COUNT', count: 30 });
    expect(s.estimatedWorkers).toBe(30);
    s = reducer(s, { type: 'SET_WORKER_COUNT', count: null });
    expect(s.estimatedWorkers).toBeNull();
  });
});

describe('OnboardingWizard — rubros SII (slice 2, component)', () => {
  it('12. searching by code 410010 and picking the rubro auto-selects construcción', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('sii-search-input'), { target: { value: '410010' } });
    fireEvent.click(getByTestId('sii-result-410010'));
    // Selected chip shows the canonical zero-padded code.
    expect(getByTestId('sii-selected').textContent).toContain('410010');
    expect(getByTestId('sii-selected').textContent).toMatch(/RESIDENCIAL/i);
    // The manual vertical grid reflects the auto-selection.
    expect(getByTestId('industry-construction').getAttribute('aria-pressed')).toBe('true');
  });

  it('13. searching by free text selects the matching rubro and its vertical', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('sii-search-input'), {
      target: { value: 'extracción de cobre' },
    });
    fireEvent.click(getByTestId('sii-result-40000'));
    expect(getByTestId('industry-mining').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('sii-selected').textContent).toContain('040000');
  });

  it('shows a no-results hint without breaking the manual selector', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('sii-search-input'), {
      target: { value: 'zzzz actividad inexistente' },
    });
    expect(getByTestId('sii-no-results')).toBeTruthy();
    // Manual selection still works as the alternative path.
    fireEvent.click(getByTestId('industry-mining'));
    expect(getByTestId('industry-mining').getAttribute('aria-pressed')).toBe('true');
  });

  it('14a. dotación 30 shows the CPHS obligation (≥25)', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('workers-count-input'), { target: { value: '30' } });
    const panel = getByTestId('dotacion-obligaciones');
    expect(panel.textContent).toMatch(/Comité Paritario de Higiene y Seguridad/);
    expect(panel.textContent).not.toMatch(/delegado/i);
    expect(panel.textContent).not.toMatch(/Departamento de Prevención/);
  });

  it('14b. dotación 10 shows the delegado(a) SST obligation (<25)', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('workers-count-input'), { target: { value: '10' } });
    const panel = getByTestId('dotacion-obligaciones');
    expect(panel.textContent).toMatch(/delegado/i);
    expect(panel.textContent).not.toMatch(/Constituir Comité Paritario/);
  });

  it('14c. dotación 120 adds the Departamento de Prevención obligation (≥100)', () => {
    const { getByTestId, queryByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    fireEvent.change(getByTestId('workers-count-input'), { target: { value: '120' } });
    const panel = getByTestId('dotacion-obligaciones');
    expect(panel.textContent).toMatch(/Comité Paritario/);
    expect(panel.textContent).toMatch(/Departamento de Prevención de Riesgos/);
    // Clearing the input hides the panel.
    fireEvent.change(getByTestId('workers-count-input'), { target: { value: '' } });
    expect(queryByTestId('dotacion-obligaciones')).toBeNull();
  });

  it('15. final step renders the read-only sector risk-profile summary', () => {
    const { getByTestId } = render(<OnboardingWizard submitFn={async () => {}} />);
    // Pick construcción via the SII autocomplete, then walk to the last step.
    fireEvent.change(getByTestId('sii-search-input'), { target: { value: '410010' } });
    fireEvent.click(getByTestId('sii-result-410010'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('country-CL'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('tier-gratis'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('next-button')); // team (optional)

    const summary = getByTestId('risk-profile-summary');
    // Normativa: universal base + construction-specific pack entries.
    expect(summary.textContent).toMatch(/Ley 16\.744/);
    expect(summary.textContent).toMatch(/DS 76/);
    // EPP típico for GP-CONS.
    expect(summary.textContent).toMatch(/Arnés seguridad/);
    // Seed hazards for construction.
    expect(summary.textContent).toMatch(/Caída a distinto nivel/);
  });

  it('16. submit payload carries siiCode + estimatedWorkers from the wizard', async () => {
    const submitFn = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const { getByTestId } = render(
      <OnboardingWizard submitFn={submitFn} onComplete={onComplete} />,
    );

    fireEvent.change(getByTestId('sii-search-input'), { target: { value: '410010' } });
    fireEvent.click(getByTestId('sii-result-410010'));
    fireEvent.change(getByTestId('workers-count-input'), { target: { value: '30' } });
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('country-CL'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('tier-gratis'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.click(getByTestId('next-button'));
    fireEvent.change(getByTestId('project-name-input'), {
      target: { value: 'Faena Norte 2026' },
    });

    await act(async () => {
      fireEvent.click(getByTestId('finish-button'));
    });

    expect(submitFn).toHaveBeenCalledWith({
      industry: 'construction',
      countries: ['CL'],
      tier: 'gratis',
      inviteEmails: [],
      projectName: 'Faena Norte 2026',
      workersCsv: null,
      siiCode: 410010,
      estimatedWorkers: 30,
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
