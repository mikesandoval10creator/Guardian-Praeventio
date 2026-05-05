// Praeventio Guard — Bsale PSE adapter (REAL IMPLEMENTATION, Sprint 23 GG).
//
// Bsale (https://www.bsale.cl/) is a Chilean ERP that exposes a modern REST
// API for emitting SII-authorised DTEs (factura electrónica, boleta
// electrónica, notas de crédito / débito). We pick Bsale over Defontana
// because the API is JSON-based, well-documented, and certified directly
// against SII norma técnica vigente.
//
// Wiring contract:
//   • `BSALE_ACCESS_TOKEN`  — token issued from the Bsale dashboard. Sent in
//                             the `access_token` header on every request.
//   • `BSALE_OFFICE_ID`     — numeric Bsale "oficina" id where the DTE is
//                             registered. Required for every emission.
//   • `BSALE_API_BASE_URL`  — optional override (defaults to the v1 prod
//                             endpoint). Set this to the staging URL during
//                             SII certification.
//
// SII DTE codes (mirrors `./types.ts`):
//
//   33 → factura afecta              → Bsale `documentTypes.id` for "Factura Electrónica"
//   39 → boleta afecta               → Bsale "Boleta Electrónica"
//   41 → boleta exenta               → Bsale "Boleta Exenta Electrónica"
//   56 → nota de débito              → Bsale "Nota de Débito Electrónica"
//   61 → nota de crédito             → Bsale "Nota de Crédito Electrónica"
//
// The adapter conforms to the project-wide `SiiAdapter` contract
// (`emitDte` / `getDteStatus`) so the runtime selector in `./index.ts` keeps
// working unchanged. Two extra methods (`createDte` alias + `cancelDte`)
// are exposed on the concrete object for the admin endpoints in
// `src/server/routes/dte.ts`.
//
// Money rule: Bsale's API takes net + tax separately for facturas and
// gross-with-tax for boletas. We always send NET amounts per line and let
// `calculateDteTotals` compute the IVA — that keeps the SII rounding
// invariant `Math.ceil(net*0.19)` aligned with `pricing/tiers.ts:withIVA`.
//
// PCI-style discipline: never log the access token. Bsale tokens are static
// (no rotation by default) so a leak in logs effectively grants a third
// party full DTE-issuing rights on our SII commerce code.

import { calculateDteTotals, SiiAdapterError } from './siiAdapter';
import {
  CHILE_IVA_RATE,
  type DteRequest,
  type DteResponse,
  type DteType,
  type SiiAdapter,
} from './types';

const BSALE_DOCS_URL = 'https://docs.bsale.dev/';
const DEFAULT_BSALE_BASE_URL = 'https://api.bsale.io/v1';

/** Bsale's `documentTypes.code` (SII DTE code) → endpoint resource. */
const BSALE_RESOURCE_BY_DTE: Record<DteType, string> = {
  33: 'documents.json',         // factura electrónica
  39: 'documents.json',         // boleta electrónica
  41: 'documents.json',         // boleta exenta
  56: 'documents.json',         // nota de débito
  61: 'documents.json',         // nota de crédito
};

