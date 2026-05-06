// Praeventio Guard — Sprint 34 Bucket: SII DTE generator (no-push model).
//
// IMPORTANT (regla de producto inviolable):
//   Praeventio NO push a SII. La empresa cliente imprime/firma/envía.
//   Ver memoria producto product_signing_no_blocking_directives_2026-05-06.
//
// What this module does:
//   • Builds a Chilean DTE (Documento Tributario Electrónico) per the SII
//     norma técnica (Resolución Exenta SII 80/2014). Supports tipo 33
//     (factura electrónica afecta) and tipo 39 (boleta electrónica afecta).
//   • Serializes the DTE to a SII-canonical XML envelope using xmlbuilder2.
//   • Computes a SHA-256 hash over the canonical XML so the WebAuthn
//     biometric signing layer (`dteSigner.ts`) has a deterministic byte
//     string to bind its signature to.
//
// What this module does NOT do:
//   • It does NOT POST anywhere. There is no fetch/axios call here. The
//     resulting XML + PDF are returned to the caller; the caller is the
//     CLIENT EMPRESA which prints/signs in person and submits via its own
//     channel. PSE adapters (libredte/openfactura/bsale/simpleApi) remain
//     stubs and are NOT invoked from here.
//   • It does NOT enrol CAFs. Folio is supplied by the caller (their CAF).
//   • It does NOT cover the 60+ DTE types in the SII catalog — only 33 and
//     39 in this iteration. Adding 41/56/61 is a future sprint.

import { create } from 'xmlbuilder2';
import crypto from 'node:crypto';
import {
  CHILE_IVA_RATE,
  PRAEVENTIO_EMISOR_GIRO_DEFAULT,
  PRAEVENTIO_EMISOR_RAZON_SOCIAL_DTE_DEFAULT,
  PRAEVENTIO_EMISOR_RUT_DTE,
  type DteLineItem,
} from './types';
import { calculateDteTotals, SiiAdapterError } from './siiAdapter';

/** Subset of DTE types this generator supports. */
export type GenerateDteType = 33 | 39;

export interface GenerateDteOptions {
  type: GenerateDteType;
  /** Emisor RUT — defaults to Praeventio's locked literal RUT. */
  emisorRut?: string;
  emisorRazonSocial?: string;
  emisorGiro?: string;
  emisorDireccion?: string;
  emisorComuna?: string;
  /** Receptor RUT in `NN.NNN.NNN-X` or `NNNNNNNN-X` format. */
  receptorRut: string;
  receptorRazonSocial: string;
  receptorDireccion?: string;
  receptorComuna?: string;
  /** YYYY-MM-DD, Chile timezone. DTE schema rejects time. */
  fecha: string;
  /** Folio assigned from the customer's CAF range. */
  folio: number;
  items: DteLineItem[];
}

export interface GeneratedDte {
  /** Canonical XML envelope. */
  xml: string;
  /** SHA-256 of `xml` (hex). The signer binds its signature to this. */
  hash: string;
  /** Canonical SII-style id `{type}-{folio}-{emisorRut}` for cross-reference. */
  dteId: string;
  /** Quick summary for audit + UI rendering. */
  summary: {
    type: GenerateDteType;
    folio: number;
    emisorRut: string;
    receptorRut: string;
    fecha: string;
    netAmount: number;
    iva: number;
    total: number;
    itemCount: number;
  };
}

const RUT_REGEX = /^(\d{1,2}\.\d{3}\.\d{3}-[\dkK]|\d{7,8}-[\dkK])$/;

function validateRut(label: string, rut: string): void {
  if (typeof rut !== 'string' || !RUT_REGEX.test(rut)) {
    throw new SiiAdapterError(
      'generateDte',
      `Invalid ${label} RUT format: "${rut}". Expected NN.NNN.NNN-X or NNNNNNNN-X.`,
    );
  }
}

