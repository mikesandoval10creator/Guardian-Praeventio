// Praeventio Guard — Sprint 33 wire W6.
//
// Country gate tests for DS-67 signForm. DS 67/1999 is Chile-specific
// (rooted in Ley 16.744 + DS 67 MINSAL). Non-CL tenants MUST hit the
// JurisdictionNotSupportedError path (HTTP 400 at the route layer).
// See ADR-0014 (Regulatory Framework Abstraction).

import { describe, it, expect, vi } from 'vitest';
import {
  createDs67Form,
  signForm,
  ds67FolioToDocId,
  JurisdictionNotSupportedError,
  type MinimalDs67FormStore,
} from './ds67Service';
import type { Ds67Form, Ds67Signature } from './types';
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
      const updated: Ds67Form = { ...cur, signature };
      byTenantId.get(tid)!.set(fid, updated);
      return updated;
    },
  };
}

const baseInput = {
  tenantId: 'tenant-cl-1',
  companyName: 'Acme SpA',
  companyRut: '76.123.456-7',
  companyAddress: 'Av. Apoquindo 123, Las Condes',
  scopeOfApplication: 'Aplica a todos los trabajadores.',
  workerObligations: ['Usar EPP'],
  workerProhibitions: ['Operar bajo influencia de alcohol'],
  sanctions: 'Amonestación / multa 25% IMM.',
  complaintProcedure: 'Procedimiento ante CPHS y Mutual.',
  effectiveFrom: '2026-01-01',
};

function buildSig(payloadHashHex: string): Ds67Signature {
  return {
    signerUid: 'uid-1',
    signerRut: '11.111.111-1',
    signedAt: '2026-05-05T00:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: 'AAAA',
    payloadHashHex,
  };
}

describe('DS-67 signForm — country gate (Sprint 33 W6)', () => {
  it('Chile: signForm OK (default + explicit CL resolver)', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs67Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds67FolioToDocId(form.folio);

    // Explicit CL resolver — happy path.
    const signed = await signForm(
      baseInput.tenantId,
      formId,
      buildSig(payloadHashHex),
      { formStore, resolveCountry: async () => 'CL' },
    );
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.payloadHashHex).toBe(payloadHashHex);
  });

  it('non-Chile country: throws JurisdictionNotSupportedError (maps to HTTP 400)', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs67Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds67FolioToDocId(form.folio);

    await expect(
      signForm(baseInput.tenantId, formId, buildSig(payloadHashHex), {
        formStore,
        resolveCountry: async () => 'MX',
      }),
    ).rejects.toMatchObject({
      name: 'JurisdictionNotSupportedError',
      code: 'jurisdiction_not_supported_yet',
      country: 'MX',
      docType: 'DS67',
    });

    // Form must remain unsigned (defense-in-depth).
    const stored = await formStore.loadForm(baseInput.tenantId, formId);
    expect(stored?.signature).toBeUndefined();

    // Suggested adapter list cites OSHA / EU-OSHA / RIDDOR / STPS / CIPA.
    try {
      await signForm(baseInput.tenantId, formId, buildSig(payloadHashHex), {
        formStore,
        resolveCountry: async () => 'BR',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JurisdictionNotSupportedError);
      const e = err as JurisdictionNotSupportedError;
      expect(e.suggestedAdapters.join(' ')).toMatch(/OSHA|EU-OSHA|RIDDOR|NR-5|STPS/);
    }
  });

  it('resolver throws → defaults to CL + audit warn (defense-in-depth)', async () => {
    const folioStore = buildFolioStore();
    const formStore = buildFormStore();
    const { form, payloadHashHex } = await createDs67Form(baseInput, {
      folioStore,
      formStore,
    });
    const formId = ds67FolioToDocId(form.folio);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const signed = await signForm(
        baseInput.tenantId,
        formId,
        buildSig(payloadHashHex),
        {
          formStore,
          resolveCountry: async () => {
            throw new Error('locationNormativa offline');
          },
        },
      );
      expect(signed.signature).toBeDefined(); // CL fallback succeeded
      expect(warnSpy).toHaveBeenCalled();
      const firstCall = warnSpy.mock.calls[0]!.join(' ');
      expect(firstCall).toMatch(/resolveCountry threw/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
