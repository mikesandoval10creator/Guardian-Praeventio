// Praeventio Guard — Sprint 28 Bucket B6.
//
// Tests for the SUSESO orchestration service.

import { describe, it, expect, vi } from 'vitest';
import {
  createSusesoForm,
  signForm,
  verifyFolio,
  submitToMutualidad,
  buildVerificationUrl,
  folioToDocId,
  renderSusesoUnsignedPayload,
  type MinimalFormStore,
} from './susesoService';
import type { SusesoForm, SusesoSignature } from './types';
import type { MinimalFolioStore } from './folioGenerator';
import { buildKmsComplianceSignature } from '../compliance/complianceSignature';

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
        for (const [formId, form] of bucket) {
          if (form.folio === folio) return { tenantId: tid, formId, form };
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

function buildBoundSusesoSignature(form: SusesoForm): SusesoSignature {
  const formId = folioToDocId(form.folio);
  const payloadHashHex = form.payloadHashHex!;
  return buildKmsComplianceSignature({
    context: {
      tenantId: 'praeventio', formId, documentKind: 'suseso', payloadHashHex,
      signerUid: 'kms-signer', signerRut: '14.444.444-K',
    },
    signer: { uid: 'kms-signer', rut: '14.444.444-K', kind: 'kms' },
    signatureB64: 'server-verified-signature',
    keyVersion: 'key/7',
    publicKeyPem: 'server-verified-public-key',
  });
}

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
    expect(result.form.payloadHashHex).toBe(result.payloadHashHex);
    expect(result.form.payloadRendererVersion).toBe(1);
    expect(result.qrCodeUrl).toBe('/api/suseso/verify/DIAT-2026-praevent-000001');
  });

  it('recomputes the authoritative unsigned digest and ignores signature evidence', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createSusesoForm(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    const signedView: SusesoForm = {
      ...form,
      signature: {
        signerUid: 'attacker-controlled-view',
        signerRut: '1-9',
        signedAt: '2099-01-01T00:00:00.000Z',
        algorithm: 'kms-sign-rsa',
        signatureB64: 'different-evidence',
        payloadHashHex: 'f'.repeat(64),
      },
    };

    const recomputed = await renderSusesoUnsignedPayload(signedView);
    expect(recomputed.payloadHashHex).toBe(payloadHashHex);
    expect(recomputed.payloadRendererVersion).toBe(1);
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
  const fabricatedSig: SusesoSignature = {
    signerUid: 'u1',
    signerRut: '14.444.444-K',
    signedAt: '2026-05-04T16:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: 'AAAA',
    payloadHashHex: 'a'.repeat(64),
  };

  it('attaches server-built bound evidence to an unsigned form', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const signed = await signForm(
      'praeventio',
      folioToDocId(form.folio),
      buildBoundSusesoSignature(form),
      { formStore },
    );
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.algorithm).toBe('kms-sign-rsa');
  });

  it('rejects fabricated AAAA evidence at the service boundary', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await expect(signForm(
      'praeventio', folioToDocId(form.folio), fabricatedSig, { formStore },
    )).rejects.toThrow(/bound compliance evidence/i);
  });

  it('refuses to re-sign an already-signed form', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const signature = buildBoundSusesoSignature(form);
    await signForm('praeventio', folioToDocId(form.folio), signature, { formStore });
    await expect(
      signForm('praeventio', folioToDocId(form.folio), signature, { formStore }),
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
        { ...fabricatedSig, payloadHashHex: 'xyz' },
        { formStore },
      ),
    ).rejects.toThrow(/64-char lowercase hex/);
  });

  it('throws on missing form', async () => {
    const formStore = buildFormStore();
    await expect(
      signForm('praeventio', 'nope', fabricatedSig, { formStore }),
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
      buildBoundSusesoSignature(form),
      { formStore },
    );
    const verifySignature = vi.fn(async () => ({ status: 'verified' as const }));
    const r = await verifyFolio(form.folio, { formStore, verifySignature });
    expect(r.valid).toBe(true);
    expect(r.verificationStatus).toBe('verified');
    expect(r.kind).toBe('DIAT');
    expect(r.signerRut).toBe('14.444.444-K');
    // Worker rut MUST NOT leak in verification response.
    expect(JSON.stringify(r)).not.toContain('12.345.678-9');
    expect(verifySignature).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        tenantId: 'praeventio',
        formId: folioToDocId(form.folio),
        documentKind: 'suseso',
        payloadHashHex: form.payloadHashHex,
      }),
      payloadBytes: expect.any(Uint8Array),
    }));
  });

  it('does not equate a stored fabricated signature with validity', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await formStore.attachSignature('praeventio', folioToDocId(form.folio), {
      signerUid: 'u1', signerRut: '14.444.444-K',
      signedAt: '2026-05-04T16:00:00.000Z', algorithm: 'webauthn-ecdsa-p256',
      signatureB64: 'AAAA', payloadHashHex: form.payloadHashHex!,
    });
    const r = await verifyFolio(form.folio, {
      formStore,
      verifySignature: async () => ({ status: 'invalid', reason: 'signature_invalid' }),
    });
    expect(r).toEqual({
      valid: false,
      kind: 'DIAT',
      verificationStatus: 'invalid',
      reason: 'signature_invalid',
    });
  });

  it('detects mutation of the current document before crypto verification', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    const formId = folioToDocId(form.folio);
    const signed = await signForm(
      'praeventio', formId, buildBoundSusesoSignature(form), { formStore },
    );
    await formStore.saveForm('praeventio', formId, {
      ...signed,
      incidentDescription: 'document content changed after signing',
    });
    const verifySignature = vi.fn(async () => ({ status: 'verified' as const }));
    const r = await verifyFolio(form.folio, { formStore, verifySignature });
    expect(r).toEqual({
      valid: false,
      kind: 'DIAT',
      verificationStatus: 'invalid',
      reason: 'payload_hash_mismatch',
    });
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it('reports insufficient historical evidence without claiming invalid crypto', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createSusesoForm(baseInput, { folioStore, formStore });
    await formStore.attachSignature(
      'praeventio', folioToDocId(form.folio), buildBoundSusesoSignature(form),
    );
    const r = await verifyFolio(form.folio, {
      formStore,
      verifySignature: async () => ({
        status: 'unverifiable', reason: 'verification_key_unavailable',
      }),
    });
    expect(r).toEqual({
      valid: false,
      kind: 'DIAT',
      verificationStatus: 'unverifiable',
      reason: 'verification_key_unavailable',
    });
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
      buildBoundSusesoSignature(form),
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
