# Compliance Document Signing — Cryptographic Binding Design

**Date:** 2026-07-14  
**Notion task:** [P0] Firmas SUSESO/DS-67/DS-76 NO vinculadas cripto al documento  
**Scope:** SUSESO DIAT/DIEP, DS-67 and DS-76 signing flows  
**Risk:** P0 / regulated-document integrity

## Problem

The current WebAuthn ceremony proves that an authenticated user answered a
random server challenge, but it does not prove that the user signed a specific
tenant document. The challenge record contains no tenant, form, document type,
action or PDF hash. After verification, each route persists client-provided
`signerUid`, `signerRut`, `signedAt`, `payloadHashHex` and `signatureB64`
without rebuilding the signature record from authoritative server state.

The `kms-sign-rsa` branch is worse: a human-authenticated client can submit an
arbitrary non-empty string as a purported KMS signature. No Cloud KMS signing
operation or signature verification occurs.

Consequences:

- one legitimate WebAuthn assertion can be paired with a different document
  hash, signer RUT, timestamp or raw signature;
- a challenge issued for one form can be presented to another signing route;
- a fabricated KMS payload can be persisted as a regulated signature;
- future public QR verification has no durable evidence from which to validate
  document integrity.

## Constraints

- Do not remove SUSESO, DS-67, DS-76, WebAuthn or KMS signing capabilities.
- The server is authoritative for document bytes, tenant, form identity,
  signer UID/RUT, signing time and payload hash.
- Browser input must never choose a legal identity or trusted digest.
- A signing challenge is single-use, expires after five minutes and is bound
  to exactly one action on exactly one document.
- KMS signing remains available, but only through a pinned service-account
  route and a real asymmetric Cloud KMS key version.
- Existing already-signed records are not silently upgraded or described as
  cryptographically verified. They remain legacy evidence until explicitly
  re-signed or migrated by a separately audited process.
- No PII is written to application logs. RUT may exist only in the regulated
  document/signature record where it is already required.

## Considered approaches

### A. Compare the duplicated client signature fields

Require `signature.signatureB64 === webauthnAssertion.signature` and compare
the client hash with a server hash. This is small, but the WebAuthn challenge
would still be random and reusable across document contexts. It does not prove
which form the authenticator approved.

### B. Use only the PDF hash as the WebAuthn challenge

This cryptographically binds the assertion to document bytes, but not to the
tenant, form ID, document kind, action, signer or expiry. Identical bytes could
be replayed across routes, and the persisted evidence would not explain the
legal context.

### C. Canonical server-side signing intent (selected)

Build a versioned, canonical intent from authoritative state, add a random
nonce and expiry, hash the canonical bytes to obtain the WebAuthn challenge,
and persist the intent alongside the single-use challenge. The sign route
recomputes the current document hash and expected context before consuming the
challenge. This produces independently testable, durable evidence and gives
WebAuthn and KMS one shared content contract.

## Architecture

### 1. Immutable unsigned payload digest

Each document service exposes a server-only function that renders the unsigned
PDF and returns its SHA-256 digest:

```ts
interface CompliancePayload {
  bytes: Uint8Array;
  hashHex: string;
  rendererVersion: 1 | 2;
}
```

> **Actualización 2026-07-19.** El renderer está versionado POR DOCUMENTO, no
> globalmente. DS 67 / DS 76 siguen emitiendo v1; SUSESO emite v2, cuyo cuerpo
> incluye el QR de verificación (dibujado como vectores desde `qrCodeUrl` para
> que los bytes sean deterministas). La verificación renderiza a la versión
> almacenada en el documento — nunca a la actual. Renderizar todo con el
> renderer más nuevo haría que toda declaración firmada antes del cambio
> reportara `payload_hash_mismatch`: acusaría de adulteración a documentos
> legales válidos.

Creation stores `payloadHashHex` and `payloadRendererVersion` on the form. The
stored digest is part of the immutable form body. Challenge issuance and KMS
signing regenerate the unsigned bytes and require the digest to match the
stored value. Existing unsigned forms without the fields may be backfilled once
from their current immutable data before a challenge is issued; signed legacy
forms are never rewritten.

