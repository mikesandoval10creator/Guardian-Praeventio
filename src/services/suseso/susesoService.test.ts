// Praeventio Guard — Sprint 28 Bucket B6.
//
// Tests for the SUSESO orchestration service.

import { describe, it, expect } from 'vitest';
import {
  createSusesoForm,
  signForm,
  verifyFolio,
  submitToMutualidad,
  buildVerificationUrl,
  folioToDocId,
  type MinimalFormStore,
} from './susesoService';
import type { SusesoForm, SusesoSignature } from './types';
import type { MinimalFolioStore } from './folioGenerator';

// ─── Test doubles ───────────────────────────────────────────────────────────

function buildFolioStore(): MinimalFolioStore {
  const data = new Map<string, { lastSeq: number }>();
  return {
    async runTransaction(fn) {
      let pending: { path: string; value: { lastSeq: number } } | null = null;
      const tx = {
        async get(path: string) {
          const cur = data.get(path);
          return cur
            ? { exists: true, data: { lastSeq: cur.lastSeq } }
            : { exists: false };
        },
        set(path: string, value: { lastSeq: number }) {
          pending = { path, value };
        },
      };
      const result = await fn(tx);
      if (pending) {
        const w = pending as { path: string; value: { lastSeq: number } };
        data.set(w.path, w.value);
      }
      return result;
    },
  };
}

function buildFormStore(): MinimalFormStore {
  const byTenantId = new Map<string, Map<string, SusesoForm>>();
  return {
    async saveForm(tenantId, formId, form) {
      let bucket = byTenantId.get(tenantId);
      if (!bucket) {
        bucket = new Map();
        byTenantId.set(tenantId, bucket);
      }
      bucket.set(formId, form);
    },
    async loadForm(tenantId, formId) {
      return byTenantId.get(tenantId)?.get(formId) ?? null;
    },
    async findFormByFolio(folio) {
      for (const [tid, bucket] of byTenantId) {
        for (const form of bucket.values()) {
          if (form.folio === folio) return { tenantId: tid, form };
        }
      }
      return null;
    },
    async attachSignature(tenantId, formId, signature) {
      const bucket = byTenantId.get(tenantId);
      const cur = bucket?.get(formId);
      if (!bucket || !cur) throw new Error('not found');
      const updated = { ...cur, signature };
      bucket.set(formId, updated);
      return updated;
    },
  };
}

const baseInput = {
  tenantId: 'praeventio',
  kind: 'DIAT' as const,
  workerRut: '12.345.678-9',
  workerFullName: 'Juan Pérez',
  companyRut: '76.543.210-K',
  companyName: 'Constructora Andes',
  mutualidad: 'achs' as const,
  incidentDate: '2026-05-04T14:00:00.000Z',
  incidentDescription: 'Caída desde 2 metros',
  incidentLocation: 'Faena Andes',
  bodyPartsAffected: ['tobillo'],
  incidentClassification: 'accidente_trabajo' as const,
  ds101Causal: 'caida_distinto_nivel',
  witnesses: [{ fullName: 'Pedro', rut: '11.111.111-1' }],
  reportedBy: { uid: 'u1', rut: '14.444.444-K', fullName: 'Carlos' },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createSusesoForm', () => {
  it('allocates a folio and returns PDF bytes + hash', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const result = await createSusesoForm(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    expect(result.form.folio).toBe('DIAT-2026-praevent-000001');
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
    expect(result.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.qrCodeUrl).toBe('/api/suseso/verify/DIAT-2026-praevent-000001');
  });

  it('persists the form so it can be loaded back', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const loaded = await formStore.loadForm('praeventio', folioToDocId(form.folio));
    expect(loaded).not.toBeNull();
    expect(loaded?.folio).toBe(form.folio);
  });

  it('rejects DIAT carrying ds110Causal', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await expect(
      createSusesoForm(
        { ...baseInput, ds110Causal: 'silicosis' },
        { folioStore, formStore },
      ),
    ).rejects.toThrow(/DIAT cannot carry ds110Causal/);
  });

  it('rejects DIEP carrying ds101Causal', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await expect(
      createSusesoForm(
        { ...baseInput, kind: 'DIEP' },
        { folioStore, formStore },
      ),
    ).rejects.toThrow(/DIEP cannot carry ds101Causal/);
  });
});

