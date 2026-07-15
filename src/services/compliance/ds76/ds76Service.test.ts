// Praeventio Guard — Sprint 31 Bucket PP.
//
// Tests for the DS 76 Reglamento Subcontratación service.

import { describe, it, expect } from 'vitest';
import {
  createDs76Form,
  signForm,
  listVersions,
  formatDs76Folio,
  parseDs76Folio,
  ds76FolioToDocId,
  renderDs76UnsignedPayload,
  type MinimalDs76FormStore,
} from './ds76Service';
import type { Ds76Form, Ds76Signature } from './types';
import type { MinimalFolioStore } from '../../suseso/folioGenerator';

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

function buildFormStore(): MinimalDs76FormStore {
  const byTenantId = new Map<string, Map<string, Ds76Form>>();
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
  principalCompanyName: 'Codelco División El Teniente',
  principalCompanyRut: '61.704.000-K',
  contractorCompanyName: 'Constructora Andes Ltda.',
  contractorCompanyRut: '76.543.210-K',
  worksiteName: 'Faena Sewell',
  worksiteAddress: 'Rancagua, Región del Libertador',
  sstManagementPlan: 'Plan de gestión SST mensual con KPIs.',
  managementSystemDescription: 'Sistema basado en ISO 45001:2018.',
  supervisionScheme: 'Supervisión diaria por jefe de faena.',
  trainingItems: [
    { topic: 'Trabajo en altura', hours: 8 },
    { topic: 'Espacios confinados', hours: 4 },
  ],
  susesoFiscalizationRecord: 'Última fiscalización: 2026-04-15 — sin observaciones.',
};

describe('formatDs76Folio + parseDs76Folio', () => {
  it('produces the documented shape', () => {
    expect(formatDs76Folio(2026, 'praeventio', 3)).toBe(
      'DS76-2026-praevent-000003',
    );
  });

  it('round-trips parseDs76Folio', () => {
    const f = formatDs76Folio(2026, 'praeventio', 3);
    expect(parseDs76Folio(f)).toEqual({
      year: 2026,
      tenantSlug: 'praevent',
      seq: 3,
    });
  });

  it('rejects DS-67 folios', () => {
    expect(parseDs76Folio('DS67-2026-praevent-000001')).toBeNull();
  });
});

describe('createDs76Form', () => {
  it('allocates a folio and returns PDF magic bytes + hash', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const result = await createDs76Form(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    expect(result.form.folio).toBe('DS76-2026-praevent-000001');
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(...result.pdfBytes.slice(0, 4))).toBe('%PDF');
    expect(result.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.form.payloadHashHex).toBe(result.payloadHashHex);
    expect(result.form.payloadRendererVersion).toBe(1);
  });

  it('recomputes the authoritative unsigned digest independently of signature evidence', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs76Form(baseInput, {
      folioStore,
      formStore,
      now: () => new Date('2026-05-04T15:00:00.000Z'),
    });
    const signedView: Ds76Form = {
      ...form,
      signature: {
        signerUid: 'other', signerRut: '1-9', signedAt: '2099-01-01T00:00:00.000Z',
        algorithm: 'kms-sign-rsa', signatureB64: 'other', payloadHashHex: 'f'.repeat(64),
      },
    };

    expect((await renderDs76UnsignedPayload(signedView)).payloadHashHex).toBe(payloadHashHex);
  });

  it('persists the form so it can be loaded back', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs76Form(baseInput, { folioStore, formStore });
    const loaded = await formStore.loadForm('praeventio', ds76FolioToDocId(form.folio));
    expect(loaded).not.toBeNull();
    expect(loaded?.trainingItems.length).toBe(2);
  });

  it('rejects missing required fields', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await expect(
      createDs76Form(
        { ...baseInput, contractorCompanyName: '' },
        { folioStore, formStore },
      ),
    ).rejects.toThrow(/contractorCompanyName required/);
  });

  it('uses an independent counter from DS-67', async () => {
    // Concretely: two calls produce 000001 then 000002 because DS-76
    // counter is independent of DS-67/DIAT/DIEP counters.
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const a = await createDs76Form(baseInput, { folioStore, formStore });
    const b = await createDs76Form(baseInput, { folioStore, formStore });
    expect(a.form.folio).toBe('DS76-2026-praevent-000001');
    expect(b.form.folio).toBe('DS76-2026-praevent-000002');
  });
});

describe('signForm + listVersions', () => {
  const validSig: Ds76Signature = {
    signerUid: 'u1',
    signerRut: '14.444.444-K',
    signedAt: '2026-05-04T16:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: 'AAAA',
    payloadHashHex: 'a'.repeat(64),
  };

  it('attaches signature and refuses re-sign', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form } = await createDs76Form(baseInput, { folioStore, formStore });
    const fid = ds76FolioToDocId(form.folio);
    await signForm('praeventio', fid, validSig, { formStore });
    await expect(
      signForm('praeventio', fid, validSig, { formStore }),
    ).rejects.toThrow(/already signed/);
  });

  it('listVersions returns all forms for tenant', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    await createDs76Form(baseInput, { folioStore, formStore });
    await createDs76Form(baseInput, { folioStore, formStore });
    const versions = await listVersions('praeventio', { formStore });
    expect(versions.length).toBe(2);
  });
});
