// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — server-side SiteBook signing.
//
// Tests pure logic via dependency injection — sin Express, sin Firestore,
// sin onnxruntime ni @simplewebauthn real. Stubeamos los dep collaborators
// para verificar:
//
//   - El handler de /options computa el challenge correcto desde el hash
//   - El handler de /options persiste el challenge atado al uid + entryId
//   - El handler de /verify re-deriva el challenge esperado + falla si
//     hubo tampering del payloadHashHex
//   - El handler de /verify persiste el signature blob correcto
//   - El handler de /verify NO re-firma entries already signed

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleSignOptionsRequest,
  handleSignVerifyRequest,
  type SignOptionsDeps,
  type SignVerifyDeps,
} from './sitebookSign';
import type { SiteBookEntry } from '../../services/siteBook/siteBookService';
import { computeEntryPayloadHashHex, deriveSigningChallenge } from '../../services/siteBook/siteBookSigning';
import type {
  WebAuthnAssertionInput,
  WebAuthnAssertionResult,
} from '../auth/webauthnAssertion';

function makeEntry(overrides: Partial<SiteBookEntry> = {}): SiteBookEntry {
  return {
    id: 'entry-1',
    projectId: 'proj-A',
    folio: 'SB-2026-000001',
    year: 2026,
    sequenceNumber: 1,
    kind: 'inspection',
    occurredAt: '2026-05-24T10:00:00.000Z',
    recordedAt: '2026-05-24T11:00:00.000Z',
    recordedByUid: 'uid-juan',
    recordedByRole: 'supervisor',
    description: 'Inspección de prueba para tests del flow de firma WebAuthn',
    status: 'open',
    ...overrides,
  };
}

// In-memory fake challenges DB matching MinimalChallengesDb shape.
function makeChallengesDb() {
  const store = new Map<string, Record<string, unknown>>();
  const now = vi.fn(() => 1_700_000_000_000);
  const db = {
    collection: (_name: string) => ({
      doc: (id: string) => ({
        async get() {
          const data = store.get(id);
          return {
            exists: data !== undefined,
            id,
            data: () => data,
          };
        },
        async set(data: Record<string, unknown>) {
          store.set(id, data);
        },
        async updateIf(
          pre: (cur: Record<string, unknown> | undefined) => boolean,
          patch: Record<string, unknown>,
        ) {
          const cur = store.get(id);
          if (!pre(cur)) return false;
          store.set(id, { ...(cur ?? {}), ...patch });
          return true;
        },
      }),
    }),
    now,
  };
  return { db, store, now };
}

