// Praeventio Guard — Sprint 28 Bucket B6.
//
// Tests for the SUSESO PDF generator. We do NOT mock jsPDF here (unlike
// `ds109Certificate.test.ts`) — we want a real binary so we can assert
// the `%PDF-` magic header is present. jsPDF is environment-agnostic
// (works in node) so this is fine.

import { describe, it, expect } from 'vitest';
import { generateSusesoPdf } from './susesoCertificate';
import type { SusesoForm } from '../services/suseso/types';

const baseForm: SusesoForm = {
  kind: 'DIAT',
  folio: 'DIAT-2026-praevent-000001',
  workerRut: '12.345.678-9',
  workerFullName: 'Juan Pérez González',
  companyRut: '76.543.210-K',
  companyName: 'Constructora Andes SpA',
  mutualidad: 'achs',
  incidentDate: '2026-05-04T14:30:00.000Z',
  incidentDescription: 'Caída desde 2 metros al pisar tablón suelto en andamio.',
  incidentLocation: 'Faena Los Bronces, Las Condes',
  bodyPartsAffected: ['tobillo derecho', 'rodilla derecha'],
  incidentClassification: 'accidente_trabajo',
  ds101Causal: 'caída_distinto_nivel',
  witnesses: [
    { fullName: 'Pedro Ramírez', rut: '11.111.111-1' },
    { fullName: 'María López', rut: '22.222.222-2' },
  ],
  reportedBy: {
    uid: 'uid_supervisor_1',
    rut: '14.444.555-K',
    fullName: 'Carlos Supervisor',
  },
  createdAt: '2026-05-04T15:00:00.000Z',
};

describe('generateSusesoPdf', () => {
  it('returns a non-empty Uint8Array', () => {
    const bytes = generateSusesoPdf(baseForm);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('starts with the %PDF- magic header', () => {
    const bytes = generateSusesoPdf(baseForm);
    // PDF spec §7.5.2: file MUST begin with "%PDF-".
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('produces deterministic byte length for identical input (no Date.now)', () => {
    // Both renders use identical createdAt so the only var would be
    // jsPDF's internal id generator — which is deterministic given
    // identical inputs.
    const a = generateSusesoPdf(baseForm);
    const b = generateSusesoPdf(baseForm);
    // Length, not byte-equality (jsPDF embeds a timestamp in metadata).
    expect(a.length).toBe(b.length);
  });

  it('renders DIEP variant without throwing', () => {
    const diep: SusesoForm = {
      ...baseForm,
      kind: 'DIEP',
      folio: 'DIEP-2026-praevent-000007',
      ds101Causal: undefined,
      ds110Causal: 'silicosis_exposicion_cronica',
      incidentClassification: 'enfermedad_profesional',
    };
    const bytes = generateSusesoPdf(diep);
    expect(bytes.length).toBeGreaterThan(1000);
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('handles forms without witnesses', () => {
    const noWitness: SusesoForm = { ...baseForm, witnesses: [] };
    const bytes = generateSusesoPdf(noWitness);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders unsigned forms with PENDIENTE marker (no throw)', () => {
    expect(baseForm.signature).toBeUndefined();
    const bytes = generateSusesoPdf(baseForm);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders signed forms', () => {
    const signed: SusesoForm = {
      ...baseForm,
      signature: {
        signerUid: 'uid_supervisor_1',
        signerRut: '14.444.555-K',
        signedAt: '2026-05-04T15:30:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        signatureB64: 'AAAAAAAAAAAAAAAA',
        payloadHashHex: 'a'.repeat(64),
      },
    };
    const bytes = generateSusesoPdf(signed);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  describe('verification QR (renderer v2)', () => {
    const QR_URL = 'https://app.praeventio.net/verificar/DIAT-2026-praevent-000001';

    // These bytes are what a compliance signature covers. If QR rendering
    // is not byte-identical across runs, every signed declaration becomes
    // unverifiable the moment it is re-rendered for verification.
    it('is byte-deterministic across renders', () => {
      const a = generateSusesoPdf(baseForm, { qrText: QR_URL });
      const b = generateSusesoPdf(baseForm, { qrText: QR_URL });
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('changes the body, so the QR is inside the signed bytes', () => {
      const withQr = generateSusesoPdf(baseForm, { qrText: QR_URL });
      const withoutQr = generateSusesoPdf(baseForm);
      expect(Array.from(withQr)).not.toEqual(Array.from(withoutQr));
    });

    it('binds the QR target — repointing it changes the bytes', () => {
      const real = generateSusesoPdf(baseForm, { qrText: QR_URL });
      const repointed = generateSusesoPdf(baseForm, {
        qrText: 'https://attacker.example/verificar/DIAT-2026-praevent-000001',
      });
      expect(Array.from(real)).not.toEqual(Array.from(repointed));
    });
  });
});
