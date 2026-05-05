// Sprint 32 wire W4 — verifica que signForm DS76 invoca awardXp
// con reason 'compliance_doc_generated' fire-and-forget.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const awardXpMock = vi.fn();
vi.mock('../../gamification/positiveXp.js', () => ({
  awardXp: (...args: unknown[]) => awardXpMock(...args),
}));

import {
  createDs76Form,
  signForm,
  ds76FolioToDocId,
  type MinimalDs76FormStore,
} from './ds76Service';
import type { Ds76Form } from './types';
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
      if (!bucket) {
        bucket = new Map();
        byTenantId.set(tid, bucket);
      }
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
  principalCompanyName: 'Codelco',
  principalCompanyRut: '61.704.000-K',
  contractorCompanyName: 'Andes Ltda',
  contractorCompanyRut: '76.543.210-K',
  worksiteName: 'Faena Sewell',
  worksiteAddress: 'Rancagua',
  sstManagementPlan: 'plan',
  managementSystemDescription: 'iso45001',
  supervisionScheme: 'diaria',
  trainingItems: [{ topic: 'altura', hours: 8 }],
  susesoFiscalizationRecord: 'ok',
};

beforeEach(() => awardXpMock.mockReset());

describe('ds76 signForm — XP hook', () => {
  it('awards compliance_doc_generated with DS76 docType + signerUid ctx', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs76Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds76FolioToDocId(form.folio);
    await signForm(
      'praeventio',
      formId,
      {
        signerUid: 'mgr-7',
        signerRut: '22.222.222-2',
        signedAt: '2026-06-02T00:00:00.000Z',
        signatureB64: 'sig',
        payloadHashHex,
        algorithm: 'ES256',
      } as any,
      { formStore },
    );
    const calls = awardXpMock.mock.calls.filter(
      (c) => c[0] === 'compliance_doc_generated',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({
      docType: 'DS76',
      folio: form.folio,
      signerUid: 'mgr-7',
    });
  });
});