// Fake credentials DB matching MinimalCredentialsDb shape. Cast via
// `unknown` because the production shape has additional methods we don't
// exercise in these tests (set, etc.) — TS would otherwise complain.
function makeCredentialsDb(registered: Array<{ uid: string; credentialId: string }>) {
  return {
    now: () => 1_700_000_000_000,
    collection: (_name: string) => ({
      doc: (id: string) => ({
        async get() {
          const found = registered.find((r) => r.credentialId === id);
          return {
            exists: !!found,
            id,
            data: () =>
              found
                ? ({
                    ...found,
                    publicKey: 'fake',
                    counter: 0,
                    transports: [],
                  } as unknown as Record<string, unknown>)
                : undefined,
          };
        },
        async set(_data: Record<string, unknown>) {
          /* no-op */
        },
        async update(_patch: Record<string, unknown>) {
          /* no-op */
        },
      }),
      where: (_field: string, _op: '==', value: unknown) => ({
        async get() {
          const docs = registered
            .filter((r) => r.uid === String(value))
            .map((r) => ({
              id: r.credentialId,
              data: () =>
                ({
                  ...r,
                  publicKey: 'fake',
                  counter: 0,
                  transports: [],
                } as unknown as Record<string, unknown>),
            }));
          return { docs };
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ─── /options handler ─────────────────────────────────────────────────────
describe('handleSignOptionsRequest', () => {
  let challenges: ReturnType<typeof makeChallengesDb>;
  let entry: SiteBookEntry;
  let deps: SignOptionsDeps;

  beforeEach(() => {
    challenges = makeChallengesDb();
    entry = makeEntry();
    deps = {
      challengesDb: challenges.db,
      credentialsDb: makeCredentialsDb([
        { uid: 'uid-juan', credentialId: 'cred-1' },
        { uid: 'uid-juan', credentialId: 'cred-2' },
        { uid: 'uid-other', credentialId: 'cred-other' },
      ]),
      loadEntry: vi.fn(async () => entry),
    };
  });

  it('retorna challenge derivado del payloadHash + lista de credentials del uid', async () => {
    const payloadHashHex = computeEntryPayloadHashHex(entry);
    const res = await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex },
      deps,
    );
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.value.challengeId).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof res.value.challengeB64u).toBe('string');
    expect(res.value.allowCredentials).toHaveLength(2);
    expect(res.value.allowCredentials.map((c) => c.id).sort()).toEqual(['cred-1', 'cred-2']);
  });

  it('persiste challenge bound al uid + entryId con TTL', async () => {
    const payloadHashHex = computeEntryPayloadHashHex(entry);
    await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex },
      deps,
    );
    // El store ahora tiene una entry persisted.
    const persisted = Array.from(challenges.store.values())[0];
    expect(persisted).toBeDefined();
    expect(persisted.uid).toBe('uid-juan');
    expect(persisted.consumed).toBe(false);
    // TTL configurado >0.
    const created = Number(persisted.createdAt);
    const expires = Number(persisted.expiresAt);
    expect(expires).toBeGreaterThan(created);
  });

  it('rechaza si el payloadHashHex no coincide con el hash de la entry actual', async () => {
    // Tampering simulation: el cliente envió un hash que NO matchea la
    // entry persistida → potencial intento de firmar otra cosa.
    const res = await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex: 'a'.repeat(64) },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('hash_mismatch');
  });

  it('rechaza si la entry ya está firmada', async () => {
    deps.loadEntry = vi.fn(async () => makeEntry({ status: 'signed' }));
    const payloadHashHex = computeEntryPayloadHashHex(makeEntry({ status: 'signed' }));
    const res = await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('already_signed');
  });

  it('rechaza si la entry no existe', async () => {
    deps.loadEntry = vi.fn(async () => null);
    const res = await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: 'missing', projectId: entry.projectId, payloadHashHex: 'b'.repeat(64) },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('not_found');
  });

  it('rechaza si el uid no tiene credentials registrados', async () => {
    const payloadHashHex = computeEntryPayloadHashHex(entry);
    const res = await handleSignOptionsRequest(
      { uid: 'uid-no-credentials', entryId: entry.id, projectId: entry.projectId, payloadHashHex },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('no_credentials');
  });

  it('rechaza payloadHashHex con shape inválida', async () => {
    const res = await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex: 'short' },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('invalid_hash_format');
  });

  it('el challenge persistido es exactamente deriveSigningChallenge(payloadHash)', async () => {
    const payloadHashHex = computeEntryPayloadHashHex(entry);
    await handleSignOptionsRequest(
      { uid: 'uid-juan', entryId: entry.id, projectId: entry.projectId, payloadHashHex },
      deps,
    );
    const persisted = Array.from(challenges.store.values())[0];
    const expectedChallenge = deriveSigningChallenge(payloadHashHex);
    const persistedB64 = String(persisted.challengeB64);
    const persistedBytes = new Uint8Array(Buffer.from(persistedB64, 'base64'));
    expect(persistedBytes).toEqual(expectedChallenge);
  });
});

