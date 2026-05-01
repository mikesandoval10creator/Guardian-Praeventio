// Praeventio Guard — SII (Servicio de Impuestos Internos) DTE types
//
// These types describe Chilean Documento Tributario Electrónico (DTE) per
// SII norma técnica vigente (Resolución Exenta SII 80/2014 + actualizaciones).
//
// SCAFFOLDING ONLY — no PSE SDK is wired up yet. See SII_INTEGRATION.md for
// the runbook describing how Round 2 will pick OpenFactura / SimpleAPI /
// Bsale / LibreDTE and replace the stub adapters.
//
// Money rule (mirrors `src/services/billing/types.ts` and `pricing/tiers.ts`
// `withIVA`): all CLP amounts are WHOLE pesos, no decimals — the DTE schema
// rejects fractional pesos. IVA rounding follows the same
// `Math.ceil(net * 0.19)` rule used across the codebase.

/**
 * SII DTE document types we care about.
 *
 * Codes are SII-mandated integers — do not invent new values; the SII
 * rejects unknown DTE type codes at folio assignment time.
 *
 * - `33` Factura electrónica (afecta IVA, B2B con RUT receptor)
 * - `39` Boleta electrónica (consumidor final, afecta IVA)
 * - `41` Boleta exenta de IVA (servicios exentos)
 * - `56` Nota de débito electrónica
 * - `61` Nota de crédito electrónica
 *
 * Other codes exist in the SII spec (34, 43, 46, 52, 110…) but are out of
 * scope for Praeventio's billing flows. Add them here if/when needed.
 */
export type DteType = 33 | 39 | 41 | 56 | 61;

/**
 * DTE header (encabezado).
 *
 * - `emisorRut` is locked as a literal type to the Praeventio Guard RUT.
 *   Mirrors `src/services/billing/types.ts:PRAEVENTIO_EMISOR_RUT`. A wrong
 *   value will fail to compile.
 * - `receptorRut` follows the Chilean RUT format `NN.NNN.NNN-X` or
 *   `NNNNNNNN-X` (X = digit verificador, may be 'K'). The PSE will
 *   normalize it; we keep the string here so the audit log preserves the
 *   exact format the customer entered.
 * - `folioCaf` is assigned by the PSE from the CAF (Código Autorización
 *   Folios) issued by SII. Optional pre-emission, present post-emission.
 */
export interface DteHeader {
  type: DteType;
  /** Praeventio Guard SpA RUT — locked as a literal type. */
  emisorRut: '78231119-0';
  emisorRazonSocial: string;
  /** SII "giro": "Servicios de prevención de riesgos laborales" or similar. */
  emisorGiro: string;
  /** Chilean RUT of the receiver. Format: `NN.NNN.NNN-X` or `NNNNNNNN-X`. */
  receptorRut: string;
  receptorRazonSocial: string;
  /** Issuance date in YYYY-MM-DD (Chile timezone). DTE schema rejects time. */
  fechaEmision: string;
  /** Folio assigned from a CAF range. Optional pre-emission. */
  folioCaf?: number;
}

/**
 * Single line on a DTE.
 *
 * - `unitPrice` MUST be whole CLP — fractional pesos break SII validation.
 * - `exemptFromIva` flips the line into the "monto exento" column. Used for
 *   tier 41 (boleta exenta) or mixed factura with exempt extras.
 */
export interface DteLineItem {
  description: string;
  quantity: number;
  /** CLP whole pesos. No decimals. */
  unitPrice: number;
  exemptFromIva?: boolean;
}

/**
 * DTE totals block.
 *
 * `iva` is computed via the project-wide rule
 * `iva = Math.ceil(netAmount * 0.19)` so the customer-visible total matches
 * the canonical retail figure (e.g. 10075 + 1915 = 11990, not 11989). See
 * `src/services/pricing/tiers.ts:withIVA` for the original definition.
 */
export interface DteTotals {
  /** Sum of (qty × unitPrice) across non-exempt lines. */
  netAmount: number;
  /** Sum of (qty × unitPrice) across exempt lines. */
  exemptAmount: number;
  /** 0.19 for Chile (subject to legislative change). */
  ivaRate: number;
  /** Rounded IVA on `netAmount`. */
  iva: number;
  /** `netAmount + iva + exemptAmount`. */
  total: number;
}

export interface DtePaymentInfo {
  method: 'webpay' | 'transfer' | 'cash';
  /**
   * Free-form payment reference. For Webpay this is the `buyOrder`
   * (= invoice id), so the SII folio can be reconciled back to the
   * payment in `invoices/{id}` and the `processed_webpay/{token}` doc.
   */
  reference?: string;
}

export interface DteRequest {
  header: DteHeader;
  lineItems: DteLineItem[];
  paymentInfo?: DtePaymentInfo;
}

export interface DteResponse {
  /** Folio number assigned by the PSE from a SII-authorized CAF range. */
  folio: number;
  /** PSE / SII tracking id, used for status polling. */
  trackId: string;
  /** Hosted PDF URL (PSE-served). Optional pre-acceptance. */
  pdfUrl?: string;
  /** Signed XML for archival. Optional in the response; required for retention. */
  xml?: string;
  status: 'accepted' | 'rejected' | 'pending';
  /** Human-readable rejection reason from SII when `status === 'rejected'`. */
  rejectionReason?: string;
  /** ISO 8601 emission timestamp (PSE clock). */
  emittedAt: string;
}

/**
 * Adapter contract every PSE implementation must satisfy. Concrete adapters
 * (OpenFactura / SimpleAPI / Bsale / LibreDTE) live alongside this file and
 * are selected at runtime by `getSiiAdapter()` based on `SII_PSE`.
 *
 * CAF (Código Autorización Folios) management is intentionally NOT on this
 * interface — each PSE handles CAF upload / range tracking differently
 * (some via API, some via portal upload). Defer those methods to specific
 * implementations.
 */
export interface SiiAdapter {
  readonly name:
    | 'openfactura'
    | 'simpleapi'
    | 'bsale'
    | 'libredte'
    | 'noop';
  /**
   * `true` once the adapter has the credentials it needs to make real calls.
   * Stub adapters check for the relevant env var (e.g. `OPENFACTURA_API_KEY`)
   * but do not validate it; that happens at first call.
   */
  readonly isAvailable: boolean;
  emitDte(request: DteRequest): Promise<DteResponse>;
  getDteStatus(trackId: string): Promise<DteResponse>;
}

/** Praeventio Guard issuer RUT — re-exported here so SII modules don't need to reach into billing/. */
export const PRAEVENTIO_EMISOR_RUT_DTE = '78231119-0' as const;

/** Default razón social for DTEs. Override via `BILLING_EMISOR_RAZON_SOCIAL`. */
export const PRAEVENTIO_EMISOR_RAZON_SOCIAL_DTE_DEFAULT =
  'Praeventio Guard SpA';

/** Default giro (SII activity description). Override via `SII_EMISOR_GIRO`. */
export const PRAEVENTIO_EMISOR_GIRO_DEFAULT =
  'Servicios de prevención de riesgos laborales';

/**
 * Chilean IVA rate. Lives here as a constant so a future SII rate change
 * (or the IVA-reduction proposals that surface every few years) can be
 * flipped in one place.
 */
export const CHILE_IVA_RATE = 0.19;