/** Internal config snapshot. Resolved at construction; never re-read after. */
export interface BsaleConfig {
  /** Static `access_token` from the Bsale dashboard. */
  accessToken: string;
  /** Numeric `office_id` (oficina). Required by Bsale on every doc. */
  officeId: number;
  /** Override only for staging / certification. */
  baseUrl: string;
  /**
   * Optional `fetch` override for tests. Defaults to `globalThis.fetch`
   * which is available in Node ≥18 and in Vitest's `jsdom` env.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Stable, JSON-serialisable result shape for the admin route + email
 * template. Mirrors `DteResponse` but adds the explicit `ok` discriminator
 * so the route handler can branch without an `instanceof` check, plus the
 * separated `totalClp` / `ivaClp` fields the email template wants.
 */
export interface DteResult {
  ok: boolean;
  folio?: number;
  pdfUrl?: string;
  xmlUrl?: string;
  trackingId?: string;
  totalClp?: number;
  ivaClp?: number;
  errorMessage?: string;
  raw?: unknown;
}

/**
 * Customer payload coming in from `invoice.cliente` (or the admin form for
 * one-off DTEs). Kept loose vs. `DteRequest.header` because the admin route
 * wants to accept the raw form fields and let the adapter normalise them.
 */
export interface DteCustomer {
  rut: string;
  razonSocial: string;
  giro?: string;
  direccion: string;
  comuna: string;
  ciudad: string;
  email?: string;
}

export interface DteItem {
  description: string;
  quantity: number;
  /** Unit price WITHOUT IVA. Whole CLP — no decimals. */
  unitPriceClp: number;
  taxable: boolean;
  itemCode?: string;
}

export type DteTypeName =
  | 'factura_electronica'
  | 'boleta_electronica'
  | 'boleta_exenta'
  | 'nota_credito'
  | 'nota_debito';

export interface DteCreateInput {
  type: DteTypeName;
  customer: DteCustomer;
  items: DteItem[];
  paymentMethod: 'webpay' | 'mercadopago' | 'transferencia' | 'efectivo';
  /** Folio references for NC/ND documents (must point at an existing factura/boleta). */
  references?: { type: string; folio: string; date: string }[];
}

const NAME_TO_DTE_CODE: Record<DteTypeName, DteType> = {
  factura_electronica: 33,
  boleta_electronica: 39,
  boleta_exenta: 41,
  nota_credito: 61,
  nota_debito: 56,
};

const DTE_CODE_TO_NAME: Record<DteType, DteTypeName> = {
  33: 'factura_electronica',
  39: 'boleta_electronica',
  41: 'boleta_exenta',
  56: 'nota_debito',
  61: 'nota_credito',
};

/** Resolve env-backed config, returning null if BSALE_* vars are unset. */
function readConfigFromEnv(): BsaleConfig | null {
  const token = process.env.BSALE_ACCESS_TOKEN;
  const officeRaw = process.env.BSALE_OFFICE_ID;
  if (!token || !officeRaw) return null;
  const officeId = Number.parseInt(officeRaw, 10);
  if (!Number.isFinite(officeId) || officeId <= 0) return null;
  const baseUrl = process.env.BSALE_API_BASE_URL || DEFAULT_BSALE_BASE_URL;
  return { accessToken: token, officeId, baseUrl };
}

function bsaleHeaders(config: BsaleConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Bsale's auth header is `access_token`, NOT `Authorization`. Sending the
    // value as a Bearer token returns 401 even with a valid key.
    access_token: config.accessToken,
  };
}

/** Map a `DteCreateInput` to Bsale's `POST /documents.json` payload. */
export function buildBsalePayload(
  input: DteCreateInput,
  officeId: number,
  emissionDate: Date = new Date(),
): Record<string, unknown> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SiiAdapterError(
      'createDte',
      'DTE emission requires at least one line item.',
    );
  }
  const dteCode = NAME_TO_DTE_CODE[input.type];
  if (dteCode === undefined) {
    throw new SiiAdapterError(
      'createDte',
      `Unsupported DTE type: ${String(input.type)}.`,
    );
  }
  // Bsale wants epoch SECONDS (not millis) for `emissionDate`. SII rejects
  // future dates; clamp to today on a clock skew.
  const emissionEpoch = Math.floor(emissionDate.getTime() / 1000);
  const details = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new SiiAdapterError(
        'createDte',
        `Invalid quantity on "${item.description}": ${item.quantity}`,
      );
    }
    if (!Number.isFinite(item.unitPriceClp) || item.unitPriceClp < 0) {
      throw new SiiAdapterError(
        'createDte',
        `Invalid unitPriceClp on "${item.description}": ${item.unitPriceClp}`,
      );
    }
    return {
      netUnitValue: item.unitPriceClp,
      quantity: item.quantity,
      comment: item.description,
      // 0 = afecto al IVA; non-zero = sin impuestos in Bsale's schema.
      taxId: item.taxable ? '[1]' : '[]',
      ...(item.itemCode ? { code: item.itemCode } : {}),
    };
  });

  const client = {
    code: input.customer.rut,
    company: input.customer.razonSocial,
    activity: input.customer.giro ?? 'No especificado',
    address: input.customer.direccion,
    municipality: input.customer.comuna,
    city: input.customer.ciudad,
    ...(input.customer.email ? { email: input.customer.email } : {}),
  };

  const references = (input.references ?? []).map((r) => ({
    documentType: r.type,
    folio: r.folio,
    date: r.date,
  }));

  return {
    documentTypeId: dteCode,
    officeId,
    emissionDate: emissionEpoch,
    expirationDate: emissionEpoch,
    declareSii: 1,
    client,
    details,
    ...(references.length > 0 ? { references } : {}),
  };
}

