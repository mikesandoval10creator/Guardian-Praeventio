import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCombinedBundle,
  buildJsonlBundle,
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

describe("DSAR bundle SHA-256 integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function digestFrom(body: string): string | undefined {
    return body.match(/^data_jsonl_sha256: ([a-f0-9]+)$/m)?.[1];
  }

  function jsonlFrom(body: string): string {
    return body
      .split("===== file: data.jsonl =====\n")[1]
      .split("\n\n===== file: data.csv =====")[0];
  }

  it.each([
    { name: "ASCII", exportedData: { profile: { name: "Own profile" } } },
    {
      name: "Unicode and multiple records",
      exportedData: {
        profile: {
          name: "Muñoz 中文 🛡️",
          text: "line one\nline two",
          mark: "e\u0301",
        },
        notifications: [{ message: "Alerta en minería" }],
      },
    },
    { name: "empty JSONL", exportedData: {} },
  ])(
    "hashes the exact emitted UTF-8 JSONL bytes ($name)",
    ({ exportedData }) => {
      const supplied = { ...input([]), exportedData };
      const before = JSON.stringify(supplied);
      const { body, contentType } = buildCombinedBundle(supplied);
      const jsonl = jsonlFrom(body);
      const expected = createHash("sha256").update(jsonl, "utf8").digest("hex");

      expect(jsonl).toBe(buildJsonlBundle(supplied));
      expect(digestFrom(body)).toMatch(/^[a-f0-9]{64}$/);
      expect(digestFrom(body)).toBe(expected);
      expect(contentType).toBe("text/plain; charset=utf-8");
      expect(JSON.stringify(supplied)).toBe(before);
    },
  );

  it("preserves partial-export metadata while hashing its actual payload", () => {
    const { body } = buildCombinedBundle(input(["notifications"]));
    expect(body).toContain("export_complete: false");
    expect(body).toContain("incomplete_categories:\n  - notifications");
    expect(digestFrom(body)).toBe(
      createHash("sha256").update(jsonlFrom(body), "utf8").digest("hex"),
    );
  });

  it.each([undefined, {}])(
    "uses real SHA-256 without WebCrypto (%j)",
    (crypto) => {
      vi.stubGlobal("crypto", crypto);
      const { body } = buildCombinedBundle(input([]));
      expect(digestFrom(body)).toBe(
        createHash("sha256").update(jsonlFrom(body), "utf8").digest("hex"),
      );
    },
  );

  it("does not launch an unused asynchronous WebCrypto digest", () => {
    const digest = vi.fn(() => {
      throw new Error("Unexpected WebCrypto digest call");
    });
    vi.stubGlobal("crypto", { subtle: { digest } });
    const { body } = buildCombinedBundle(input([]));
    expect(digestFrom(body)).toBe(
      createHash("sha256").update(jsonlFrom(body), "utf8").digest("hex"),
    );
    expect(digest).not.toHaveBeenCalled();
  });

  it("is deterministic and detects a change to the exported bytes", () => {
    const supplied = input([]);
    const original = buildCombinedBundle(supplied);
    const repeated = buildCombinedBundle(supplied);
    const changed = buildCombinedBundle({
      ...supplied,
      exportedData: { data: "altered" },
    });

    expect(repeated).toEqual(original);
    expect(digestFrom(changed.body)).not.toBe(digestFrom(original.body));
    expect(digestFrom(changed.body)).toBe(
      createHash("sha256")
        .update(jsonlFrom(changed.body), "utf8")
        .digest("hex"),
    );
  });
});
