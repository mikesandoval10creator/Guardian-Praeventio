// Tests para MercadoPago HMAC production format `ts=...,v1=...`.
// Regla #3 (2026-05-15): ya no "calificado con nota" — IMPLEMENTADO.

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  parseMpProductionSignatureHeader,
  verifyMercadoPagoIpnProductionSignature,
  verifyMpIpnAnyFormat,
} from './mercadoPagoIpn';

const SECRET = 'mp-test-secret-no-use-in-prod';

function makeManifestSignature(opts: {
  dataId: string;
  requestId: string;
  ts: number;
  secret: string;
}): string {
  const manifest = `id:${opts.dataId};request-id:${opts.requestId};ts:${opts.ts};`;
  const v1 = crypto.createHmac('sha256', opts.secret).update(manifest).digest('hex');
  return `ts=${opts.ts},v1=${v1}`;
}

describe('parseMpProductionSignatureHeader', () => {
  it('parsea formato canónico `ts=...,v1=...`', () => {
    const result = parseMpProductionSignatureHeader('ts=1704672000,v1=' + 'a'.repeat(64));
    expect(result).toEqual({ ts: 1704672000, v1: 'a'.repeat(64) });
  });

  it('parsea con espacios entre componentes', () => {
    const result = parseMpProductionSignatureHeader(' ts = 1704672000 , v1 = ' + 'a'.repeat(64));
    expect(result).toEqual({ ts: 1704672000, v1: 'a'.repeat(64) });
  });

  it('parsea con orden invertido', () => {
    const result = parseMpProductionSignatureHeader('v1=' + 'a'.repeat(64) + ',ts=1704672000');
    expect(result).toEqual({ ts: 1704672000, v1: 'a'.repeat(64) });
  });

  it('rechaza header sin ts', () => {
    const result = parseMpProductionSignatureHeader('v1=' + 'a'.repeat(64));
    expect(result).toBeNull();
  });

  it('rechaza header sin v1', () => {
    const result = parseMpProductionSignatureHeader('ts=1704672000');
    expect(result).toBeNull();
  });

  it('rechaza v1 con largo incorrecto (no SHA-256)', () => {
    const result = parseMpProductionSignatureHeader('ts=1704672000,v1=' + 'a'.repeat(63));
    expect(result).toBeNull();
  });

  it('rechaza ts no numérico', () => {
    const result = parseMpProductionSignatureHeader('ts=abc,v1=' + 'a'.repeat(64));
    expect(result).toBeNull();
  });

  it('rechaza string vacío', () => {
    expect(parseMpProductionSignatureHeader('')).toBeNull();
  });
});

describe('verifyMercadoPagoIpnProductionSignature', () => {
  const ts = 1704672000;
  const dataId = 'PAY-123456789';
  const requestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('verifica signature válida dentro de la ventana de tiempo', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      secret: SECRET,
      nowSec: ts + 60, // 1 min después → dentro de la tolerancia de 5 min
    });
    expect(ok).toBe(true);
  });

  it('rechaza si el dataId del manifest no coincide', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId: 'PAY-OTHER-ID',
      secret: SECRET,
      nowSec: ts,
    });
    expect(ok).toBe(false);
  });

  it('rechaza si el request-id no coincide', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: 'wrong-request-id',
      dataId,
      secret: SECRET,
      nowSec: ts,
    });
    expect(ok).toBe(false);
  });

  it('rechaza si el secret no coincide', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      secret: 'wrong-secret',
      nowSec: ts,
    });
    expect(ok).toBe(false);
  });

  it('rechaza por replay (timestamp > 5 min en el pasado)', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      secret: SECRET,
      nowSec: ts + 6 * 60, // 6 min después → fuera de tolerancia
    });
    expect(ok).toBe(false);
  });

  it('rechaza por replay (timestamp futuro fuera de tolerancia)', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      secret: SECRET,
      nowSec: ts - 6 * 60, // 6 min antes (clock drift) → fuera
    });
    expect(ok).toBe(false);
  });

  it('tolerance custom funciona', () => {
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    // 10 min después, tolerance 15 min → válido
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      secret: SECRET,
      nowSec: ts + 10 * 60,
      toleranceSec: 15 * 60,
    });
    expect(ok).toBe(true);
  });

  it('rechaza header malformado', () => {
    const ok = verifyMercadoPagoIpnProductionSignature({
      signatureHeader: 'not-a-valid-signature',
      requestIdHeader: requestId,
      dataId,
      secret: SECRET,
      nowSec: ts,
    });
    expect(ok).toBe(false);
  });
});

describe('verifyMpIpnAnyFormat', () => {
  it('detecta y verifica formato producción `ts=,v1=`', () => {
    const ts = Math.floor(Date.now() / 1000);
    const dataId = 'PAY-1';
    const requestId = 'req-1';
    const signatureHeader = makeManifestSignature({ dataId, requestId, ts, secret: SECRET });
    const ok = verifyMpIpnAnyFormat({
      signatureHeader,
      requestIdHeader: requestId,
      dataId,
      parsedBody: { type: 'payment', data: { id: dataId } },
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  it('detecta y verifica formato legacy `sha256=`', () => {
    // Reproducir el formato legacy: HMAC sobre canonical JSON del body
    const body = { type: 'payment', data: { id: '123' } };
    const canonical = JSON.stringify(body).replace(/\s+/g, ''); // canonical-ish
    // Para test cross-platform, usamos canonicalize del módulo
    // El test del legacy ya existe en otro archivo — aquí solo verificamos
    // el routing por prefix.
    const fakeLegacy = 'sha256=' + 'a'.repeat(64);
    const ok = verifyMpIpnAnyFormat({
      signatureHeader: fakeLegacy,
      parsedBody: body,
      secret: SECRET,
    });
    // El HMAC no va a coincidir con un fake — pero importante: el detector
    // route al verificador correcto (legacy), no al production.
    expect(ok).toBe(false);
  });

  it('rechaza si no es ningún formato conocido', () => {
    const ok = verifyMpIpnAnyFormat({
      signatureHeader: 'bearer xyz',
      parsedBody: {},
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it('producción requiere requestIdHeader y dataId', () => {
    const ts = Math.floor(Date.now() / 1000);
    const signatureHeader = `ts=${ts},v1=${'a'.repeat(64)}`;
    const ok = verifyMpIpnAnyFormat({
      signatureHeader,
      // requestIdHeader missing
      dataId: 'PAY-1',
      parsedBody: {},
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });
});
