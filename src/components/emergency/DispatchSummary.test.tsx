// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DispatchSummary } from "./DispatchSummary.js";

const FAKE_SUMMARY = [
  "🚨 EMERGENCIA — Paquete de despacho",
  "",
  "Proyecto: Faena Minera Los Andes (id: prj-andes)",
  "Trabajador: Camila Soto Reyes (RUT 12.345.678-9)",
  "Ubicación: -33.4489, -70.6692 (CL)",
  "Detectado: 2026-08-14 11:30:00 (2 min 15 s)",
  "Tipo de evento: Posible caída (ManDown automático)",
  "",
  "— El despacho NUNCA se ejecuta automáticamente. Una persona debe llamar al servicio de urgencia correspondiente.",
].join("\n");

describe("DispatchSummary", () => {
  beforeEach(() => {
    // jsdom doesn't expose a clipboard by default; define a writable
    // stub so onCopy resolves and the "copied" state flips.
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  it("renders the pre-formatted summary text verbatim", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
        regionCode="CL"
      />,
    );
    const body = screen.getByTestId("dispatch-summary-body");
    expect(body.textContent).toBe(FAKE_SUMMARY);
  });

  it("includes the region code in the header", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
        regionCode="CL"
      />,
    );
    expect(screen.getByRole("heading", { level: 3 }).textContent).toContain(
      "CL",
    );
  });

  it("renders the copy + maps actions", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
      />,
    );
    expect(screen.getByTestId("dispatch-summary-copy")).toBeInTheDocument();
    const mapsLink = screen.getByTestId("dispatch-summary-maps");
    expect(mapsLink.getAttribute("href")).toBe(
      "https://google.com/maps?q=-33.4489,-70.6692",
    );
    expect(mapsLink.getAttribute("target")).toBe("_blank");
    expect(mapsLink.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("calls navigator.clipboard.writeText on copy and shows the 'Copiado' confirmation", async () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
      />,
    );
    fireEvent.click(screen.getByTestId("dispatch-summary-copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FAKE_SUMMARY);
    // After the (synchronous) state update the button label switches.
    expect(await screen.findByText(/Copiado/)).toBeInTheDocument();
  });

  it("renders the human-in-the-loop footer (the spec's non-negotiable guardrail)", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
      />,
    );
    const footer = screen.getByTestId("dispatch-summary-human-in-the-loop");
    expect(footer.textContent).toMatch(/NUNCA se auto-despacha/);
  });

  it("renders the medical-context line when medicalFieldsIncluded is non-empty", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
        medicalFieldsIncluded={["bloodType", "allergies"]}
      />,
    );
    const medical = screen.getByTestId("dispatch-summary-medical-context");
    expect(medical.textContent).toContain("bloodType");
    expect(medical.textContent).toContain("allergies");
  });

  it("omits the medical-context line when medicalFieldsIncluded is empty", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
        medicalFieldsIncluded={[]}
      />,
    );
    expect(
      screen.queryByTestId("dispatch-summary-medical-context"),
    ).not.toBeInTheDocument();
  });

  it("exposes a section-level aria-label so screen readers announce the human-in-the-loop guardrail", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
      />,
    );
    const section = screen.getByTestId("dispatch-summary");
    expect(section.getAttribute("aria-label")).toMatch(
      /NUNCA se auto-despacha/,
    );
  });

  it("does not render any auto-dial button (spec's non-negotiable)", () => {
    render(
      <DispatchSummary
        summary={FAKE_SUMMARY}
        coords={{ lat: -33.4489, lng: -70.6692 }}
      />,
    );
    // Affordances present:
    expect(screen.getByTestId("dispatch-summary-copy")).toBeInTheDocument();
    expect(screen.getByTestId("dispatch-summary-maps")).toBeInTheDocument();
    // FORBIDDEN affordances absent:
    expect(screen.queryByText(/auto.?dial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/send.?sms/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enviar.{0,3}a.{0,3}SAMU/i),
    ).not.toBeInTheDocument();
  });
});
