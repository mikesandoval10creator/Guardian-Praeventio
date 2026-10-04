import { describe, expect, it } from "vitest";
import {
  buildCombinedBundle,
  buildManifest,
  type BundleExportInput,
} from "./bundleExport.js";

function input(incomplete: readonly string[]): BundleExportInput {
  return {
    uid: "subject-fixture",
    requestId: "request-fixture",
    exportedData: {
      data: { users: [{ uid: "subject-fixture", name: "Perfil propio" }] },
    },
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    applicableRegimes: ["GDPR-EU"],
    incomplete,
  };
}

describe("DSAR bundle completeness metadata", () => {
  it("marks all configured reads successful only with an explicit empty failure list", () => {
    const manifest = buildManifest(input([]), "fixture-integrity-value");
    expect(manifest).toContain("export_complete: true");
    expect(manifest).toContain("incomplete_categories: []");
    expect(manifest).not.toContain("export_complete: false");
  });

  it.each([{ incomplete: [] }, { incomplete: ["notifications"] }])(
    "preserves the JSONL and CSV sections without mutating input ($incomplete)",
    ({ incomplete }) => {
      const supplied = input(Object.freeze(incomplete));
      const before = JSON.stringify(supplied);
      const { body, contentType } = buildCombinedBundle(supplied);
      expect(contentType).toBe("text/plain; charset=utf-8");
      const jsonl = body
        .split("===== file: data.jsonl =====")[1]
        .split("===== file: data.csv =====")[0]
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(jsonl).toEqual([
        {
          recordType: "data",
          uid: supplied.uid,
          requestId: supplied.requestId,
          generatedAt: supplied.generatedAt.toISOString(),
          value: supplied.exportedData.data,
        },
      ]);
      const csv = body.split("===== file: data.csv =====")[1].trim();
      expect(csv).toContain(
        "recordType,uid,requestId,generatedAt,serializedValue",
      );
      expect(csv).toContain(supplied.uid);
      expect(JSON.stringify(supplied)).toBe(before);
    },
  );

  it("marks a partial manifest and identifies its failed categories", () => {
    const manifest = buildManifest(
      input(["curriculum_claims", "notifications"]),
      "fixture-integrity-value",
    );

    expect(manifest).toContain("export_complete: false");
    expect(manifest).toContain(
      "incomplete_categories:\n  - curriculum_claims\n  - notifications",
    );
    expect(manifest).not.toContain("export_complete: true");
  });

  it.each([undefined, null, "", {}, false])(
    "does not declare an export complete when failure metadata is unknown (%j)",
    (incomplete) => {
      const unknownMetadata = {
        ...input([]),
        incomplete,
      } as unknown as BundleExportInput;
      expect(() =>
        buildManifest(unknownMetadata, "fixture-integrity-value"),
      ).toThrow("Export completeness metadata is required.");
    },
  );
});
