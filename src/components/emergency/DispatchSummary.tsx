// Praeventio Guard — [P1][VIDA] Human-readable dispatch summary panel.
//
// Companion to <EmergencyAuthorityCallPanel>. The call panel renders
// the tel: links (131 / 132 / 133 for CL) — this component renders the
// TEXT the dispatcher reads aloud to the operator on the other end of
// the call. Lives below the call panel on the emergency screen so the
// human can read it in the 5-10 seconds before dialing.
//
// SAFETY: this component is HUMAN-OPERATOR ONLY. It NEVER auto-dials,
// NEVER sends SMS, NEVER auto-feeds the system. The only outbound
// affordances are:
//   - Copy to clipboard (manual)
//   - Open Google Maps link (manual)
//
// No "Enviar a SAMU" button. The human decides. (Spec: spec'd ticket
// 3a3aa66d-73fe-81bf-b54a-c3dd9fa267ad.)

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, MapPin, CheckCircle2 } from "lucide-react";

export interface DispatchSummaryProps {
  /** Pre-rendered summary text (output of formatDispatchSummary). */
  summary: string;
  /** Coordinates for the Maps link. */
  coords: { lat: number; lng: number };
  /** Optional: a list of medical fields the worker consented to share. */
  medicalFieldsIncluded?: string[];
  /** Optional: which area/region this dispatch is happening in. */
  regionCode?: string;
  /** Translated labels for the chrome (icon labels, etc.). */
  labels?: {
    copyToClipboard: string;
    copied: string;
    openInMaps: string;
    humanInTheLoop: string;
    medicalContext: string;
  };
}

export function DispatchSummary({
  summary,
  coords,
  medicalFieldsIncluded,
  regionCode,
  labels,
}: DispatchSummaryProps) {
  const { t } = useTranslation();
  const merged = labels ?? {
    copyToClipboard: t("dispatch.copyToClipboard", "Copiar al portapapeles"),
    copied: t("dispatch.copied", "Copiado"),
    openInMaps: t("dispatch.openInMaps", "Abrir en Google Maps"),
    humanInTheLoop: t(
      "dispatch.humanInTheLoop",
      "El despacho lo inicia una persona. NUNCA se auto-despacha.",
    ),
    medicalContext: t("dispatch.medicalContext", "Datos médicos consentidos"),
  };
  const [copied, setCopied] = useState(false);

  async function onCopy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_000);
      }
    } catch {
      // Clipboard may be blocked (e.g. non-secure context). The human
      // can still long-press the pre to copy.
    }
  }

  const mapsHref = `https://google.com/maps?q=${coords.lat},${coords.lng}`;

  return (
    <section
      data-testid="dispatch-summary"
      aria-label={merged.humanInTheLoop}
      className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-tight text-amber-600">
          {t("dispatch.title", "Resumen para despacho")}
          {regionCode ? ` · ${regionCode}` : ""}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCopy}
            data-testid="dispatch-summary-copy"
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20"
          >
            {copied ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {merged.copied}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {merged.copyToClipboard}
              </>
            )}
          </button>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="dispatch-summary-maps"
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {merged.openInMaps}
          </a>
        </div>
      </header>
      <pre
        data-testid="dispatch-summary-body"
        className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-sm font-mono whitespace-pre-wrap break-words text-primary-token"
      >
        {summary}
      </pre>
      {medicalFieldsIncluded && medicalFieldsIncluded.length > 0 && (
        <p
          data-testid="dispatch-summary-medical-context"
          className="text-xs text-secondary-token"
        >
          {merged.medicalContext}: {medicalFieldsIncluded.join(", ")}
        </p>
      )}
      <p
        data-testid="dispatch-summary-human-in-the-loop"
        className="text-xs text-secondary-token"
      >
        {merged.humanInTheLoop}
      </p>
    </section>
  );
}