describe('signForm', () => {
  const validSig: SusesoSignature = {
    signerUid: 'u1',
    signerRut: '14.444.444-K',
    signedAt: '2026-05-04T16:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: 'AAAA',
    payloadHashHex: 'a'.repeat(64),
  };

  it('attaches a signature to an unsigned form', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const signed = await signForm(
      'praeventio',
      folioToDocId(form.folio),
      validSig,
      { formStore },
    );
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.algorithm).toBe('webauthn-ecdsa-p256');
  });

  it('refuses to re-sign an already-signed form', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await signForm('praeventio', folioToDocId(form.folio), validSig, { formStore });
    await expect(
      signForm('praeventio', folioToDocId(form.folio), validSig, { formStore }),
    ).rejects.toThrow(/already signed/);
  });

  it('rejects malformed payloadHashHex', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await expect(
      signForm(
        'praeventio',
        folioToDocId(form.folio),
        { ...validSig, payloadHashHex: 'xyz' },
        { formStore },
      ),
    ).rejects.toThrow(/64-char lowercase hex/);
  });

  it('throws on missing form', async () => {
    const formStore = buildFormStore();
    await expect(
      signForm('praeventio', 'nope', validSig, { formStore }),
    ).rejects.toThrow(/not found/);
  });
});

describe('verifyFolio', () => {
  it('returns valid:false for malformed folios', async () => {
    const formStore = buildFormStore();
    const r = await verifyFolio('not-a-folio', { formStore });
    expect(r).toEqual({ valid: false, reason: 'malformed_folio' });
  });

  it('returns valid:false unknown_folio for missing forms', async () => {
    const formStore = buildFormStore();
    const r = await verifyFolio('DIAT-2026-praevent-000999', { formStore });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown_folio');
  });

  it('returns valid:false unsigned for unsigned forms', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const r = await verifyFolio(form.folio, { formStore });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unsigned');
    expect(r.kind).toBe('DIAT');
  });

  it('returns full verification result for signed forms (no PII leak)', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await signForm(
      'praeventio',
      folioToDocId(form.folio),
      {
        signerUid: 'u1',
        signerRut: '14.444.444-K',
        signedAt: '2026-05-04T16:00:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        signatureB64: 'BBBB',
        payloadHashHex: 'b'.repeat(64),
      },
      { formStore },
    );
    const r = await verifyFolio(form.folio, { formStore });
    expect(r.valid).toBe(true);
    expect(r.kind).toBe('DIAT');
    expect(r.signerRut).toBe('14.444.444-K');
    // Worker rut MUST NOT leak in verification response.
    expect(JSON.stringify(r)).not.toContain('12.345.678-9');
  });
});

describe('submitToMutualidad', () => {
  it('refuses to submit unsigned forms', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await expect(
      submitToMutualidad('praeventio', folioToDocId(form.folio), { formStore }),
    ).rejects.toThrow(/Cannot submit unsigned/);
  });

  it('records submittedAt on signed forms', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await signForm(
      'praeventio',
      folioToDocId(form.folio),
      {
        signerUid: 'u1',
        signerRut: '14.444.444-K',
        signedAt: '2026-05-04T16:00:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        signatureB64: 'CCCC',
        payloadHashHex: 'c'.repeat(64),
      },
      { formStore },
    );
    const submitted = await submitToMutualidad(
      'praeventio',
      folioToDocId(form.folio),
      {
        formStore,
        now: () => new Date('2026-05-05T10:00:00.000Z'),
      },
    );
    expect(submitted.submittedAt).toBe('2026-05-05T10:00:00.000Z');
  });
});

describe('buildVerificationUrl + folioToDocId', () => {
  it('builds a relative URL by default', () => {
    expect(buildVerificationUrl('DIAT-2026-praevent-000001')).toBe(
      '/api/suseso/verify/DIAT-2026-praevent-000001',
    );
  });
  it('honors a public base URL', () => {
    expect(
      buildVerificationUrl('DIEP-2026-praevent-000099', 'https://praeventio.app'),
    ).toBe('https://praeventio.app/api/suseso/verify/DIEP-2026-praevent-000099');
  });
  it('lowercases the doc id', () => {
    expect(folioToDocId('DIAT-2026-praevent-000001')).toBe(
      'diat-2026-praevent-000001',
    );
  });
});