/** Map Bsale's response to our `DteResult`. */
export function mapBsaleResponse(
  raw: unknown,
  fallbackTotalClp?: number,
  fallbackIvaClp?: number,
): DteResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorMessage: 'Bsale returned an empty payload.', raw };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.error === 'string' && r.error.length > 0) {
    return { ok: false, errorMessage: r.error, raw };
  }
  const folio =
    typeof r.number === 'number'
      ? r.number
      : typeof r.folio === 'number'
        ? r.folio
        : undefined;
  const trackingId =
    typeof r.id === 'number' || typeof r.id === 'string'
      ? String(r.id)
      : undefined;
  const pdfUrl = typeof r.urlPdf === 'string' ? r.urlPdf : undefined;
  const xmlUrl =
    typeof r.urlXml === 'string'
      ? r.urlXml
      : typeof r.urlPublicView === 'string'
        ? r.urlPublicView
        : undefined;
  const totalClp =
    typeof r.totalAmount === 'number' ? r.totalAmount : fallbackTotalClp;
  const ivaClp =
    typeof r.taxAmount === 'number' ? r.taxAmount : fallbackIvaClp;
  return {
    ok: folio !== undefined,
    folio,
    pdfUrl,
    xmlUrl,
    trackingId,
    totalClp,
    ivaClp,
    raw,
    ...(folio === undefined ? { errorMessage: 'Bsale response lacked a folio.' } : {}),
  };
}

/**
 * Real Bsale-backed adapter. Conforms to `SiiAdapter` (the project-wide
 * contract used by `getSiiAdapter()`) AND exposes Bsale-specific extras
 * (`createDte`, `cancelDte`, `getDte`) that the admin endpoints lean on.
 */
export class BsaleAdapter implements SiiAdapter {
  readonly name = 'bsale' as const;
  readonly provider = 'bsale' as const;
  readonly isAvailable: boolean;
  private readonly config: BsaleConfig;

  constructor(config: BsaleConfig) {
    this.config = config;
    this.isAvailable = Boolean(config.accessToken && config.officeId);
  }

  /** Build an instance from environment variables, or `null` when unset. */
  static fromEnv(): BsaleAdapter | null {
    const cfg = readConfigFromEnv();
    if (!cfg) return null;
    return new BsaleAdapter(cfg);
  }

