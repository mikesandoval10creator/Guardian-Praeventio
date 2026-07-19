// Praeventio Guard — Sprint 35 audit P0 (DIAT/DIEP digital-signature flow).
//
// AUDIT CONTEXT
// -------------
// Chilean SUSESO requires legally-signed copies of DS-67 (Reglamento Interno)
// and DS-76 (Reglamento Subcontratación / Mining) on every fiscalisation
// inspection. The route handlers live in src/server/routes/ds67ds76.ts and
// expose:
//
//   POST /api/compliance/ds67               — admin/gerente create (Zod)
//   POST /api/compliance/ds67/:formId/sign  — attach WebAuthn signature
//   POST /api/compliance/ds76               — admin/gerente create (Zod)
//   POST /api/compliance/ds76/:formId/sign  — attach WebAuthn signature
//
// Sprint 31 PP shipped service-level coverage (createDs67Form,
// signForm) but never tested the full create→sign→re-sign-rejected loop
// at integration level. This file fills that gap by:
//
//   1. Driving the same `signForm` service contract the route handler
//      uses (1:1 — see ds67ds76.ts:221 / :292).
//   2. Asserting the signed document carries `signature.signedAt`
//      non-empty AND signature.algorithm = 'webauthn-ecdsa-p256'
//      (the mark that the WebAuthn assertion was successfully parsed
//      by the route's validate(signSchema) Zod gate before delegation).
//   3. Verifying re-sign attempts on an already-signed folio are
//      rejected (legal traceability — every modification MUST be a
//      new folio per SUSESO).
//   4. Verifying malformed signatures fail Zod-equivalent checks at the
//      service layer.
//
// We test the SERVICE layer (createDs67Form + signForm) rather than the
// HTTP layer for two reasons:
//   • The route's verifyAuth + validate(signSchema) middleware are
//     already covered by validateMiddleware.integration.test.ts and
//     verifyAuthE2E.test.ts.
//   • The signature material itself is opaque base64 — there's no
//     value in routing through Express to assert "string → string"
//     pass-through.
//
// What we do NOT cover here (justified skips):
//   • XML <Signature> block presence — the production DS-67/DS-76
//     pipeline emits PDF (not XML); the audit ask references DIAT/DIEP
//     which are functionally equivalent at the legal-traceability layer
//     but use different envelope formats. PDF byte-for-byte content is
//     covered by utils/ds67Certificate.ts internal tests.
//   • Worker role 403 — the role gate is in the route handler's
//     verifyAuth/middleware stack, exercised by validateMiddleware
//     integration tests against shared fixtures.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDs67Form,
  signForm as signDs67Form,
  ds67FolioToDocId,
  type MinimalDs67FormStore,
} from '../../services/compliance/ds67/ds67Service.js';
import {
  createDs76Form,
  signForm as signDs76Form,
  ds76FolioToDocId,
  type MinimalDs76FormStore,
} from '../../services/compliance/ds76/ds76Service.js';
import type { Ds67Form, Ds67Signature } from '../../services/compliance/ds67/types.js';
import type { Ds76Form, Ds76Signature } from '../../services/compliance/ds76/types.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';
import {
  buildWebAuthnComplianceSignature,
  buildKmsComplianceSignature,
} from '../../services/compliance/complianceSignature.js';

/**
 * signForm now rejects evidence that isn't cryptographically BOUND to the form
 * (a hand-rolled `{ signerUid, algorithm, signatureB64 }` literal is classified
 * `legacy-unverifiable`). These integration tests are about the SIGNING FLOW —
 * signedAt, algorithm preservation, re-sign rejection — not about evidence
 * shape, so they hand `signForm` a properly bound WebAuthn signature.
 * `algorithm` stays `webauthn-ecdsa-p256`, which is what they assert.
 */
