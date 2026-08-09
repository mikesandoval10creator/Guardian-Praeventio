import { describe, expect, it } from "vitest";
import {
  suggestUpsell,
  type UsagePainSignals,
} from "./painBasedUpsellSuggester.js";

function signals(overrides: Partial<UsagePainSignals> = {}): UsagePainSignals {
  return {
    manualReportsPerWeek: 0,
    exceptionsRaisedLast30d: 0,
    dataConfidenceScore: 0.9,
    currentTier: "cobre",
    ...overrides,
  };
}

describe("painBasedUpsellSuggester / suggestUpsell", () => {
  it("never suggests an upsell without evidence of pain", () => {
    expect(suggestUpsell(signals())).toEqual([]);
  });

  it("suggests the immediate next canonical metallic tier", () => {
    const out = suggestUpsell(
      signals({ currentTier: "cobre", activeProjectCount: 4 }),
    );

    expect(out.some(({ addonOrTier }) => addonOrTier === "tier.plata")).toBe(
      true,
    );
    expect(out.every(({ addonOrTier }) => addonOrTier !== "tier.pro")).toBe(
      true,
    );
  });

  it("keeps evidence-matched addon suggestions", () => {
    const reportSuggestions = suggestUpsell(
      signals({ manualReportsPerWeek: 10 }),
    );
    const exceptionSuggestions = suggestUpsell(
      signals({ exceptionsRaisedLast30d: 10 }),
    );
    const qualitySuggestions = suggestUpsell(
      signals({ dataConfidenceScore: 0.4 }),
    );

    expect(
      reportSuggestions.some(
        ({ addonOrTier }) => addonOrTier === "addon.automated_reports",
      ),
    ).toBe(true);
    expect(
      exceptionSuggestions.some(
        ({ addonOrTier }) => addonOrTier === "addon.exception_workflows",
      ),
    ).toBe(true);
    expect(
      qualitySuggestions.some(
        ({ addonOrTier }) => addonOrTier === "addon.data_quality_pack",
      ),
    ).toBe(true);
    expect(reportSuggestions.every(({ kind }) => kind === "addon")).toBe(true);
  });

  it("derives scale pain from the current canonical project capacity", () => {
    expect(
      suggestUpsell(signals({ currentTier: "cobre", activeProjectCount: 3 })),
    ).toEqual([]);

    const overCapacity = suggestUpsell(
      signals({ currentTier: "cobre", activeProjectCount: 4 }),
    );
    expect(overCapacity.map(({ addonOrTier }) => addonOrTier)).toContain(
      "tier.plata",
    );
    expect(overCapacity[0].painSignalsAddressed).toContain(
      "scale_outgrew_tier",
    );
  });

  it("does not invent a tier above Diamante", () => {
    expect(
      suggestUpsell(
        signals({ currentTier: "diamante", activeProjectCount: 51 }),
      ),
    ).toEqual([]);
  });

  it("orders multiple suggestions by estimated pain reduction", () => {
    const out = suggestUpsell(
      signals({
        manualReportsPerWeek: 20,
        exceptionsRaisedLast30d: 20,
        dataConfidenceScore: 0.2,
      }),
    );

    for (let index = 1; index < out.length; index += 1) {
      expect(out[index - 1].painReductionEstimate).toBeGreaterThanOrEqual(
        out[index].painReductionEstimate,
      );
    }
  });

  it("rejects dataConfidenceScore outside [0, 1]", () => {
    expect(() => suggestUpsell(signals({ dataConfidenceScore: 1.1 }))).toThrow(
      /within \[0, 1\]/,
    );
  });
});