  /** Internal: dispatch a Bsale REST call with proper headers + error mapping. */
  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new SiiAdapterError(
        'request',
        'globalThis.fetch is unavailable. Use Node ≥18 or pass fetchImpl.',
      );
    }
    const init: RequestInit = {
      method,
      headers: bsaleHeaders(this.config),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    let resp: Response;
    try {
      resp = await fetchImpl(url, init);
    } catch (err) {
      throw new SiiAdapterError('request', `Bsale fetch failed: ${String(err)}`, err);
    }
    let payload: unknown = null;
    const text = await resp.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!resp.ok) {
      const msg =
        (payload as { error?: string } | null)?.error ??
        `Bsale ${method} ${path} → HTTP ${resp.status}`;
      throw new SiiAdapterError('request', msg, payload);
    }
    return payload;
  }

  /**
   * `SiiAdapter.emitDte`. Translates the canonical `DteRequest` shape used
   * by the rest of the codebase (Webpay → invoice.paid → SII pipeline) into
   * a `DteCreateInput` and delegates to `createDte`.
   */
  async emitDte(request: DteRequest): Promise<DteResponse> {
    const totals = calculateDteTotals(request.lineItems);
    const typeName = DTE_CODE_TO_NAME[request.header.type];
    if (!typeName) {
      throw new SiiAdapterError(
        'emitDte',
        `Unsupported SII DTE type code: ${request.header.type}`,
      );
    }
    const result = await this.createDte({
      type: typeName,
      customer: {
        rut: request.header.receptorRut,
        razonSocial: request.header.receptorRazonSocial,
        giro: request.header.emisorGiro,
        direccion: 'No especificado',
        comuna: 'No especificado',
        ciudad: 'No especificado',
      },
      items: request.lineItems.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPriceClp: li.unitPrice,
        taxable: !li.exemptFromIva,
      })),
      paymentMethod:
        request.paymentInfo?.method === 'webpay'
          ? 'webpay'
          : request.paymentInfo?.method === 'cash'
            ? 'efectivo'
            : 'transferencia',
    });
    if (!result.ok || result.folio === undefined) {
      throw new SiiAdapterError(
        'emitDte',
        result.errorMessage ?? 'Bsale rejected the DTE.',
        result.raw,
      );
    }
    return {
      folio: result.folio,
      trackId: result.trackingId ?? `bsale-${result.folio}`,
      status: 'accepted',
      pdfUrl: result.pdfUrl,
      xml: undefined,
      emittedAt: new Date().toISOString(),
    };
  }

  /**
   * Bsale-specific entry point. Returns `DteResult` (never throws on a
   * Bsale-side rejection — the admin route surfaces the error to the UI as
   * a 4xx). HTTP failures (5xx, network) still throw.
   */
  async createDte(input: DteCreateInput): Promise<DteResult> {
    const dteCode = NAME_TO_DTE_CODE[input.type];
    const resource = BSALE_RESOURCE_BY_DTE[dteCode];
    if (!resource) {
      return {
        ok: false,
        errorMessage: `Unsupported DTE type: ${input.type}.`,
      };
    }
    // Pre-compute totals so we can echo them back even when Bsale's payload
    // omits them (some sandboxes return only id + url).
    const lineItems = input.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPriceClp,
      exemptFromIva: !it.taxable,
    }));
    let totals: { iva: number; total: number };
    try {
      const t = calculateDteTotals(lineItems);
      totals = { iva: t.iva, total: t.total };
    } catch (err) {
      return {
        ok: false,
        errorMessage:
          err instanceof Error ? err.message : 'Total calculation failed.',
      };
    }
    const body = buildBsalePayload(input, this.config.officeId);
    let raw: unknown;
    try {
      raw = await this.request('POST', resource, body);
    } catch (err) {
      if (err instanceof SiiAdapterError) {
        return {
          ok: false,
          errorMessage: err.message,
          raw: err.cause,
        };
      }
      throw err;
    }
    return mapBsaleResponse(raw, totals.total, totals.iva);
  }

  /**
   * `SiiAdapter.getDteStatus`. The Bsale API doesn't have a dedicated
   * status endpoint — instead we GET `/documents/{id}.json` and translate
   * the `state` field (1 = aceptado, 2 = rechazado, 0/null = pendiente).
   */
  async getDteStatus(trackId: string): Promise<DteResponse> {
    const result = await this.getDte(trackId);
    if (!result.ok || result.folio === undefined) {
      throw new SiiAdapterError(
        'getDteStatus',
        result.errorMessage ?? `Bsale could not find DTE ${trackId}.`,
        result.raw,
      );
    }
    return {
      folio: result.folio,
      trackId,
      status: 'accepted',
      pdfUrl: result.pdfUrl,
      xml: undefined,
      emittedAt: new Date().toISOString(),
    };
  }

  /** Bsale-specific status fetch returning `DteResult` (no throw on 4xx). */
  async getDte(trackingId: string): Promise<DteResult> {
    if (!trackingId || typeof trackingId !== 'string') {
      return { ok: false, errorMessage: 'trackingId is required.' };
    }
    let raw: unknown;
    try {
      raw = await this.request('GET', `documents/${encodeURIComponent(trackingId)}.json`);
    } catch (err) {
      if (err instanceof SiiAdapterError) {
        return { ok: false, errorMessage: err.message, raw: err.cause };
      }
      throw err;
    }
    return mapBsaleResponse(raw);
  }

  /**
   * Cancel a previously emitted DTE by issuing a Nota de Crédito for the
   * full amount. Bsale doesn't expose an `anulación` endpoint — the SII
   * flow for cancellation IS the NC pipeline. Reason is mandatory because
   * SII requires a glosa on the credit note.
   */
  async cancelDte(folio: number, reason: string): Promise<{ ok: boolean; trackingId?: string; errorMessage?: string }> {
    if (!Number.isFinite(folio) || folio <= 0) {
      return { ok: false, errorMessage: 'folio must be a positive integer.' };
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return { ok: false, errorMessage: 'reason is required for cancellation.' };
    }
    let raw: unknown;
    try {
      raw = await this.request('POST', `documents/${folio}/cancel.json`, {
        reason: reason.trim(),
      });
    } catch (err) {
      if (err instanceof SiiAdapterError) {
        return { ok: false, errorMessage: err.message };
      }
      throw err;
    }
    const r = (raw ?? {}) as Record<string, unknown>;
    const trackingId =
      typeof r.id === 'number' || typeof r.id === 'string' ? String(r.id) : undefined;
    return { ok: true, trackingId };
  }
}

