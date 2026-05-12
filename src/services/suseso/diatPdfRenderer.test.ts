import { describe, it, expect } from 'vitest';
import { renderSusesoPdf } from './diatPdfRenderer.js';
import type { SusesoForm } from './types.js';

// pdfkit comprime contenido por defecto y codifica texto via Tj/TJ
// operators — grep-ear el byte stream para encontrar el folio NO funciona
// en general (probado con compress=false: el texto sigue en formato
// PostScript-like). Estos tests validan la SUPERFICIE generada:
//   - byte 0..5 = '%PDF-' (header válido)
//   - tamaño razonable (>1KB con contenido, <100KB sin imágenes)
//   - el renderer no tira excepciones con inputs canónicos / edge cases
// La cobertura visual del contenido se hace con un E2E que abre el PDF
// en pdf.js + assert + snapshot — fuera del scope de este unit test.

function baseForm(over: Partial<SusesoForm> = {}): SusesoForm {
  return {
    kind: 'DIAT',
    folio: 'DIAT-2026-praevent-000042',
    workerRut: '12.345.678-9',
    workerFullName: 'Juan Pérez González',
    companyRut: '76.543.210-K',
    companyName: 'Minera Praeventio SpA',
    mutualidad: 'achs',
    incidentDate: '2026-05-10T08:30:00-04:00',
    incidentDescription:
      'El trabajador resbaló en zona húmeda del nivel 4 mientras transportaba materiales. Cayó hacia el costado izquierdo golpeando la rodilla contra una estructura metálica.',
    incidentLocation: 'Faena Norte — Nivel 4, Pasillo Bodega',
    bodyPartsAffected: ['rodilla_izquierda', 'mano_izquierda', 'cadera'],
    incidentClassification: 'accidente_trabajo',
    ds101Causal: 'tropiezo_caida_mismo_nivel',
    witnesses: [
      { fullName: 'María López Soto', rut: '11.111.111-1' },
      { fullName: 'Carlos Ríos Mena', rut: '22.222.222-2' },
    ],
    reportedBy: {
      uid: 'firebase-uid-abc',
      rut: '14.222.333-4',
      fullName: 'Ana Supervisora Ramírez',
    },
    createdAt: '2026-05-10T09:00:00-04:00',
    ...over,
  };
}

function assertValidPdf(pdf: Buffer): void {
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(1000);
  expect(pdf.length).toBeLessThan(100_000);
  // Trailing %%EOF marker (PDF spec section 7.5.5).
  const tail = pdf.subarray(Math.max(0, pdf.length - 50)).toString('binary');
  expect(tail).toMatch(/%%EOF/);
}

describe('renderSusesoPdf', () => {
  it('renders a complete DIAT form without crashing', async () => {
    const pdf = await renderSusesoPdf({ form: baseForm() });
    assertValidPdf(pdf);
  });

  it('renders a DIEP form (DS 110 causal)', async () => {
    const pdf = await renderSusesoPdf({
      form: baseForm({
        kind: 'DIEP',
        ds101Causal: undefined,
        ds110Causal: 'silicosis_pulmonar',
        incidentClassification: 'enfermedad_profesional',
      }),
    });
    assertValidPdf(pdf);
  });

  it('renders unsigned form (signature undefined)', async () => {
    const pdf = await renderSusesoPdf({ form: baseForm({ signature: undefined }) });
    assertValidPdf(pdf);
  });

  it('renders signed form with WebAuthn ECDSA P256 signature', async () => {
    const pdf = await renderSusesoPdf({
      form: baseForm({
        signature: {
          signerUid: 'sup-uid-9',
          signerRut: '15.999.888-K',
          signedAt: '2026-05-10T09:15:00-04:00',
          algorithm: 'webauthn-ecdsa-p256',
          signatureB64: 'base64sig',
          payloadHashHex: 'abc123def456' + '0'.repeat(52),
        },
      }),
    });
    assertValidPdf(pdf);
  });

  it('renders with verify URL embedded', async () => {
    const pdf = await renderSusesoPdf({
      form: baseForm(),
      verifyUrl: 'https://praeventio.app/api/suseso/verify/DIAT-2026-praevent-000042',
    });
    assertValidPdf(pdf);
  });

  it('handles empty witnesses array', async () => {
    const pdf = await renderSusesoPdf({ form: baseForm({ witnesses: [] }) });
    assertValidPdf(pdf);
  });

  it('handles 50 body-parts (long list, truncates safely)', async () => {
    const longParts = Array.from(
      { length: 50 },
      (_, i) => `parte_${i}_muy_descriptiva_y_larga`,
    );
    const pdf = await renderSusesoPdf({
      form: baseForm({ bodyPartsAffected: longParts }),
    });
    assertValidPdf(pdf);
  });

  it('handles minimal form (no witnesses, no signature, no DS causal)', async () => {
    const pdf = await renderSusesoPdf({
      form: baseForm({
        witnesses: [],
        signature: undefined,
        ds101Causal: undefined,
        bodyPartsAffected: [],
      }),
    });
    assertValidPdf(pdf);
  });
});
