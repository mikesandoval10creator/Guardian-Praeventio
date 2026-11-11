// SPDX-License-Identifier: MIT
//
// Issue #1919 — SUSESO DIAT/DIEP forms are a SERVER-WRITE-ONLY boundary.
//
// Path under test: tenants/{tenantId}/suseso_forms/{formId}
//
// The contract this suite pins:
//
//   1. NO client create, for ANY caller. Not an unauthenticated caller, not
//      a worker, not an admin/gerente, not a supervisor/prevencionista, not
//      an occupational doctor, not a worker of ANOTHER tenant, not a
//      privileged caller of ANOTHER tenant, not a privileged caller with NO
//      tenant binding at all, and not a payload that already carries a
//      signature. The only creator of a SUSESO form is the authenticated
//      server route
//      (src/server/routes/suseso.ts → POST /api/suseso/form), which writes
//      through the Admin SDK and derives the tenant from the verified token.
//
//   2. Tenant-scoped READS are preserved (tenant admin / gerente /
//      supervisor / occupational doctor / project member). A member of
//      another tenant still cannot read.
//
//   3. Client update/delete stay denied — forms are immutable; the
//      signature is attached by the Admin SDK only.
//
//   4. A server-side write (the Admin SDK bypasses Firestore rules exactly
//      like `withSecurityRulesDisabled` does here) still lands the document
//      at the path the server route uses — the rule change must not affect
//      it — and the resulting document stays readable by the tenant.
//
//   5. A denied client write can NEVER surface through the public QR
//      verifier as a verified form, while a server-written form still
//      verifies (including legacy renderer-v1 documents).
//
// F1 fail-closed harness + `authenticatedContext` for every assertion —
// NEVER the Admin SDK in an assertion. `withSecurityRulesDisabled` only
// stands in for the server-side writer (the Admin SDK), to seed the
// server-written documents and to read back what the server wrote.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';
import {
  verifyFolio,
  renderSusesoUnsignedPayload,
  type MinimalFormStore,
} from '../services/suseso/susesoService';
import type { SusesoForm, SusesoSignature } from '../services/suseso/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TENANT = 'tenant-suseso-1';
const OTHER_TENANT = 'tenant-suseso-2';
const PROJECT = 'proj-suseso-1';
const WORKER_UID = 'worker-uid-suseso-1';
const OTHER_WORKER_UID = 'worker-uid-suseso-2';

// Folio format: KIND-YYYY-<8 alnum slug>-<6 digits> (see folioGenerator.ts).
const FOLIO = 'DIAT-2026-suseso01-000001';
const FORM_ID = FOLIO.toLowerCase();

/** The record shape the server persists (see createSusesoForm). */
function buildServerForm(): SusesoForm {
  return {
    kind: 'DIAT',
    folio: FOLIO,
    workerRut: '12.345.678-9',
    workerFullName: 'Juan Trabajador',
    companyRut: '76.543.210-K',
    companyName: 'Empresa Minera S.A.',
    mutualidad: 'achs',
    incidentDate: '2026-05-31T08:00:00Z',
    incidentDescription: 'Caída desde altura en nivel 3',
    incidentLocation: 'Mina Norte, Nivel 3',
    bodyPartsAffected: ['cabeza', 'hombro_derecho'],
    incidentClassification: 'accidente_trabajo',
    witnesses: [{ fullName: 'Pedro Testigo', rut: '11.111.111-1' }],
    reportedBy: { uid: 'reporter-uid', rut: '13.333.333-3', fullName: 'María Supervisor' },
    createdAt: '2026-05-31T08:00:00.000Z',
    qrCodeUrl: `/verificar/${FOLIO}`,
    payloadRendererVersion: 2,
  };
}

/** A signature the server would attach (WebAuthn / KMS), used as a control. */
const SERVER_SIGNATURE: SusesoSignature = {
  signerUid: 'signer-uid',
  signerRut: '14.444.444-K',
  signedAt: '2026-05-31T09:00:00.000Z',
  algorithm: 'webauthn-ecdsa-p256',
  signatureB64: 'c2lnbmVkYnlrb3M=',
  payloadHashHex: 'a'.repeat(64),
};

