import { describe, it, expect } from 'vitest';
import {
  suggestUpsell,
  type UsagePainSignals,
} from './painBasedUpsellSuggester.js';

function signals(over: Partial<UsagePainSignals> = {}): UsagePainSignals {
  return {
    manualReportsPerWeek: over.manualReportsPerWeek ?? 0,
    exceptionsRaisedLast30d: over.exceptionsRaisedLast30d ?? 0,
    dataConfidenceScore: over.dataConfidenceScore ?? 0.95,
    currentTier: over.currentTier ?? 'starter',
    activeProjectCount: over.activeProjectCount,
  };
}

describe('painBasedUpsellSuggester / suggestUpsell', () => {
  it('no pain signals → no suggestions (NEVER upsell without evidence)', () => {
    expect(suggestUpsell(signals())).toEqual([]);
  });

  it('high manual reports → suggests automated_reports addon', () => {
    const out = suggestUpsell(signals({ manualReportsPerWeek: 12 }));
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((s) => s.addonOrTier === 'addon.automated_reports')).toBe(true);
    const addon = out.find((s) => s.addonOrTier === 'addon.automated_reports')!;
    expect(addon.painSignalsAddressed).toContain('high_manual_reports');
    expect(addon.painReductionEstimate).toBeGreaterThan(0);
  });

  it('frequent exceptions → suggests exception_workflows addon', () => {
    const out = suggestUpsell(signals({ exceptionsRaisedLast30d: 20 }));
    expect(out.some((s) => s.addonOrTier === 'addon.exception_workflows')).toBe(true);
  });

  it('low data confidence → suggests data_quality_pack addon', () => {
    const out = suggestUpsell(signals({ dataConfidenceScore: 0.4 }));
    expect(out.some((s) => s.addonOrTier === 'addon.data_quality_pack')).toBe(true);
  });

  it('multiple pains → orders by painReductionEstimate desc', () => {
    const out = suggestUpsell(
      signals({
        manualReportsPerWeek: 15,
        exceptionsRaisedLast30d: 20,
        dataConfidenceScore: 0.3,
        currentTier: 'starter',
        activeProjectCount: 8,
      }),
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].painReductionEstimate).toBeGreaterThanOrEqual(out[i].painReductionEstimate);
    }
    // Tier pro should be in the list since covers 3 pains.
    expect(out.some((s) => s.addonOrTier === 'tier.pro')).toBe(true);
  });

  it('does not suggest tier upgrade if already at that tier', () => {
    const out = suggestUpsell(
      signals({
        manualReportsPerWeek: 15,
        exceptionsRaisedLast30d: 20,
        dataConfidenceScore: 0.3,
        currentTier: 'enterprise',
        activeProjectCount: 50,
      }),
    );
    expect(out.every((s) => s.addonOrTier !== 'tier.enterprise')).toBe(true);
    expect(out.every((s) => s.addonOrTier !== 'tier.pro')).toBe(true);
  });

  it('rejects dataConfidenceScore outside [0,1]', () => {
    expect(() => suggestUpsell(signals({ dataConfidenceScore: -0.1 }))).toThrow();
    expect(() => suggestUpsell(signals({ dataConfidenceScore: 1.5 }))).toThrow();
  });
});
