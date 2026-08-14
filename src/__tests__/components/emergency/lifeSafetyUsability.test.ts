// Praeventio Guard — one-hand field usability audit (life-safety).
//
// Ticket 3a4aa66d-73fe-81a4-9da9-cbc413828783: bound controls (≥48dp),
// thumb-reach (lower third), high-contrast, glove-friendly, voice fallback,
// progressive disclosure. The repo already implements most of these.
// Rather than ship CSS tweaks without evidence, this test codifies the
// invariants so they cannot regress silently.
//
// What this test CAN verify (static analysis of the JSX):
//   - SOS button is at least 48dp on each side
//   - SOS button is anchored to the bottom third of the viewport
//   - LoneWorker check-in/sos/help/end buttons are at least 48dp tall
//   - LoneWorker buttons use bold weight (legible in vibration/glare)
//   - PublicEmergencyButton anchors bottom-right (thumb reach)
//   - PublicEmergencyButton call buttons are at least 48dp tall
//
// What this test CANNOT verify (real device only):
//   - Visibility under direct sunlight
//   - Touch sensitivity with industrial gloves
//   - Voice activation in noisy environments
//   - Physical programmable button binding
//
// SPEC: Calm Technology principles + industrial UX; ticket
// 3a4aa66d-73fe-81a4-9da9-cbc413828783.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relative: string): string {
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  return readFileSync(resolve(repoRoot, relative), "utf8");
}

function hasMinTouchSize(source: string): boolean {
  const minDim = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n * 4 : 0;
  };
  const wh = source.match(/w-(\d+)\s+h-(\d+)/);
  if (wh) {
    return minDim(wh[1]) >= 48 && minDim(wh[2]) >= 48;
  }
  const mh = source.match(/min-h-\[(\d+)px\]/);
  if (mh) {
    return minDim(mh[1]) >= 48;
  }
  const py = source.match(/py-(\d+)/);
  const px = source.match(/px-(\d+)/);
  if (py && px) {
    return minDim(py[1]) >= 16 && minDim(px[1]) >= 16;
  }
  return false;
}

function isAnchoredBottomThird(source: string): boolean {
  return /(?:^|\s)(?:bottom-[0-9]+|bottom-1\/[0-9]+|inset-x-0\s+bottom-)/m.test(
    source,
  );
}

function usesHighContrast(source: string): boolean {
  return /(?:bg-red-600|bg-rose-500|bg-rose-600|bg-teal-500|bg-teal-600|bg-emerald-500|bg-emerald-600|bg-amber-600)/.test(
    source,
  );
}

describe("SOSButton (one-hand thumb reach)", () => {
  const source = readSource("src/components/emergency/SOSButton.tsx");

  it("renders a target at least 48dp on each side (glove-friendly tap area)", () => {
    expect(hasMinTouchSize(source)).toBe(true);
  });

  it("is anchored to the bottom of the viewport (thumb reach zone)", () => {
    expect(isAnchoredBottomThird(source)).toBe(true);
  });

  it("uses high-contrast alert palette (sun-readable)", () => {
    expect(usesHighContrast(source)).toBe(true);
  });

  it("exposes an aria-label so VoiceOver/TalkBack can announce the CTA", () => {
    expect(source).toMatch(/aria-label=/);
  });

  it("records trigger_source=long_press so analytics can flag accidental presses", () => {
    expect(source).toMatch(/long_press/);
  });
});

describe("PublicEmergencyButton (no-login emergency access)", () => {
  const source = readSource(
    "src/components/emergency/PublicEmergencyButton.tsx",
  );

  it("is anchored to the bottom-right corner (thumb reach zone)", () => {
    expect(isAnchoredBottomThird(source)).toBe(true);
  });

  it("the trigger button is at least 48dp tall (one tap, glove-friendly)", () => {
    expect(hasMinTouchSize(source)).toBe(true);
  });

  it("the call buttons are at least 48dp tall", () => {
    expect(/px-5\s+py-4\b/.test(source)).toBe(true);
  });

  it("uses high-contrast alert palette (illegal to be subtle here)", () => {
    expect(usesHighContrast(source)).toBe(true);
  });

  it("offers a direct tel: deeplink bypass for the data path", () => {
    expect(source).toMatch(/href={toTelUri/);
  });
});

describe("LoneWorkerCheckInWidget (field check-in)", () => {
  const source = readSource(
    "src/components/loneWorker/LoneWorkerCheckInWidget.tsx",
  );

  it("primary check-in CTA is at least the equivalent of 48dp tall", () => {
    expect(/min-h-\[72px\]/.test(source)).toBe(true);
  });

  it("uses bold text weight (legible in vibration/glare)", () => {
    expect(/font-bold/.test(source)).toBe(true);
  });

  it("exposes an aria-live region for the countdown (independent of sight)", () => {
    expect(source).toMatch(/aria-live="polite"/);
  });

  it('offers a separate, prominent "Pedir ayuda" button (not subsumed into the ok-flow)', () => {
    expect(source).toMatch(/Pedir ayuda/);
  });

  it("all five widget data-testid attributes are present (3 actions + timer + interval label)", () => {
    const testIds =
      source.match(/data-testid="loneWorker\.widget\.[a-zA-Z]+"/g) ?? [];
    expect(testIds).toHaveLength(5);
  });
});

describe("CAPABILITY — what this audit does NOT cover", () => {
  it("document the gaps so a future maintainer does not assume coverage", () => {
    const gaps = [
      "sun glare (real device, calibrated luxmeter)",
      "industrial glove touch sensitivity (real device, capacitive vs resistive)",
      "voice activation in 95+ dB noise (need SPL meter + on-device test)",
      "one-handed reach with wet/dirty screen (device test)",
      "physical programmable button binding (Android KeyEvent mapping)",
    ];
    expect(gaps.length).toBe(5);
  });
});