/**
 * A client-supplied payload that already carries a signature. Even with a
 * signature attached, a direct client create must be refused — the server
 * binds the signature to the verified caller, the rendered payload and the
 * compliance evidence; a client cannot hand itself one.
 */
function buildForgedSignedPayload() {
  return {
    ...buildServerForm(),
    signature: {
      signerUid: 'forged-signer-uid',
      signerRut: '99.999.999-9',
      signedAt: '2099-01-01T00:00:00.000Z',
      algorithm: 'kms-sign-rsa',
      signatureB64: 'Zm9yZ2Vk',
      payloadHashHex: 'b'.repeat(64),
    },
  };
}

// ─── Environment ───────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  testEnv = await createRulesTestEnv();
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

type CtxDb = Firestore;

/** A rules-enforcing client bound to `uid` with the given custom claims. */
function clientDb(uid: string, claims: Record<string, unknown> = {}): CtxDb {
  return requireEnv()
    .authenticatedContext(uid, {
      email: `${uid}@example.com`,
      email_verified: true,
      ...claims,
    })
    .firestore() as unknown as CtxDb;
}

/** A rules-enforcing client with NO authentication at all. */
function anonymousDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
}

/**
 * Runs `fn` against the rules-disabled (server-side) Firestore.
 *
 * The Admin SDK bypasses Firestore rules by design; `withSecurityRulesDisabled`
 * is the rules-unit-testing equivalent of that bypass, so it stands in for the
 * server route's Admin SDK writer here. It is never used to satisfy a
 * client-permission assertion — only to seed and to read back server writes.
 */
async function withServer<T>(fn: (db: CtxDb) => Promise<T>): Promise<T> {
  let result!: T;
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    result = await fn(ctx.firestore() as unknown as CtxDb);
  });
  return result;
}

function formRef(db: CtxDb, tenantId: string, formId: string) {
  return doc(db, 'tenants', tenantId, 'suseso_forms', formId);
}

/** The server-side form store, mirroring src/server/routes/suseso.ts. */
function buildServerFormStore(): MinimalFormStore {
  const serverFormRef = (db: CtxDb, tenantId: string, formId: string) =>
    doc(db, 'tenants', tenantId, 'suseso_forms', formId);
  return {
    async saveForm(tenantId, formId, form) {
      await withServer(async (db) => {
        await setDoc(serverFormRef(db, tenantId, formId), form as unknown as Record<string, unknown>);
      });
    },
    async loadForm(tenantId, formId) {
      return withServer(async (db) => {
        const snap = await getDoc(serverFormRef(db, tenantId, formId));
        return snap.exists() ? (snap.data() as SusesoForm) : null;
      });
    },
    async findFormByFolio(folio) {
      return withServer(async (db) => {
        const snap = await getDocs(
          query(collectionGroup(db, 'suseso_forms'), where('folio', '==', folio), limit(2)),
        );
        if (snap.empty) return null;
        if (snap.docs.length > 1) return { ambiguous: true };
        const found = snap.docs[0];
        const tenantId = found.ref.parent.parent?.id ?? '';
        return { tenantId, formId: found.id, form: found.data() as SusesoForm };
      });
    },
    async attachSignature(tenantId, formId, signature) {
      return withServer(async (db) => {
        const ref = serverFormRef(db, tenantId, formId);
        await updateDoc(ref, { signature });
        const snap = await getDoc(ref);
        return snap.data() as SusesoForm;
      });
    },
  };
}

/** Server-side seeding: the project a form belongs to + a server-written form. */
async function seedProject() {
  await withServer(async (db) => {
    await setDoc(doc(db, 'projects', PROJECT), {
      tenantId: TENANT,
      members: [WORKER_UID],
      createdBy: 'creator-uid-suseso-1',
    });
  });
}

async function seedServerForm(form: SusesoForm, tenantId = TENANT, formId = FORM_ID) {
  await withServer(async (db) => {
    await setDoc(
      doc(db, 'tenants', tenantId, 'suseso_forms', formId),
      form as unknown as Record<string, unknown>,
    );
  });
}