### 2. Canonical signing intent

A focused module owns the contract:

```ts
type ComplianceDocumentKind = 'suseso' | 'ds67' | 'ds76';

interface ComplianceSigningIntentV1 {
  version: 1;
  purpose: 'compliance-document-sign';
  tenantId: string;
  formId: string;
  documentKind: ComplianceDocumentKind;
  action: 'sign';
  payloadHashHex: string;
  signerUid: string;
  signerRut: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nonceB64u: string;
}
```

Canonical JSON uses that exact key order and normalized lowercase hash. The
challenge is `SHA-256(UTF8(canonicalIntent))`. The persisted challenge document
stores the complete intent and its digest. Verification recalculates the
challenge from the intent; it never trusts a caller-supplied hash or context.

### 3. Authoritative signer identity

`signerUid` comes from `verifyAuth`. `signerRut` comes from the server-side
`users/{uid}` profile and must pass the existing Chilean RUT validator. Missing
or invalid identity returns a typed `422 signer_identity_incomplete`; the
browser cannot substitute a RUT. `signedAt` comes from the injected server
clock only after crypto verification succeeds.

### 4. Challenge issuance

The three challenge routes use one shared service:

1. authorize caller and tenant;
2. load the requested form and reject missing/already-signed records;
3. regenerate and verify the immutable unsigned payload hash;
4. resolve the authoritative signer identity;
5. build and persist the signing intent with five-minute expiry;
6. return `{ challengeId, challenge, rpId, formId, payloadHashHex }`.

The browser receives the digest for display/diagnostics, not as an authority.

### 5. WebAuthn completion

Human sign endpoints accept only:

```ts
{
  tenantId: string;
  webauthnAssertion: ComplianceWebAuthnAssertion;
}
```

The server loads the intent, reconstructs the expected context from current
form data, checks expiry and equality, and then runs the existing credential,
signature and counter verification. After success it builds the persisted
signature record itself:

```ts
interface VerifiedComplianceSignature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256';
  signatureB64: string;
  payloadHashHex: string;
  verificationVersion: 1;
  signingIntent: ComplianceSigningIntentV1;
  credentialId: string;
  rawId: string;
  clientDataJSONB64u: string;
  authenticatorDataB64u: string;
}
```

The signature bytes are sourced only from the verified assertion. A challenge
for another tenant/form/kind/hash or an expired/replayed challenge is rejected
without persisting a signature.

### 6. Real server-side KMS signing

Human sign endpoints no longer accept `algorithm: kms-sign-rsa`. KMS capability
is retained through sibling internal endpoints protected by a pinned Google
OIDC service account. The request contains only `tenantId`; it cannot supply a
signature, hash, signer or timestamp.

The exact internal endpoints are:

- `POST /api/suseso/form/:id/kms-sign`;
- `POST /api/compliance/ds67/:formId/kms-sign`;
- `POST /api/compliance/ds76/:formId/kms-sign`.

The public alias under `/api/public/suseso` must not expose the KMS handler;
the KMS route is mounted separately from the mixed public/authenticated
SUSESO router.

Configuration is explicit and fail-closed:

- `COMPLIANCE_KMS_SIGNING_KEY_VERSION`: full asymmetric RSA signing
  `cryptoKeyVersions/{version}` resource;
- `COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT`: only OIDC caller allowed to invoke
  the internal route;
- `COMPLIANCE_KMS_SIGNER_UID` and `COMPLIANCE_KMS_SIGNER_RUT`: legal machine
  signer identity stamped by the server.

The adapter calls Cloud KMS `asymmetricSign` using an RSA-PSS SHA-256 key,
fetches the exact version's public key and locally verifies the returned
signature over the unsigned PDF bytes before persistence. The record stores
the exact KMS key-version resource and verification version so later QR checks
remain valid after key rotation. Missing config, wrong key algorithm, KMS
failure or local verification failure returns 503/502 and writes nothing.

### 7. Reuse and boundaries

- `complianceSigningIntent.ts` owns canonicalization, challenge derivation and
  context equality; it has no Firebase or Express dependency.