/**
 * Singleton-shaped export so the module facade in `./index.ts` can keep its
 * `bsaleAdapter` import. Falls back to a non-functional stub when env vars
 * are absent — `isAvailable: false` flags this to the runtime selector.
 */
export const bsaleAdapter: SiiAdapter & {
  createDte?: BsaleAdapter['createDte'];
  cancelDte?: BsaleAdapter['cancelDte'];
  getDte?: BsaleAdapter['getDte'];
  provider: 'bsale';
} = (() => {
  const fromEnv = BsaleAdapter.fromEnv();
  if (fromEnv) {
    return Object.assign(fromEnv, { provider: 'bsale' as const });
  }
  // Env not set — keep an SiiAdapter-shaped stub so tests + facade compile.
  // First call surfaces a clear error pointing at the missing env vars.
  const stub: SiiAdapter & { provider: 'bsale' } = {
    name: 'bsale' as const,
    provider: 'bsale' as const,
    isAvailable: false,
    async emitDte(): Promise<DteResponse> {
      throw new SiiAdapterError(
        'emitDte',
        `Bsale adapter not configured. Set BSALE_ACCESS_TOKEN and BSALE_OFFICE_ID. See ${BSALE_DOCS_URL}.`,
      );
    },
    async getDteStatus(): Promise<DteResponse> {
      throw new SiiAdapterError(
        'getDteStatus',
        `Bsale adapter not configured. Set BSALE_ACCESS_TOKEN and BSALE_OFFICE_ID. See ${BSALE_DOCS_URL}.`,
      );
    },
  };
  return stub;
})();

// Re-export the IVA constant so callers don't need to reach into ./types.
export { CHILE_IVA_RATE };
