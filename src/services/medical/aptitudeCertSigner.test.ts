// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Signer tests.
//
// Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
import { describe, it, expect, vi } from 'vitest';
import {
  buildSignChallenge,
  buildSignChallengeHex,
  verifyAndSignCert,
  AptitudeCertSignError,
} from './aptitudeCertSigner.js';
import {
  generateAptitudeCert,
  type AptitudeCertInput,
} from './aptitudeCertGenerator.js';

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

describe('buildSignChallenge', () => {
  it('produces a 32-byte sha256 deterministically bound to certHash', () => {
    const hash = 'a'.repeat(64);
    const a = buildSignChallenge(hash);
    const b = buildSignChallenge(hash);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // Different hash → different challenge
    const c = buildSignChallenge('b'.repeat(64));
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
    // Hex form is 64-char
    expect(buildSignChallengeHex(hash)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyAndSignCert', () => {
  it('valid request embeds signature into JSON', async () => {
    const { json, certHash } = await freshCert();
    const consumeChallenge = vi.fn().mockResolvedValue(true);
    const verifyWebAuthnAssertion = vi.fn().mockResolvedValue(true);
    const signed = await verifyAndSignCert(
      json,
      {
        certHash,
        challengeId: 'chal-1',
        signature: {
          signerUid: 'uid-doc-1',
          signerRut: '11.111.111-1',
          signedAt: '2026-05-05T10:05:00Z',
          algorithm: 'webauthn-ecdsa-p256',
          signatureB64: 'sig==',
          credentialPublicKeyB64: 'pk==',
          payloadHashHex: certHash,
        },
      },
      {
        caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
        consumeChallenge,
        verifyWebAuthnAssertion,
      },
    );
    expect(signed.certHash).toBe(certHash);
    expect(signed.json.signature.signerUid).toBe('uid-doc-1');
    expect(signed.json.signature.algorithm).toBe('webauthn-ecdsa-p256');
    expect(consumeChallenge).toHaveBeenCalledTimes(1);
    expect(verifyWebAuthnAssertion).toHaveBeenCalledTimes(1);
  });

  it('rejects on cert hash mismatch (payloadHashHex !== expected)', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(
        json,
        {
          certHash,
          challengeId: 'chal-1',
          signature: {
            signerUid: 'uid-doc-1',
            signerRut: '11.111.111-1',
            signedAt: '2026-05-05T10:05:00Z',
            algorithm: 'webauthn-ecdsa-p256',
            signatureB64: 'sig==',
            credentialPublicKeyB64: 'pk==',
            payloadHashHex: 'f'.repeat(64), // mismatched
          },
        },
        {
          caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
          consumeChallenge: vi.fn().mockResolvedValue(true),
          verifyWebAuthnAssertion: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow(AptitudeCertSignError);
  });

  it('rejects when doctor uid does not match cert.doctor.uid', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(
        json,
        {
          certHash,
          challengeId: 'chal-1',
          signature: {
            signerUid: 'uid-doc-1',
            signerRut: '11.111.111-1',
            signedAt: '2026-05-05T10:05:00Z',
            algorithm: 'webauthn-ecdsa-p256',
            signatureB64: 'sig==',
            credentialPublicKeyB64: 'pk==',
            payloadHashHex: certHash,
          },
        },
        {
          caller: { uid: 'uid-OTHER-doctor', role: 'medico_ocupacional' },
          consumeChallenge: vi.fn().mockResolvedValue(true),
          verifyWebAuthnAssertion: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toMatchObject({ code: 'doctor_uid_mismatch' });
  });

  it('rejects when WebAuthn assertion verifier returns false', async () => {
    const { json, certHash } = await freshCert();
    await expect(
      verifyAndSignCert(
        json,
        {
          certHash,
          challengeId: 'chal-1',
          signature: {
            signerUid: 'uid-doc-1',
            signerRut: '11.111.111-1',
            signedAt: '2026-05-05T10:05:00Z',
            algorithm: 'webauthn-ecdsa-p256',
            signatureB64: 'sig==',
            credentialPublicKeyB64: 'pk==',
            payloadHashHex: certHash,
          },
        },
        {
          caller: { uid: 'uid-doc-1', role: 'medico_ocupacional' },
          consumeChallenge: vi.fn().mockResolvedValue(true),
          verifyWebAuthnAssertion: vi.fn().mockResolvedValue(false),
        },
      ),
    ).rejects.toMatchObject({ code: 'signature_invalid' });
  });
});