async function serverDocExists(tenantId: string, formId: string): Promise<boolean> {
  return withServer(async (db) =>
    (await getDoc(doc(db, 'tenants', tenantId, 'suseso_forms', formId))).exists(),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('suseso_forms — server-write-only create (issue #1919)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  describe('client create is denied for every caller', () => {
    it('denies an UNAUTHENTICATED caller', async () => {
      await assertFails(
        setDoc(
          formRef(anonymousDb(), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a WORKER of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb(WORKER_UID, { role: 'worker', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a WORKER of ANOTHER tenant writing into this tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb(OTHER_WORKER_UID, { role: 'worker', tenantId: OTHER_TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
      expect(await serverDocExists(TENANT, FORM_ID)).toBe(false);
    });

    it('denies an OPERARIO of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('operario-uid', { role: 'operario', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies an ADMIN of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a GERENTE of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('gerente-uid', { role: 'gerente', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a SUPERVISOR of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('supervisor-uid', { role: 'supervisor', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a PREVENCIONISTA of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('prevencionista-uid', { role: 'prevencionista', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies an OCCUPATIONAL DOCTOR of the tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('doctor-uid', { role: 'medico_ocupacional', tenantId: TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies an ADMIN of ANOTHER tenant writing into this tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('other-admin-uid', { role: 'admin', tenantId: OTHER_TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a SUPERVISOR of ANOTHER tenant writing into this tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('other-supervisor-uid', { role: 'supervisor', tenantId: OTHER_TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies an OCCUPATIONAL DOCTOR of ANOTHER tenant writing into this tenant', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('other-doctor-uid', { role: 'medico_ocupacional', tenantId: OTHER_TENANT }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a privileged caller with NO tenant binding at all', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('unbound-admin-uid', { role: 'admin' }), TENANT, FORM_ID),
          buildServerForm() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('denies a create whose payload ALREADY carries a signature', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID),
          buildForgedSignedPayload() as unknown as Record<string, unknown>,
        ),
      );
    });

    it('leaves no document behind after a denied create', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID),
          buildForgedSignedPayload() as unknown as Record<string, unknown>,
        ),
      );
      expect(await serverDocExists(TENANT, FORM_ID)).toBe(false);
    });
  });

  describe('tenant-scoped reads are preserved', () => {
    beforeEach(async () => {
      await seedProject();
      await seedServerForm(buildServerForm());
    });

    it('allows the tenant ADMIN to read the form', async () => {
      await assertSucceeds(
        getDoc(formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });

    it('allows the tenant GERENTE to read the form', async () => {
      await assertSucceeds(
        getDoc(formRef(clientDb('gerente-uid', { role: 'gerente', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });

    it('allows the tenant SUPERVISOR to read the form', async () => {
      await assertSucceeds(
        getDoc(formRef(clientDb('supervisor-uid', { role: 'supervisor', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });

    it('allows the tenant OCCUPATIONAL DOCTOR to read the form', async () => {
      await assertSucceeds(
        getDoc(formRef(clientDb('doctor-uid', { role: 'medico_ocupacional', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });

    it('allows a PROJECT MEMBER (worker) to read a project-scoped form', async () => {
      await seedServerForm({ ...buildServerForm(), projectId: PROJECT } as SusesoForm, TENANT, 'project-scoped-form');
      await assertSucceeds(
        getDoc(formRef(clientDb(WORKER_UID, { role: 'worker', tenantId: TENANT }), TENANT, 'project-scoped-form')),
      );
    });

    it('denies a member of ANOTHER tenant', async () => {
      await assertFails(
        getDoc(formRef(clientDb(OTHER_WORKER_UID, { role: 'worker', tenantId: OTHER_TENANT }), TENANT, FORM_ID)),
      );
    });

    it('denies a privileged caller of ANOTHER tenant', async () => {
      await assertFails(
        getDoc(formRef(clientDb('other-admin-uid', { role: 'admin', tenantId: OTHER_TENANT }), TENANT, FORM_ID)),
      );
    });
  });

  describe('forms stay immutable for clients', () => {
    beforeEach(async () => {
      await seedServerForm(buildServerForm());
    });

    it('denies a client update (even for the tenant admin)', async () => {
      await assertFails(
        updateDoc(formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID), {
          status: 'tampered',
        }),
      );
    });

    it('denies a client update that would attach a signature', async () => {
      await assertFails(
        updateDoc(formRef(clientDb('supervisor-uid', { role: 'supervisor', tenantId: TENANT }), TENANT, FORM_ID), {
          signature: SERVER_SIGNATURE,
        }),
      );
    });

    it('denies a client delete (even for the tenant admin)', async () => {
      await assertFails(
        deleteDoc(formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });
  });

  describe('the server-side write path keeps working', () => {
    it('persists the form at the path the server route uses', async () => {
      await seedServerForm(buildServerForm());
      const folio = await withServer(async (db) => {
        const snap = await getDoc(doc(db, 'tenants', TENANT, 'suseso_forms', FORM_ID));
        return snap.data()?.folio;
      });
      expect(folio).toBe(FOLIO);
    });

    it('makes the server-written form readable by the tenant', async () => {
      await seedServerForm(buildServerForm());
      await assertSucceeds(
        getDoc(formRef(clientDb('supervisor-uid', { role: 'supervisor', tenantId: TENANT }), TENANT, FORM_ID)),
      );
    });

    it('still allows the server to attach the signature', async () => {
      await seedServerForm(buildServerForm());
      await withServer(async (db) => {
        await updateDoc(doc(db, 'tenants', TENANT, 'suseso_forms', FORM_ID), {
          signature: SERVER_SIGNATURE,
        });
      });
      const signature = await withServer(async (db) => {
        const snap = await getDoc(doc(db, 'tenants', TENANT, 'suseso_forms', FORM_ID));
        return snap.data()?.signature;
      });
      expect(signature).toBeTruthy();
    });
  });

  describe('QR verification regression — a denied client write is never a verified form', () => {
    it('a denied client create leaves nothing the public verifier can see', async () => {
      await assertFails(
        setDoc(
          formRef(clientDb('admin-uid', { role: 'admin', tenantId: TENANT }), TENANT, FORM_ID),
          buildForgedSignedPayload() as unknown as Record<string, unknown>,
        ),
      );

      const result = await verifyFolio(FOLIO, { formStore: buildServerFormStore() });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown_folio');
      expect(result.verificationStatus).not.toBe('verified');
      expect(result.signerRut).toBeUndefined();
    });

    it('CONTROL: the same form written by the server (Admin SDK path) DOES verify', async () => {
      const form = buildServerForm();
      const payload = await renderSusesoUnsignedPayload(form);
      await seedServerForm({
        ...form,
        payloadHashHex: payload.payloadHashHex,
        signature: SERVER_SIGNATURE,
      });

      const verifySignature = vi.fn(async () => ({ status: 'verified' as const }));
      const result = await verifyFolio(FOLIO, {
        formStore: buildServerFormStore(),
        verifySignature,
      });

      expect(result.valid).toBe(true);
      expect(result.verificationStatus).toBe('verified');
      expect(result.signerRut).toBe(SERVER_SIGNATURE.signerRut);
      expect(verifySignature).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            tenantId: TENANT,
            formId: FORM_ID,
            documentKind: 'suseso',
            payloadHashHex: payload.payloadHashHex,
          }),
          payloadBytes: expect.any(Uint8Array),
        }),
      );
    });

    it('LEGACY: a renderer-v1 form written by the server still verifies', async () => {
      const legacy = buildServerForm();
      delete legacy.qrCodeUrl;
      delete legacy.payloadRendererVersion;
      const v1 = await renderSusesoUnsignedPayload(legacy);
      await seedServerForm({
        ...legacy,
        payloadRendererVersion: 1,
        payloadHashHex: v1.payloadHashHex,
        signature: SERVER_SIGNATURE,
      });

      const verifySignature = vi.fn(async () => ({ status: 'verified' as const }));
      const result = await verifyFolio(FOLIO, {
        formStore: buildServerFormStore(),
        verifySignature,
      });

      expect(result.valid).toBe(true);
      expect(result.verificationStatus).toBe('verified');
    });

    it('LEGACY: a signed row without digest metadata stays UNVERIFIABLE (fail closed)', async () => {
      const legacy = buildServerForm();
      delete legacy.qrCodeUrl;
      delete legacy.payloadRendererVersion;
      await seedServerForm({ ...legacy, signature: SERVER_SIGNATURE });

      const result = await verifyFolio(FOLIO, { formStore: buildServerFormStore() });

      expect(result.valid).toBe(false);
      expect(result.verificationStatus).toBe('unverifiable');
      expect(result.reason).toBe('legacy_unverifiable');
    });
  });
});
