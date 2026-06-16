// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Signer tests.
//
// Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
// F4 (2026-06-16): the WebAuthn crypto now lives in the canonical verifier
// (injected as `verifyAssertion`); this module owns the BUSINESS rules.
import { describe, it, expect, vi } from 'vitest';
import {
  verifyAndSignCert,
  AptitudeCertSignError,
  type VerifyAndSignDeps,
} from './aptitudeCertSigner.js';
import { generateAptitudeCert, type AptitudeCertInput } from './aptitudeCertGenerator.js';

const baseInput: AptitudeCertInput = {
  workerUid: 'uid-worker-1',
  workerRut: '12.345.678-9',
  workerName: 'José Ñuñez Ávila',
  workerOccupation: 'Operario',
  doctorUid: 'uid-doc-1',
  doctorRut: '11.111.111-1',
  doctorName: 'Dra. Peña',
  doctorRsm: 'RSM-12345',
  examType: 'pre_empleo',
  examDate: '2026-05-05',
  fitnessVerdict: 'apto',
  restrictions: [],
  employerRut: '76.543.210-K',
  projectId: 'proj-alpha',
};

async function freshCert() {
  return generateAptitudeCert(baseInput, { now: () => new Date('2026-05-05T10:00:00Z') });
}

function req(certHash: string) {
  return {
    certHash,
    challengeId: 'chal-1',
    signerRut: '11.111.111-1',
    signedAt: '2026-05-05T10:05:00Z',
    signatureB64: 'sig==',
  };
}

const okVerdict = { verified: true as const, credentialId: 'cred-doc-1' };

describe('verifyAndSignCert', () => {
  it('valid request embeds the signature with the VERIFIED credentialId + caller uid', async () => {
    const { json, certHash } = await freshCert();
    const verifyAssertion = vi.fn<VerifyAndSignDeps['verifyAssertion']>().mockResolvedValue(okVerdict);
    const signed = await verifyAndSignCert(json, req(certHash), {
      caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
      verifyAssertion,
    });
    expect(signed.certHash).toBe(certHash);
    // Identity from the caller (verified token), provenance from the verifier.
    expect(signed.json.signature.signerUid).toBe('uid-doc-1');
    expect(signed.json.signature.credentialId).toBe('cred-doc-1');
    expect(signed.json.signature.payloadHashHex).toBe(certHash);
    expect(signed.json.signature.algorithm).toBe('webauthn-ecdsa-p256');
    expect(verifyAssertion).toHaveBeenCalledTimes(1);
  });

  it('rejects (cert_hash_mismatch) when certHash !== sha256(cert) — WITHOUT consuming the assertion', async () => {
    const { json } = await freshCert();
    const verifyAssertion = vi.fn<VerifyAndSignDeps['verifyAssertion']>().mockResolvedValue(okVerdict);
    await expect(
      verifyAndSignCert(json, req('f'.repeat(64)), {
        caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
        verifyAssertion,
      }),
    ).rejects.toMatchObject({ code: 'cert_hash_mismatch' });
    // A rejected request must NOT burn the single-use challenge.
    expect(verifyAssertion).not.toHaveBeenCalled();
  });

  it('rejects (doctor_role_required) for a non-doctor/admin caller — without consuming the assertion', async () => {
    const { json, certHash } = await freshCert();
    const verifyAssertion = vi.fn<VerifyAndSignDeps['verifyAssertion']>().mockResolvedValue(okVerdict);
    await expect(
      verifyAndSignCert(json, req(certHash), {
        caller: { uid: 'uid-doc-1', role: 'worker' },
        verifyAssertion,
      }),
    ).rejects.toMatchObject({ code: 'doctor_role_required' });
    expect(verifyAssertion).not.toHaveBeenCalled();
  });

  it('rejects (doctor_uid_mismatch) when a doctor signs someone else\'s cert', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(json, req(certHash), {
        caller: { uid: 'uid-OTHER-doctor', role: 'medico_ocupacional' },
        verifyAssertion: vi.fn<VerifyAndSignDeps['verifyAssertion']>().mockResolvedValue(okVerdict),
      }),
    ).rejects.toMatchObject({ code: 'doctor_uid_mismatch' });
  });

  it('rejects (signature_invalid) when the canonical verifier returns !verified', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(json, req(certHash), {
        caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
        verifyAssertion: vi
          .fn<VerifyAndSignDeps['verifyAssertion']>()
          .mockResolvedValue({ verified: false, reason: 'unknown_credential' }),
      }),
    ).rejects.toMatchObject({ code: 'signature_invalid' });
  });

  it('rejects (signature_invalid) when verified but no credentialId is returned', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(json, req(certHash), {
        caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
        verifyAssertion: vi
          .fn<VerifyAndSignDeps['verifyAssertion']>()
          .mockResolvedValue({ verified: true }),
      }),
    ).rejects.toThrow(AptitudeCertSignError);
  });

  it('rejects (invalid_request) on a malformed request body', async () => {
    const { json } = await freshCert();
    await expect(
      verifyAndSignCert(json, { certHash: 'nope' } as unknown, {
        caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
        verifyAssertion: vi.fn<VerifyAndSignDeps['verifyAssertion']>().mockResolvedValue(okVerdict),
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