function validateFecha(fecha: string): void {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new SiiAdapterError(
      'generateDte',
      `Invalid fecha "${fecha}". Expected YYYY-MM-DD.`,
    );
  }
}

/**
 * Build the SII-canonical DTE XML envelope + companion hash. Pure function:
 * deterministic for given input, no I/O, no crypto besides the SHA-256 hash.
 */
export function generateDte(opts: GenerateDteOptions): GeneratedDte {
  if (opts.type !== 33 && opts.type !== 39) {
    throw new SiiAdapterError(
      'generateDte',
      `Unsupported DTE type ${opts.type}. This generator handles 33 and 39 only.`,
    );
  }
  if (!Number.isInteger(opts.folio) || opts.folio <= 0) {
    throw new SiiAdapterError('generateDte', `Folio must be a positive integer (got ${opts.folio}).`);
  }
  if (!Array.isArray(opts.items) || opts.items.length === 0) {
    throw new SiiAdapterError('generateDte', 'At least one line item is required.');
  }

  const emisorRut = opts.emisorRut ?? PRAEVENTIO_EMISOR_RUT_DTE;
  validateRut('emisor', emisorRut);
  validateRut('receptor', opts.receptorRut);
  validateFecha(opts.fecha);

  // calculateDteTotals already validates per-line quantity/unitPrice.
  const totals = calculateDteTotals(opts.items);

  const dteId = `T${opts.type}F${opts.folio}-${emisorRut}`;
  const tipoDte = opts.type;
  const ivaPct = Math.round(CHILE_IVA_RATE * 100); // 19

  const xmlObj = {
    DTE: {
      '@version': '1.0',
      '@xmlns': 'http://www.sii.cl/SiiDte',
      Documento: {
        '@ID': dteId,
        Encabezado: {
          IdDoc: {
            TipoDTE: tipoDte,
            Folio: opts.folio,
            FchEmis: opts.fecha,
          },
          Emisor: {
            RUTEmisor: emisorRut,
            RznSoc: opts.emisorRazonSocial ?? PRAEVENTIO_EMISOR_RAZON_SOCIAL_DTE_DEFAULT,
            GiroEmis: opts.emisorGiro ?? PRAEVENTIO_EMISOR_GIRO_DEFAULT,
            ...(opts.emisorDireccion ? { DirOrigen: opts.emisorDireccion } : {}),
            ...(opts.emisorComuna ? { CmnaOrigen: opts.emisorComuna } : {}),
          },
          Receptor: {
            RUTRecep: opts.receptorRut,
            RznSocRecep: opts.receptorRazonSocial,
            ...(opts.receptorDireccion ? { DirRecep: opts.receptorDireccion } : {}),
            ...(opts.receptorComuna ? { CmnaRecep: opts.receptorComuna } : {}),
          },
          Totales: {
            MntNeto: totals.netAmount,
            ...(totals.exemptAmount > 0 ? { MntExe: totals.exemptAmount } : {}),
            TasaIVA: ivaPct,
            IVA: totals.iva,
            MntTotal: totals.total,
          },
        },
        Detalle: opts.items.map((item, idx) => ({
          NroLinDet: idx + 1,
          NmbItem: item.description,
          QtyItem: item.quantity,
          PrcItem: item.unitPrice,
          ...(item.exemptFromIva ? { IndExe: 1 } : {}),
          MontoItem: item.quantity * item.unitPrice,
        })),
      },
    },
  };

  const doc = create({ version: '1.0', encoding: 'UTF-8' }, xmlObj);
  const xml = doc.end({ prettyPrint: false });

  const hash = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');

  return {
    xml,
    hash,
    dteId,
    summary: {
      type: opts.type,
      folio: opts.folio,
      emisorRut,
      receptorRut: opts.receptorRut,
      fecha: opts.fecha,
      netAmount: totals.netAmount,
      iva: totals.iva,
      total: totals.total,
      itemCount: opts.items.length,
    },
  };
}
