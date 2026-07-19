// Praeventio Guard — Sprint 31 Bucket PP.
//
// Tests for the DS 67 Reglamento Interno service.

import { describe, it, expect } from 'vitest';
import {
  createDs67Form,
  signForm,
  listVersions,
  formatDs67Folio,
  parseDs67Folio,
  ds67FolioToDocId,
  renderDs67UnsignedPayload,
  type MinimalDs67FormStore,
} from './ds67Service';
import type { Ds67Form, Ds67Signature } from './types';
import type { MinimalFolioStore } from '../../suseso/folioGenerator';
import { buildKmsComplianceSignature } from '../complianceSignature';

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

function buildFormStore(): MinimalDs67FormStore {
  const byTenantId = new Map<string, Map<string, Ds67Form>>();
  return {
    async saveForm(tid, fid, form) {
      let bucket = byTenantId.get(tid);
      if (!bucket) { bucket = new Map(); byTenantId.set(tid, bucket); }
      bucket.set(fid, form);
    },
    async loadForm(tid, fid) {
      return byTenantId.get(tid)?.get(fid) ?? null;
    },
    async listVersions(tid) {
      return Array.from(byTenantId.get(tid)?.values() ?? []);
    },
    async attachSignature(tid, fid, signature) {
      const cur = byTenantId.get(tid)?.get(fid);
      if (!cur) throw new Error('not found');
      const updated = { ...cur, signature };
      byTenantId.get(tid)!.set(fid, updated);
      return updated;
    },
  };
}

const baseInput = {
  tenantId: 'praeventio',
  companyName: 'Constructora Andes Ltda.',
  companyRut: '76.543.210-K',
  companyAddress: 'Av. Apoquindo 1234, Las Condes',
  scopeOfApplication: 'Aplica a todo el personal de la empresa.',
  workerObligations: ['Usar EPP', 'Reportar incidentes'],
  workerProhibitions: ['Operar equipos sin certificación', 'Ingerir alcohol'],
  sanctions: 'Amonestación verbal, escrita y multa.',
  complaintProcedure: 'Presentar reclamo ante el CPHS dentro de 5 días hábiles.',
  effectiveFrom: '2026-06-01T00:00:00.000Z',
};

describe('formatDs67Folio + parseDs67Folio', () => {
  it('produces the documented shape', () => {
    expect(formatDs67Folio(2026, 'praeventio', 7)).toBe(
      'DS67-2026-praevent-000007',
    );
  });

  it('round-trips parseDs67Folio', () => {
    const f = formatDs67Folio(2026, 'praeventio', 7);
    expect(parseDs67Folio(f)).toEqual({
      year: 2026,
      tenantSlug: 'praevent',
      seq: 7,
    });
  });

  it('rejects malformed folios', () => {
    expect(parseDs67Folio('DIAT-2026-praevent-000001')).toBeNull();
    expect(parseDs67Folio('DS67-26-praevent-000001')).toBeNull();
  });
});

describe('createDs67Form', () => {
  it('allocates a folio and returns PDF magic bytes + hash', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const result = await createDs67Form(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    expect(result.form.folio).toBe('DS67-2026-praevent-000001');
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
    // PDF magic bytes: %PDF-
    expect(String.fromCharCode(...result.pdfBytes.slice(0, 4))).toBe('%PDF');
    expect(result.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.form.payloadHashHex).toBe(result.payloadHashHex);
    expect(result.form.payloadRendererVersion).toBe(1);
  });

  it('recomputes the authoritative unsigned digest independently of signature evidence', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs67Form(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    const signedView: Ds67Form = {
      ...form,
      signature: {
        signerUid: 'other', signerRut: '1-9', signedAt: '2099-01-01T00:00:00.000Z',
        algorithm: 'kms-sign-rsa', signatureB64: 'other', payloadHashHex: 'f'.repeat(64),
      },
    };

    expect((await renderDs67UnsignedPayload(signedView)).payloadHashHex).toBe(payloadHashHex);
  });

  it('persists the form so it can be loaded back', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs67Form(baseInput, { folioStore, formStore });
    const loaded = await formStore.loadForm('praeventio', ds67FolioToDocId(form.folio));
    expect(loaded).not.toBeNull();
    expect(loaded?.workerObligations.length).toBe(2);
  });

  it('rejects missing required fields', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await expect(
      createDs67Form(
        { ...baseInput, companyName: '' },
        { folioStore, formStore },
      ),
    ).rejects.toThrow(/companyName required/);
  });

  it('increments folio sequence across calls', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const a = await createDs67Form(baseInput, { folioStore, formStore });
    const b = await createDs67Form(baseInput, { folioStore, formStore });
    expect(a.form.folio).toBe('DS67-2026-praevent-000001');
    expect(b.form.folio).toBe('DS67-2026-praevent-000002');
  });
});

describe('signForm', () => {
  const fabricatedSig: Ds67Signature = {
    signerUid: 'u1',
    signerRut: '14.444.444-K',
    signedAt: '2026-05-04T16:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: 'AAAA',
    payloadHashHex: 'a'.repeat(64),
  };

  function boundSignature(form: Ds67Form): Ds67Signature {
    const formId = ds67FolioToDocId(form.folio);
    const payloadHashHex = form.payloadHashHex!;
    return buildKmsComplianceSignature({
      context: {
        tenantId: 'praeventio', formId, documentKind: 'ds67', payloadHashHex,
        signerUid: 'kms-signer', signerRut: '14.444.444-K',
      },
      signer: { uid: 'kms-signer', rut: '14.444.444-K', kind: 'kms' },
      signatureB64: 'server-verified-signature', keyVersion: 'key/7',
      publicKeyPem: 'server-verified-public-key',
    });
  }

  it('attaches signature to unsigned form', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs67Form(baseInput, { folioStore, formStore });
    const signed = await signForm(
      'praeventio',
      ds67FolioToDocId(form.folio),
      boundSignature(form),
      { formStore },
    );
    expect(signed.signature).toBeDefined();
  });

  it('rejects fabricated AAAA evidence at the service boundary', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs67Form(baseInput, { folioStore, formStore });
    await expect(signForm(
      'praeventio', ds67FolioToDocId(form.folio), fabricatedSig, { formStore },
    )).rejects.toThrow(/bound compliance evidence/i);
  });

  it('refuses to re-sign', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs67Form(baseInput, { folioStore, formStore });
    const signature = boundSignature(form);
    await signForm('praeventio', ds67FolioToDocId(form.folio), signature, { formStore });
    await expect(
      signForm('praeventio', ds67FolioToDocId(form.folio), signature, { formStore }),
    ).rejects.toThrow(/already signed/);
  });

  it('rejects malformed payloadHashHex', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs67Form(baseInput, { folioStore, formStore });
    await expect(
      signForm(
        'praeventio',
        ds67FolioToDocId(form.folio),
        { ...fabricatedSig, payloadHashHex: 'xyz' },
        { formStore },
      ),
    ).rejects.toThrow(/64-char lowercase hex/);
  });
});

describe('listVersions', () => {
  it('returns all versions for a tenant in creation order', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await createDs67Form(baseInput, { folioStore, formStore });
    await createDs67Form(baseInput, { folioStore, formStore });
    const versions = await listVersions('praeventio', { formStore });
    expect(versions.length).toBe(2);
    expect(versions[0].folio).toContain('DS67-');
  });
});
