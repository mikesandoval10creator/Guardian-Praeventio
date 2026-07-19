// Sprint 32 wire W4 — verifica que signForm invoca awardXp con
// reason 'compliance_doc_generated' fire-and-forget.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const awardXpMock = vi.fn();
vi.mock('../../gamification/positiveXp.js', () => ({
  awardXp: (...args: unknown[]) => awardXpMock(...args),
}));

import {
  createDs67Form,
  signForm,
  ds67FolioToDocId,
  type MinimalDs67FormStore,
} from './ds67Service';
import type { Ds67Form } from './types';
import { buildKmsComplianceSignature } from '../complianceSignature';
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

function buildFormStore(): MinimalDs67FormStore {
  const byTenantId = new Map<string, Map<string, Ds67Form>>();
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
  companyName: 'Constructora Andes Ltda.',
  companyRut: '76.543.210-K',
  companyAddress: 'Av. Apoquindo 1234',
  scopeOfApplication: 'Aplica a todo el personal',
  workerObligations: ['EPP'],
  workerProhibitions: ['No alcohol'],
  sanctions: 'Amonestación.',
  complaintProcedure: 'CPHS 5 dias.',
  effectiveFrom: '2026-06-01T00:00:00.000Z',
};

beforeEach(() => awardXpMock.mockReset());

describe('ds67 signForm — XP hook', () => {
  it('awards compliance_doc_generated with DS67 docType and signerUid ctx', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs67Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds67FolioToDocId(form.folio);
    await signForm(
      'praeventio',
      formId,
      // signForm now rejects unbound evidence, so this must be a properly
      // bound signature. The signer stays 'mgr-1' — that's what the XP
      // assertion below is about.
      {
        ...buildKmsComplianceSignature({
          context: {
            tenantId: 'praeventio',
            formId,
            documentKind: 'ds67',
            payloadHashHex,
            signerUid: 'mgr-1',
            signerRut: '11.111.111-1',
          },
          signer: { uid: 'mgr-1', rut: '11.111.111-1', kind: 'kms' },
          signatureB64: 'sigB64',
          keyVersion: 'key/7',
          publicKeyPem: 'server-verified-public-key',
        }),
        archiveAttestation: {
          version: 1,
          keyId: 'xp-hook-test',
          macB64u: 'a'.repeat(43),
        },
      } as any,
      { formStore },
    );
    const calls = awardXpMock.mock.calls.filter(
      (c) => c[0] === 'compliance_doc_generated',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({
      docType: 'DS67',
      folio: form.folio,
      signerUid: 'mgr-1',
    });
  });
});