// ─── /verify handler ──────────────────────────────────────────────────────
describe('handleSignVerifyRequest', () => {
  let entry: SiteBookEntry;
  let saveSignedEntry: (projectId: string, entry: SiteBookEntry) => Promise<void>;
  let deps: SignVerifyDeps;

  beforeEach(() => {
    entry = makeEntry();
    saveSignedEntry = vi.fn(async () => undefined) as unknown as (
      projectId: string,
      entry: SiteBookEntry,
    ) => Promise<void>;
    deps = {
      challengesDb: makeChallengesDb().db,
      credentialsDb: makeCredentialsDb([{ uid: 'uid-juan', credentialId: 'cred-1' }]),
      loadEntry: vi.fn(async () => entry),
      saveSignedEntry,
      verifyAssertion: vi.fn(
        async (): Promise<WebAuthnAssertionResult> => ({
          verified: true,
          newCounter: 5,
          verifiedCredentialId: 'cred-1',
        }),
      ) as unknown as (input: WebAuthnAssertionInput) => Promise<WebAuthnAssertionResult>,
      expectedOrigin: 'https://app.praeventio.net',
      expectedRpId: 'app.praeventio.net',
      now: () => new Date('2026-05-24T11:30:00.000Z'),
    };
  });

  it('verifica + persiste signature blob + retorna entry firmada', async () => {
    const payloadHashHex = computeEntryPayloadHashHex(entry);
    const res = await handleSignVerifyRequest(
      {
        uid: 'uid-juan',
        entryId: entry.id,
        projectId: entry.projectId,
        payloadHashHex,
        challengeId: 'chal-1',
        assertion: {
          credentialId: 'cred-1',
          rawId: 'cred-1',
          clientDataJSONB64u: 'AAA',
          authenticatorDataB64u: 'BBB',
          signatureB64u: 'CCC',
        },
      },
      deps,
    );

    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.value.entry.status).toBe('signed');
    expect(res.value.entry.signature?.algorithm).toBe('webauthn-ecdsa-p256');
    expect(res.value.entry.signature?.signerUid).toBe('uid-juan');
    expect(res.value.entry.signature?.payloadHashHex).toBe(payloadHashHex);
    expect(res.value.entry.signature?.credentialId).toBe('cred-1');
    expect(res.value.entry.signature?.signedAt).toBe('2026-05-24T11:30:00.000Z');
    expect(saveSignedEntry).toHaveBeenCalledTimes(1);
  });

  it('rechaza si el payloadHashHex enviado NO coincide con la entry actual', async () => {
    const res = await handleSignVerifyRequest(
      {
        uid: 'uid-juan',
        entryId: entry.id,
        projectId: entry.projectId,
        payloadHashHex: 'a'.repeat(64), // wrong hash
        challengeId: 'chal-1',
        assertion: {
          credentialId: 'cred-1',
          rawId: 'cred-1',
          clientDataJSONB64u: 'AAA',
          authenticatorDataB64u: 'BBB',
          signatureB64u: 'CCC',
        },
      },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('hash_mismatch');
    expect(saveSignedEntry).not.toHaveBeenCalled();
  });

  it('rechaza si la entry ya estaba firmada (idempotency)', async () => {
    deps.loadEntry = vi.fn(async () => makeEntry({ status: 'signed' }));
    const res = await handleSignVerifyRequest(
      {
        uid: 'uid-juan',
        entryId: entry.id,
        projectId: entry.projectId,
        payloadHashHex: computeEntryPayloadHashHex(makeEntry({ status: 'signed' })),
        challengeId: 'chal-1',
        assertion: {
          credentialId: 'cred-1',
          rawId: 'cred-1',
          clientDataJSONB64u: 'AAA',
          authenticatorDataB64u: 'BBB',
          signatureB64u: 'CCC',
        },
      },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('already_signed');
    expect(saveSignedEntry).not.toHaveBeenCalled();
  });

  it('propaga el reason del verifyAssertion cuando la firma falla', async () => {
    deps.verifyAssertion = vi.fn(
      async (): Promise<WebAuthnAssertionResult> => ({
        verified: false,
        reason: 'signature_invalid',
      }),
    ) as unknown as (input: WebAuthnAssertionInput) => Promise<WebAuthnAssertionResult>;
    const res = await handleSignVerifyRequest(
      {
        uid: 'uid-juan',
        entryId: entry.id,
        projectId: entry.projectId,
        payloadHashHex: computeEntryPayloadHashHex(entry),
        challengeId: 'chal-1',
        assertion: {
          credentialId: 'cred-1',
          rawId: 'cred-1',
          clientDataJSONB64u: 'AAA',
          authenticatorDataB64u: 'BBB',
          signatureB64u: 'CCC',
        },
      },
      deps,
    );
    expect(res.kind).toBe('error');
    if (res.kind !== 'error') return;
    expect(res.reason).toBe('signature_invalid');
    expect(saveSignedEntry).not.toHaveBeenCalled();
  });

  it('llama verifyAssertion con el credentialId del browser + el rpId/origin esperados', async () => {
    const verifyAssertion = vi.fn(
      async (): Promise<WebAuthnAssertionResult> => ({
        verified: true,
        newCounter: 1,
        verifiedCredentialId: 'cred-1',
      }),
    );
    deps.verifyAssertion = verifyAssertion as unknown as (
      input: WebAuthnAssertionInput,
    ) => Promise<WebAuthnAssertionResult>;
    await handleSignVerifyRequest(
      {
        uid: 'uid-juan',
        entryId: entry.id,
        projectId: entry.projectId,
        payloadHashHex: computeEntryPayloadHashHex(entry),
        challengeId: 'chal-abc',
        assertion: {
          credentialId: 'cred-1',
          rawId: 'cred-1',
          clientDataJSONB64u: 'AAA',
          authenticatorDataB64u: 'BBB',
          signatureB64u: 'CCC',
        },
      },
      deps,
    );
    expect(verifyAssertion).toHaveBeenCalledTimes(1);
    const arg = (verifyAssertion.mock.calls[0] as unknown as [WebAuthnAssertionInput])[0];
    expect(arg.uid).toBe('uid-juan');
    expect(arg.credentialId).toBe('cred-1');
    expect(arg.expectedOrigin).toBe('https://app.praeventio.net');
    expect(arg.expectedRpId).toBe('app.praeventio.net');
    expect(arg.challengeId).toBe('chal-abc');
  });
});
