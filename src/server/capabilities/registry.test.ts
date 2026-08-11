import { describe, expect, it } from "vitest";

import { buildCapabilityRegistry, type CapabilityCheck } from "./registry.js";

describe("buildCapabilityRegistry", () => {
  it("maps successful probes to healthy capabilities and preserves evidence", () => {
    const checks: Record<string, CapabilityCheck> = {
      gemini: { ok: true, latencyMs: 12 },
      photogrammetry: { ok: true, skipped: true, latencyMs: 1 },
    };

    const registry = buildCapabilityRegistry(checks);

    expect(registry).toContainEqual(
      expect.objectContaining({
        id: "ai.gemini",
        status: "healthy",
        evidence: { check: "gemini", latencyMs: 12 },
      }),
    );
    expect(registry).toContainEqual(
      expect.objectContaining({
        id: "ai.photogrammetry",
        status: "experimental",
        evidence: { check: "photogrammetry", latencyMs: 1, skipped: true },
      }),
    );
  });

  it("maps failed probes to degraded instead of claiming unavailable or healthy", () => {
    const registry = buildCapabilityRegistry({
      firestore: { ok: false, latencyMs: 2000, error: "timeout_2000ms" },
    });

    expect(registry).toContainEqual(
      expect.objectContaining({
        id: "platform.firestore",
        status: "degraded",
        evidence: { check: "firestore", latencyMs: 2000 },
      }),
    );
  });

  it("marks known capabilities unavailable when no probe exists", () => {
    const registry = buildCapabilityRegistry({});

    expect(registry).toContainEqual(
      expect.objectContaining({
        id: "integration.resend",
        status: "unavailable",
      }),
    );
  });
});