function boundWebAuthnSig(args: {
  tenantId: string;
  formId: string;
  documentKind: 'ds67' | 'ds76';
  payloadHashHex: string;
  signerUid: string;
  signerRut: string;
}) {
  const assertion = {
    credentialId: 'cred-1',
    rawId: 'cmF3SWQ=',
    clientDataJSON: 'eyJ0eXBlIjoicHVibGljLWtleS1nZXQifQ==',
    authenticatorData: 'YXV0aERhdGE=',
    signature: 'd2ViYXV0aG5zaWduZWQ=',
    type: 'public-key' as const,
    clientExtensionResults: {},
  };
  return {
    ...buildWebAuthnComplianceSignature({
      intent: {
        version: 1,
        purpose: 'compliance-document-sign',
        tenantId: args.tenantId,
        formId: args.formId,
        documentKind: args.documentKind,
        action: 'sign',
        payloadHashHex: args.payloadHashHex,
        signerUid: args.signerUid,
        signerRut: args.signerRut,
        issuedAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_300_000,
        nonceB64u: 'AQIDBA',
      },
      signer: { kind: 'human', uid: args.signerUid, rut: args.signerRut },
      assertion,
      verifiedCredentialId: assertion.credentialId,
      verificationKey: {
        publicKeyB64: 'cHVibGljLWtleQ==',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
    }),
    archiveAttestation: {
      version: 1 as const,
      keyId: 'dte-sign-integration-test',
      macB64u: 'a'.repeat(43),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory store fixtures — mirror ds67Service.test.ts so behaviour
// changes in the service propagate identically here.
// ───────────────────────────────────────────────────────────────────────────

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

function buildDs67Store(): MinimalDs67FormStore {
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

function buildDs76Store(): MinimalDs76FormStore {
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

// 64-char lowercase hex (production-shaped — sha256 digest of payload).
const VALID_HASH = 'a'.repeat(64);
const VALID_SIG_B64 = Buffer.from('valid-webauthn-assertion-bytes').toString('base64');

const ds67Input = {
  tenantId: 'praeventio',
  companyName: 'Constructora Andes Ltda.',
  companyRut: '76.543.210-K',
  companyAddress: 'Av. Apoquindo 1234, Las Condes',
  scopeOfApplication: 'Aplica a todo el personal de la empresa.',
  workerObligations: ['Usar EPP', 'Reportar incidentes'],
  workerProhibitions: ['Operar equipos sin certificación'],
  sanctions: 'Amonestación verbal, escrita y multa.',
  complaintProcedure: 'Presentar reclamo ante el CPHS dentro de 5 días hábiles.',
  effectiveFrom: '2026-06-01T00:00:00.000Z',
};

const ds76Input = {
  tenantId: 'praeventio',
  principalCompanyName: 'Minera del Norte SA',
  principalCompanyRut: '76.111.111-1',
  contractorCompanyName: 'Servicios Mineros Ltda.',
  contractorCompanyRut: '76.222.222-2',
  worksiteName: 'Faena El Salvador',
  worksiteAddress: 'Ruta C-17 km 25, Atacama',
  sstManagementPlan: 'Plan SST conforme DS-76.',
  managementSystemDescription: 'SGSST integrado por el principal.',
  supervisionScheme: 'CPHS faena con representantes ambas empresas.',
  trainingItems: [{ topic: 'Trabajos en altura', hours: 8 }],
  susesoFiscalizationRecord: 'Inscrito en SUSESO faena codificada.',
};

// ───────────────────────────────────────────────────────────────────────────
// DS-67 — create + sign + re-sign rejected
// ───────────────────────────────────────────────────────────────────────────

describe('DTE/DIAT firma digital — DS-67 create→sign integration', () => {
  let folioStore: MinimalFolioStore;
  let formStore: MinimalDs67FormStore;

  beforeEach(() => {
    folioStore = buildFolioStore();
    formStore = buildDs67Store();
  });

  it('create returns a form + PDF bytes + payload hash (signedAt unset until sign)', async () => {
    const result = await createDs67Form(ds67Input, { folioStore, formStore });
    expect(result.form.folio).toMatch(/^DS67-\d{4}-[a-z0-9]{8}-\d{6}$/);
    expect(result.form.signature).toBeUndefined();
    expect(result.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    // PDF magic bytes.
    expect(Buffer.from(result.pdfBytes).slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('signForm attaches WebAuthn signature → signedAt non-empty + algorithm preserved', async () => {
    const created = await createDs67Form(ds67Input, { folioStore, formStore });
    const signature = boundWebAuthnSig({
      tenantId: ds67Input.tenantId,
      formId: ds67FolioToDocId(created.form.folio),
      documentKind: 'ds67',
      payloadHashHex: created.payloadHashHex,
      signerUid: 'admin-uid-1',
      signerRut: '11.111.111-1',
    }) as unknown as Ds67Signature;
    const signed = await signDs67Form(
      ds67Input.tenantId,
      ds67FolioToDocId(created.form.folio),
      signature,
      { formStore },
    );
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.signedAt).toBeTruthy();
    expect(signed.signature?.signedAt.length).toBeGreaterThan(0);
    expect(signed.signature?.algorithm).toBe('webauthn-ecdsa-p256');
    expect(signed.signature?.payloadHashHex).toBe(created.payloadHashHex);
  });

  it('re-sign of a signed folio is rejected — legal traceability requires a new folio', async () => {
    const created = await createDs67Form(ds67Input, { folioStore, formStore });
    const signature = boundWebAuthnSig({
      tenantId: ds67Input.tenantId,
      formId: ds67FolioToDocId(created.form.folio),
      documentKind: 'ds67',
      payloadHashHex: created.payloadHashHex,
      signerUid: 'admin-uid-1',
      signerRut: '11.111.111-1',
    }) as unknown as Ds67Signature;
    await signDs67Form(
      ds67Input.tenantId,
      ds67FolioToDocId(created.form.folio),
      signature,
      { formStore },
    );
    await expect(
      signDs67Form(
        ds67Input.tenantId,
        ds67FolioToDocId(created.form.folio),
        signature,
        { formStore },
      ),
    ).rejects.toThrow(/already signed/i);
  });

  it('malformed payloadHashHex (not 64 hex chars) is rejected', async () => {
    const created = await createDs67Form(ds67Input, { folioStore, formStore });
    const badSig: Ds67Signature = {
      signerUid: 'admin-uid-1',
      signerRut: '11.111.111-1',
      signedAt: new Date().toISOString(),
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: VALID_SIG_B64,
      payloadHashHex: 'not-a-real-hash',
    };
    await expect(
      signDs67Form(
        ds67Input.tenantId,
        ds67FolioToDocId(created.form.folio),
        badSig,
        { formStore },
      ),
    ).rejects.toThrow(/64-char|hex/i);
  });

  it('signature missing signerUid is rejected (audit-row anchor)', async () => {
    const created = await createDs67Form(ds67Input, { folioStore, formStore });
    const badSig = {
      signerUid: '',
      signerRut: '11.111.111-1',
      signedAt: new Date().toISOString(),
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: VALID_SIG_B64,
      payloadHashHex: created.payloadHashHex,
    } as Ds67Signature;
    await expect(
      signDs67Form(
        ds67Input.tenantId,
        ds67FolioToDocId(created.form.folio),
        badSig,
        { formStore },
      ),
    ).rejects.toThrow(/signer/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DS-76 — same shape as DS-67 but for the mining/subcontratación flow.
// ───────────────────────────────────────────────────────────────────────────

describe('DTE/DIAT firma digital — DS-76 create→sign integration', () => {
  let folioStore: MinimalFolioStore;
  let formStore: MinimalDs76FormStore;

  beforeEach(() => {
    folioStore = buildFolioStore();
    formStore = buildDs76Store();
  });

  it('create returns DS-76 form with mining-specific folio + payload hash', async () => {
    const result = await createDs76Form(ds76Input, { folioStore, formStore });
    expect(result.form.folio).toMatch(/^DS76-\d{4}-[a-z0-9]{8}-\d{6}$/);
    expect(result.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.form.signature).toBeUndefined();
  });

  it('signForm attaches WebAuthn signature with non-empty signedAt', async () => {
    const created = await createDs76Form(ds76Input, { folioStore, formStore });
    const signature = boundWebAuthnSig({
      tenantId: ds76Input.tenantId,
      formId: ds76FolioToDocId(created.form.folio),
      documentKind: 'ds76',
      payloadHashHex: created.payloadHashHex,
      signerUid: 'gerente-uid-1',
      signerRut: '22.222.222-2',
    }) as unknown as Ds76Signature;
    const signed = await signDs76Form(
      ds76Input.tenantId,
      ds76FolioToDocId(created.form.folio),
      signature,
      { formStore },
    );
    expect(signed.signature?.signedAt).toBeTruthy();
    expect(signed.signature?.algorithm).toBe('webauthn-ecdsa-p256');
  });

  it('re-sign rejected — DS-76 must mint a new folio per modification', async () => {
    const created = await createDs76Form(ds76Input, { folioStore, formStore });
    const signature = boundWebAuthnSig({
      tenantId: ds76Input.tenantId,
      formId: ds76FolioToDocId(created.form.folio),
      documentKind: 'ds76',
      payloadHashHex: created.payloadHashHex,
      signerUid: 'gerente-uid-1',
      signerRut: '22.222.222-2',
    }) as unknown as Ds76Signature;
    await signDs76Form(
      ds76Input.tenantId,
      ds76FolioToDocId(created.form.folio),
      signature,
      { formStore },
    );
    await expect(
      signDs76Form(
        ds76Input.tenantId,
        ds76FolioToDocId(created.form.folio),
        signature,
        { formStore },
      ),
    ).rejects.toThrow(/already signed/i);
  });

  it('alternate algorithm (kms-sign-rsa) is accepted by the service layer', async () => {
    const created = await createDs76Form(ds76Input, { folioStore, formStore });
    // Bound KMS evidence — this test asserts the service accepts the
    // `kms-sign-rsa` algorithm, so it needs the KMS shape, not WebAuthn.
    const signature = {
      ...buildKmsComplianceSignature({
        context: {
          tenantId: ds76Input.tenantId,
          formId: ds76FolioToDocId(created.form.folio),
          documentKind: 'ds76',
          payloadHashHex: created.payloadHashHex,
          signerUid: 'admin-uid-2',
          signerRut: '33.333.333-3',
        },
        signer: { uid: 'admin-uid-2', rut: '33.333.333-3', kind: 'kms' },
        signatureB64: VALID_SIG_B64,
        keyVersion: 'key/7',
        publicKeyPem: 'server-verified-public-key',
      }),
      archiveAttestation: {
        version: 1 as const,
        keyId: 'dte-sign-integration-test',
        macB64u: 'a'.repeat(43),
      },
    } as unknown as Ds76Signature;
    const signed = await signDs76Form(
      ds76Input.tenantId,
      ds76FolioToDocId(created.form.folio),
      signature,
      { formStore },
    );
    expect(signed.signature?.algorithm).toBe('kms-sign-rsa');
  });
});
