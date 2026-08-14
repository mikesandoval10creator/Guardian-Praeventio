import { describe, expect, it } from "vitest";
import {
  formatDispatchSummary,
  formatElapsed,
  inferDispatchAuditFields,
  type DispatchSummaryInput,
} from "./dispatchSummary.js";

const baseInput: DispatchSummaryInput = {
  projectId: "prj-andes",
  projectName: "Faena Minera Los Andes",
  workerUid: "w-001",
  workerFullName: "Camila Soto Reyes",
  workerRut: "12.345.678-9",
  detectedAt: new Date("2026-08-14T14:30:00Z"),
  eventType: "manDown",
  workerCoords: { lat: -33.4489, lng: -70.6692 },
  regionCode: "CL",
};

describe("formatDispatchSummary", () => {
  it("renders the title, project, worker, location, event type, and human-in-the-loop footer", () => {
    const out = formatDispatchSummary(
      baseInput,
      undefined,
      new Date("2026-08-14T14:32:15Z"),
    );
    expect(out).toContain("🚨 EMERGENCIA — Paquete de despacho");
    expect(out).toContain("Proyecto: Faena Minera Los Andes (id: prj-andes)");
    expect(out).toContain("Trabajador: Camila Soto Reyes (RUT 12.345.678-9)");
    expect(out).toContain("Ubicación: -33.4489, -70.6692 (CL)");
    expect(out).toContain("Tipo de evento: Posible caída (ManDown automático)");
    expect(out).toContain("El despacho NUNCA se ejecuta automáticamente");
  });

  it("redacts coordinates to 4 decimal places (block, not survey-grade)", () => {
    const out = formatDispatchSummary(
      {
        ...baseInput,
        workerCoords: { lat: -33.456789123, lng: -70.671234567 },
      },
      undefined,
      new Date("2026-08-14T14:30:00Z"),
    );
    expect(out).toContain("-33.4568, -70.6712");
    expect(out).not.toContain("-33.456789123");
  });

  it("omits the medical block entirely when no medical data is provided", () => {
    const out = formatDispatchSummary(baseInput);
    expect(out).not.toContain("Datos médicos");
    expect(out).not.toContain("Grupo sanguíneo");
    expect(out).not.toContain("Alérgenos");
  });

  it("includes only the medical fields the worker actually consented to", () => {
    const out = formatDispatchSummary({
      ...baseInput,
      medical: {
        bloodType: "O+",
        allergies: "penicilina",
        // medications, conditions, emergencyContact all absent
      },
    });
    expect(out).toContain("Datos médicos (consentidos)");
    expect(out).toContain("Grupo sanguíneo: O+");
    expect(out).toContain("Alérgenos: penicilina");
    expect(out).not.toContain("Medicamentos");
    expect(out).not.toContain("Condiciones preexistentes");
    expect(out).not.toContain("Contacto de emergencia");
  });

  it("always includes the human-in-the-loop footer, even without medical data", () => {
    const out = formatDispatchSummary(baseInput);
    expect(out).toContain("El despacho NUNCA se ejecuta automáticamente");
    expect(out).toContain("Una persona debe llamar");
  });

  it("formats elapsed time as 'hace X s' / 'X min Y s' / 'X h Y min'", () => {
    const input = {
      ...baseInput,
      detectedAt: new Date("2026-08-14T14:00:00Z"),
    };
    expect(
      formatDispatchSummary(input, undefined, new Date("2026-08-14T14:00:30Z")),
    ).toContain("30 s");
    expect(
      formatDispatchSummary(input, undefined, new Date("2026-08-14T14:02:15Z")),
    ).toContain("2 min 15 s");
    expect(
      formatDispatchSummary(input, undefined, new Date("2026-08-14T17:05:00Z")),
    ).toContain("3 h 5 min");
  });

  it("renders SOS event type with the appropriate label", () => {
    const out = formatDispatchSummary({ ...baseInput, eventType: "sos" });
    expect(out).toContain("Tipo de evento: SOS activado por el trabajador");
  });

  it("renders evacuation event type", () => {
    const out = formatDispatchSummary({
      ...baseInput,
      eventType: "evacuation",
    });
    expect(out).toContain("Tipo de evento: Evacuación en curso");
  });
});

describe("formatElapsed", () => {
  it("returns '0 s' for sub-second deltas", () => {
    expect(
      formatElapsed(
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-01-01T00:00:00.500Z"),
      ),
    ).toBe("0 s");
  });
  it("clamps negative deltas to 0 s (never reports a future time)", () => {
    expect(
      formatElapsed(
        new Date("2026-01-01T00:00:01Z"),
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe("0 s");
  });
  it("handles hour-scale deltas", () => {
    expect(
      formatElapsed(
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-01-01T05:30:00Z"),
      ),
    ).toBe("5 h 30 min");
  });
});

describe("inferDispatchAuditFields", () => {
  it("lists exactly the medical fields that were present in the input", () => {
    const out = inferDispatchAuditFields(
      {
        ...baseInput,
        medical: { bloodType: "A+", allergies: "nueces" },
      },
      "summary text",
    );
    expect(out.includedMedicalFields).toEqual(["bloodType", "allergies"]);
  });

  it("reports summaryLength without leaking PII", () => {
    const summary =
      "🚨 ... 14 line summary with names + RUT + GPS + medical terse";
    const out = inferDispatchAuditFields(baseInput, summary);
    expect(out.summaryLength).toBe(summary.length);
    expect(out).not.toHaveProperty("summary");
  });

  it("does not include the summary text in the audit fields", () => {
    const out = inferDispatchAuditFields(baseInput, "the actual summary text");
    expect(out).not.toHaveProperty("summary");
    expect(out).not.toHaveProperty("summaryText");
  });
});
