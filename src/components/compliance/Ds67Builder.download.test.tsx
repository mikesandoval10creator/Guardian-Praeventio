// @vitest-environment jsdom

import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jsPDF } from "jspdf";
import { Ds67Builder } from "./Ds67Builder";

vi.mock("../../services/firebase", () => ({ auth: null }));
vi.mock("../../lib/apiAuth", () => ({
  apiAuthHeader: vi.fn(async () => "Bearer test-only-auth"),
}));
// The download path does not invoke the signing service.
vi.mock("../../services/compliance/ds67/ds67Service", () => ({
  ds67FolioToDocId: vi.fn((folio: string) => folio),
}));

const FOLIO = "DS67-2026-TEST-001";
const REPORTED_BY = {
  uid: "worker-test-1",
  rut: "11.111.111-1",
  fullName: "Trabajador de prueba",
};
const DOWNLOAD_ERROR =
  "No pudimos descargar el PDF. Inténtalo nuevamente; si el problema continúa, genera un nuevo reglamento.";
const NativeURL = URL;
let pdfBytes: Uint8Array;
let pdfBase64: string;
let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeAll(() => {
  const pdf = new jsPDF();
  pdf.text("Download test", 10, 10);
  pdfBytes = new Uint8Array(pdf.output("arraybuffer"));
  pdfBase64 = Buffer.from(pdfBytes).toString("base64");
});

beforeEach(() => {
  createObjectURL = vi.fn(() => "blob:ds67-test");
  revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function showGeneratedResult(pdfBase64: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      form: { folio: FOLIO },
      pdfBase64,
      payloadHashHex: "test-payload-hash-not-a-pdf-integrity-proof",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Ds67Builder tenantId="tenant-test-1" reportedBy={REPORTED_BY} />);
  for (const [label, value] of [
    ["Razón social", "Empresa de prueba"],
    ["RUT empresa", "11.111.111-1"],
    ["Domicilio", "Av. de prueba 1"],
    ["Ámbito de aplicación", "Instalación de prueba"],
    ["Sanciones", "Sanciones del reglamento de prueba"],
    ["Procedimiento de reclamo", "Reclamo del reglamento de prueba"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const form = screen
    .getByRole("button", { name: "Generar PDF" })
    .closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
  const downloadButton = await screen.findByRole("button", {
    name: "Descargar PDF",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByText(FOLIO)).toBeInTheDocument();
  return downloadButton;
}

describe("Ds67Builder PDF download", () => {
  it.each([
    ["empty", ""],
    ["whitespace-only", "\n\t "],
    ["malformed base64", "@#$"],
    ["missing", undefined],
    ["null", null],
    ["numeric", 123],
    ["array", []],
    ["object", {}],
  ])(
    "rejects %s PDF data without dispatching a download",
    async (_kind, value) => {
      const button = await showGeneratedResult(value);
      fireEvent.click(button);

      expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      expect(screen.getByText(FOLIO)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Nuevo reglamento" }),
      ).toBeEnabled();
    },
  );

  it("preserves PDF bytes, MIME type and the folio filename", async () => {
    const button = await showGeneratedResult(pdfBase64);
    fireEvent.click(button);
    const clickedAnchor = vi.mocked(HTMLAnchorElement.prototype.click).mock
      .contexts[0] as HTMLAnchorElement;

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(pdfBytes.length);
    const actualBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(actualBytes)).toEqual(pdfBytes);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(clickedAnchor?.download).toBe(`${FOLIO}.pdf`);
    expect(clickedAnchor?.getAttribute("href")).toBe("blob:ds67-test");
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ds67-test");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(screen.queryByText(DOWNLOAD_ERROR)).not.toBeInTheDocument();
  });

  it("releases the URL and temporary anchor when the click fails", async () => {
    const button = await showGeneratedResult(pdfBase64);
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error("browser internals must not reach the user");
    });
    fireEvent.click(button);

    expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ds67-test");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(
      screen.queryByText("browser internals must not reach the user"),
    ).toBeNull();
  });

  it("reports URL creation failure without attempting a download", async () => {
    const button = await showGeneratedResult(pdfBase64);
    createObjectURL.mockImplementationOnce(() => {
      throw new Error("object URL unavailable");
    });
    fireEvent.click(button);

    expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("releases the URL when anchor creation fails", async () => {
    const button = await showGeneratedResult(pdfBase64);
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName, options) => {
        if (tagName === "a") throw new Error("anchor unavailable");
        return createElement(tagName, options);
      },
    );
    fireEvent.click(button);

    expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ds67-test");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("releases the URL when appending the anchor fails", async () => {
    const button = await showGeneratedResult(pdfBase64);
    vi.spyOn(document.body, "appendChild").mockImplementationOnce(() => {
      throw new Error("document unavailable");
    });
    fireEvent.click(button);

    expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ds67-test");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("clears a failed attempt on retry without changing the generated folio", async () => {
    const button = await showGeneratedResult(pdfBase64);
    createObjectURL
      .mockReturnValueOnce("blob:ds67-failed")
      .mockReturnValueOnce("blob:ds67-retry");
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error("transient browser failure");
    });
    fireEvent.click(button);
    expect(screen.getByText(DOWNLOAD_ERROR)).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByText(DOWNLOAD_ERROR)).not.toBeInTheDocument();
    expect(screen.getByText(FOLIO)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL.mock.calls).toEqual([
      ["blob:ds67-failed"],
      ["blob:ds67-retry"],
    ]);
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