- `complianceSigningIntentStore.ts` adapts Firestore challenge persistence and
  atomic single-use consumption.
- `compliancePayload.ts` provides a common result type; each document service
  owns its renderer-specific hash function.
- `complianceSignerIdentity.ts` resolves and validates the authoritative user
  or configured machine identity.
- `cloudKmsComplianceSigner.ts` is the only module importing Cloud KMS signing
  APIs.
- Routes orchestrate authorization and map typed domain failures to HTTP; they
  do not construct signatures or duplicate crypto rules.

Graphify currently places the SUSESO route, DS routes, WebAuthn client and
SUSESO service in separate communities. These shared modules deliberately form
one narrow contract between them rather than copying validation into three
large route files.

## Data flow

```text
GET sign-challenge
  -> load unsigned form
  -> regenerate server PDF/hash
  -> load server signer identity
  -> canonical intent + nonce + expiry
  -> SHA-256(intent) becomes WebAuthn challenge
  -> persist single-use intent

POST sign
  -> load/recompute authoritative context
  -> compare with stored intent
  -> verify WebAuthn signature + credential + counter
  -> server constructs signature record
  -> atomic attachSignature
  -> immutable audit event

POST kms-sign (pinned service account)
  -> load/recompute authoritative context
  -> Cloud KMS asymmetricSign
  -> local public-key verification
  -> server constructs signature record
  -> atomic attachSignature
  -> immutable audit event
```

## Failure behavior

- `400`: malformed assertion or request shape;
- `401`: invalid WebAuthn crypto, challenge, credential or replay;
- `403`: tenant mismatch, human attempt to use KMS, or unpinned service account;
- `404`: form not found without leaking another tenant's record;
- `409`: already signed, stored digest mismatch or intent/context mismatch;
- `410`: signing intent expired;
- `422`: authoritative signer identity is missing/invalid;
- `502`: KMS returned a signature that cannot be locally verified;
- `503`: KMS signing configuration/service unavailable.

Every failure is fail-closed and leaves the form unsigned. Logs contain IDs,
document kind and reason codes, never RUT, PDF bytes or raw assertion data.

## Compatibility and migration

There are no production clients, so the unsafe human-sign request contract is
replaced in the same PR and all three UI builders are updated atomically. The
response/persisted model only adds fields; readers must tolerate legacy records.

- unsigned legacy forms: deterministic digest backfill is allowed before first
  signing attempt;
- signed legacy forms: no mutation; later public verification must identify
  them as `legacy_unverifiable` rather than claiming valid;
- KMS callers: move to the pinned internal endpoints and server-owned payload.

## Testing strategy

TDD begins with attacks that currently succeed:

1. a SUSESO challenge issued for form A cannot sign form B;
2. a SUSESO challenge cannot sign DS-67 or DS-76;
3. changing the form after issuance invalidates the intent;
4. client-provided UID/RUT/date/hash/signature fields are rejected by the new
   strict request schema;
5. replay and expiry remain rejected atomically;
6. the persisted WebAuthn signature uses server UID/RUT/time/hash and the exact
   verified assertion bytes;
7. a human request containing `kms-sign-rsa` is rejected;
8. KMS endpoints reject unpinned callers and missing configuration;
9. KMS signatures are persisted only after local public-key verification;
10. SUSESO, DS-67 and DS-76 share the same intent contract and pass equivalent
    adversarial matrices.

Focused router/service tests, typecheck, complete Vitest, production build and
security documentation are required before a draft PR. Public `verifyFolio`
hardening remains a linked P0 follow-up that will consume the durable evidence
created here; it must not be marked complete by this PR.

## Success criteria

- No browser-controlled legal identity, timestamp, digest or KMS signature is
  persisted.
- A valid WebAuthn assertion authorizes exactly one immutable document context.
- All three regulated document types use the same versioned intent contract.
- KMS produces and verifies a real server-side RSA signature or fails closed.
- Existing features remain present; unsafe inputs become secure server flows.
- Tests demonstrate every cross-form, cross-kind, mutation, replay and KMS
  forgery attempt is rejected.
