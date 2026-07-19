// Praeventio Guard — Sprint 33 wire W6.
//
// Country gate tests for DS-76 signForm. DS 76/2007 (Reglamento Especial
// Subcontratación) is Chile-specific (Ley 16.744 + Ley 20.123). Non-CL
// projects must use their own emission adapter (ADR-0014).

import { describe, it, expect, vi } from 'vitest';
import {
  createDs76Form,
  signForm,
  ds76FolioToDocId,
  type MinimalDs76FormStore,
} from './ds76Service';
import { JurisdictionNotSupportedError } from '../ds67/ds67Service';
import type { Ds76Form, Ds76Signature } from './types';
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
      const updated: Ds76Form = { ...cur, signature };
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
  trainingItems: [{ topic: 'Trabajo en altura', hours: 8 }],
  susesoFiscalizationRecord: 'Última fiscalización: 2026-04-15.',
};

// signForm now requires BOUND evidence carrying an archive attestation (a
// hand-rolled minimal signature is classified `legacy-unverifiable` and
// rejected). These tests are about the COUNTRY gate, not signature shape, so
// they hand it a properly bound signature — same shape as the sibling
// ds76Service.test.ts helper.
function buildSig(formId: string, payloadHashHex: string): Ds76Signature {
  return {
    ...buildKmsComplianceSignature({
      context: {
        tenantId: baseInput.tenantId,
        formId,
        documentKind: 'ds76',
        payloadHashHex,
        signerUid: 'kms-signer',
        signerRut: '14.444.444-K',
      },
      signer: { uid: 'kms-signer', rut: '14.444.444-K', kind: 'kms' },
      signatureB64: 'server-verified-signature',
      keyVersion: 'key/7',
      publicKeyPem: 'server-verified-public-key',
    }),
    archiveAttestation: {
      version: 1,
      keyId: 'country-gate-test',
      macB64u: 'a'.repeat(43),
    },
  };
}

describe('DS-76 signForm — country gate (Sprint 33 W6)', () => {
  it('Chile: signForm OK', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs76Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds76FolioToDocId(form.folio);

    const signed = await signForm(
      baseInput.tenantId,
      formId,
      buildSig(formId, payloadHashHex),
      { formStore, resolveCountry: async () => 'CL' },
    );
    expect(signed.signature).toBeDefined();
  });

  it('non-Chile country: throws JurisdictionNotSupportedError', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs76Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds76FolioToDocId(form.folio);

    await expect(
      signForm(baseInput.tenantId, formId, buildSig(formId, payloadHashHex), {
        formStore,
        resolveCountry: async () => 'PE',
      }),
    ).rejects.toMatchObject({
      name: 'JurisdictionNotSupportedError',
      code: 'jurisdiction_not_supported_yet',
      country: 'PE',
      docType: 'DS76',
    });

    const stored = await formStore.loadForm(baseInput.tenantId, formId);
    expect(stored?.signature).toBeUndefined();
  });

  it('resolver throws → defaults to CL + audit warn', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs76Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds76FolioToDocId(form.folio);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const signed = await signForm(
        baseInput.tenantId,
        formId,
        buildSig(formId, payloadHashHex),
        {
          formStore,
          resolveCountry: async () => {
            throw new Error('locationNormativa unreachable');
          },
        },
      );
      expect(signed.signature).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
      const firstCall = warnSpy.mock.calls[0]!.join(' ');
      expect(firstCall).toMatch(/resolveCountry threw/);

      // Sanity: doesn't throw the typed error in fallback. (Signer is the KMS
      // identity the bound fixture above signs with.)
      expect(signed.signature?.signerUid).toBe('kms-signer');
      // Suppress unused-import lint by referencing the symbol.
      expect(JurisdictionNotSupportedError.name).toBe(
        'JurisdictionNotSupportedError',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
