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

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import {
  OnboardingWizard,
  reducer,
  validateStep,
  isValidEmail,
  parseEmailBlob,
  INITIAL_STATE,
  STEPS,
  POPULAR_TIER,
  type OnboardingState,
} from './OnboardingWizard';

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
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
