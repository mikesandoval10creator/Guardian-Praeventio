// Praeventio Guard — SII adapter shared helpers.
//
// SCAFFOLDING ONLY. The concrete PSE adapters (`openfacturaAdapter`,
// `simpleApiAdapter`, …) live in sibling files and re-export this module's
// helpers. The runtime selection happens in `index.ts` (`getSiiAdapter()`).
//
// What's here:
//   • `calculateDteTotals` — the *single source of truth* for DTE totals
//     math, with the same `Math.ceil(net * 0.19)` rounding rule as
//     `pricing/tiers.ts:withIVA`. Tested via `siiAdapter.test.ts`.
//   • `SiiAdapterError` — typed error every PSE stub throws so callers can
//     `instanceof`-check rather than string-match. Mirrors
//     `WebpayAdapterError` / `WebpayNotImplementedError`.
//   • `noopSiiAdapter` — success-shaped fake for dev/CI when no PSE is
//     configured. Returns deterministic fake folios so snapshot tests are
//     stable.
//
// The adapter *interface* (`SiiAdapter`, `DteRequest`, …) lives in
// `./types.ts` to avoid circular imports between the helpers here and the
// individual PSE stubs.

import {
  CHILE_IVA_RATE,
  type DteLineItem,
  type DteRequest,
  type DteResponse,
  type DteTotals,
  type SiiAdapter,
} from './types';

/**
 * Pure helper. Computes net / exempt / IVA / total for a DTE line list,
 * applying the project-wide IVA rounding rule
 * (`iva = Math.ceil(net * 0.19)` — see `pricing/tiers.ts:withIVA`).
 *
 * Throws on any line with non-finite, negative, or non-integer
 * quantity/unitPrice — DTE schema rejects fractional pesos and SII parses
 * negative amounts as nota-de-crédito payloads, so we fail loudly here.
 *
 * Empty input is allowed (returns all-zero totals). Callers that require a
 * non-empty DTE (SII does for accepted documents) should validate that
 * upstream.
 */
export function calculateDteTotals(lineItems: readonly DteLineItem[]): DteTotals {
  let netAmount = 0;
  let exemptAmount = 0;

  for (let i = 0; i < lineItems.length; i += 1) {
    const line = lineItems[i];
    if (!line) continue;
    const { description, quantity, unitPrice, exemptFromIva } = line;

    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      throw new SiiAdapterError(
        'calculateDteTotals',
        `Invalid quantity on line "${description}" (got ${quantity}). DTE lines require positive integer quantities.`,
      );
    }
    if (!Number.isFinite(unitPrice) || !Number.isInteger(unitPrice) || unitPrice < 0) {
      throw new SiiAdapterError(
        'calculateDteTotals',
        `Invalid unitPrice on line "${description}" (got ${unitPrice}). DTE schema requires whole non-negative CLP.`,
      );
    }

    const lineTotal = quantity * unitPrice;
    if (exemptFromIva) {
      exemptAmount += lineTotal;
    } else {
      netAmount += lineTotal;
    }
  }

  // Same rounding rule as pricing/tiers.ts:withIVA so e.g. net 10075 → iva 1915 → total 11990.
  const ivaRaw = netAmount * CHILE_IVA_RATE;
  const iva = netAmount > 0 ? Math.ceil(ivaRaw - 1e-9) : 0;
  const total = netAmount + iva + exemptAmount;

  return {
    netAmount,
    exemptAmount,
    ivaRate: CHILE_IVA_RATE,
    iva,
    total,
  };
}

/**
 * Typed error every SII adapter throws when an operation cannot be
 * completed. Concrete PSE adapters use this for "not implemented yet" — a
 * future round will subclass per-PSE if we want richer mapping (PSE error
 * codes, retryable transients, etc.).
 */
export class SiiAdapterError extends Error {
  readonly method: string;
  readonly cause?: unknown;
  constructor(method: string, message: string, cause?: unknown) {
    super(`SiiAdapter.${method}() failed: ${message}`);
    this.name = 'SiiAdapterError';
    this.method = method;
    this.cause = cause;
  }
}

/**
 * Subclass marker for the stub adapters. Mirrors
 * `WebpayNotImplementedError` so the calling code can specifically check
 * "this PSE just isn't wired up yet" vs. "the SDK actually failed".
 */
export class SiiNotImplementedError extends SiiAdapterError {
  readonly pse: string;
  readonly docsUrl: string;
  constructor(method: string, pse: string, docsUrl: string) {
    super(
      method,
      `${pse} adapter not implemented. See SII_INTEGRATION.md and ${docsUrl} for the integration runbook.`,
    );
    this.name = 'SiiNotImplementedError';
    this.pse = pse;
    this.docsUrl = docsUrl;
  }
}

/**
 * Build a `DteResponse` shape with safe defaults. The PSE stubs use this
 * (the `noopSiiAdapter` does, the others throw before they need it) so the
 * exact response shape stays consistent across PSEs and snapshot tests
 * never have to know which adapter produced the doc.
 */
export function buildPendingDteResponse(
  trackId: string,
  folio: number,
  emittedAt: string = new Date().toISOString(),
): DteResponse {
  return {
    folio,
    trackId,
    status: 'pending',
    emittedAt,
  };
}

/**
 * No-op adapter for dev/CI when `SII_PSE` is unset (or set to 'noop').
 *
 * `emitDte` returns a fake but well-formed `DteResponse` so downstream
 * code (Firestore writes, audit logs, email templates) can be exercised
 * end-to-end without a real PSE account. The folio is derived
 * deterministically from `paymentInfo.reference` ?? a counter so two calls
 * with the same buyOrder return the same folio (idempotency-friendly).
 *
 * `getDteStatus` echoes the trackId back as `accepted`. Real PSEs poll
 * SII for the actual upload outcome; the noop pretends SII always says yes.
 */
let noopFolioCounter = 700_000_000; // SII test folios for boletas usually 7xx

export const noopSiiAdapter: SiiAdapter = {
  name: 'noop',
  // The noop adapter is "always available" so dev/CI never short-circuits
  // the SII pathway. Production deployments must set `SII_PSE` to a real
  // PSE — `getSiiAdapter()` falls back to noop only when nothing is set.
  isAvailable: true,
  async emitDte(request: DteRequest): Promise<DteResponse> {
    const reference = request.paymentInfo?.reference;
    let folio: number;
    if (reference && typeof reference === 'string' && reference.length > 0) {
      // Deterministic hash so repeat calls with same buyOrder return the
      // same folio. Tiny FNV-1a 32-bit; collisions are fine in dev.
      let hash = 0x811c9dc5;
      for (let i = 0; i < reference.length; i += 1) {
        hash ^= reference.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      folio = 700_000_000 + (hash % 100_000_000);
    } else {
      noopFolioCounter += 1;
      folio = noopFolioCounter;
    }
    return {
      folio,
      trackId: `noop-${folio}`,
      status: 'accepted',
      pdfUrl: undefined,
      xml: undefined,
      emittedAt: new Date().toISOString(),
    };
  },
  async getDteStatus(trackId: string): Promise<DteResponse> {
    const folioStr = trackId.replace(/^noop-/, '');
    const folio = Number.parseInt(folioStr, 10) || 0;
    return {
      folio,
      trackId,
      status: 'accepted',
      emittedAt: new Date().toISOString(),
    };
  },
};

/** Test-only helper. Resets the counter so each test starts deterministically. */
export function __resetNoopSiiAdapterStateForTests(): void {
  noopFolioCounter = 700_000_000;
}
