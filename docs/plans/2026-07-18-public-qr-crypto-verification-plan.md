# Public QR Cryptographic Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public SUSESO QR verifier return valid only after reconstructing the exact document and verifying its real WebAuthn or KMS signature.

**Architecture:** Add self-contained public-key evidence v2 at signing time and a server-only archival verifier shared by the public reader. Preserve v1 through controlled key resolvers, classify insufficient legacy evidence honestly, and harden all three regulatory `signForm` boundaries against unbound fixtures.

**Tech Stack:** TypeScript, Express, Firebase Admin/Firestore, Node crypto, `@simplewebauthn/server/helpers`, Google Cloud KMS, Vitest.

## Global Constraints

- Preserve SUSESO, DS-67, DS-76, WebAuthn and KMS functionality.
- Never expose worker PII, PDF bytes, assertions or public-key material through the QR response or logs.
- Keep `valid: boolean` backward-compatible and fail closed.
- Do not rewrite or silently upgrade existing signed records.
- Follow RED-GREEN-REFACTOR for every behavior change.

---

### Task 1: Versioned self-contained verification evidence

**Files:**
- Modify: `src/services/compliance/complianceSignature.ts`
- Modify: `src/services/compliance/complianceSignature.test.ts`

**Interfaces:**
- Produces: `ComplianceVerificationKey`, evidence classification for v1/v2/legacy, and `matchesPersistedComplianceSignatureContext()`.

- [ ] **Step 1: Write failing classification and context tests**

Add tests proving a v2 WebAuthn/KMS signature requires its exact public-key
snapshot and that tenant, form, document kind, hash, UID and RUT mismatches fail.

```ts
expect(classifyStoredComplianceSignatureEvidence(v2)).toBe('self-contained-evidence-v2');
expect(matchesPersistedComplianceSignatureContext(v2, context)).toBe(true);
expect(matchesPersistedComplianceSignatureContext(v2, { ...context, formId: 'other' })).toBe(false);
```

- [ ] **Step 2: Run RED**

Run: `npm run test -- src/services/compliance/complianceSignature.test.ts --reporter=dot`
Expected: FAIL because v2 classification/context helpers do not exist.

- [ ] **Step 3: Implement the additive v2 model**

Add the discriminated verification-key union, make verified builders emit v2,
and implement strict classification/context comparison without cryptography.

- [ ] **Step 4: Run GREEN and commit**

Run the same test; expect all tests PASS.
Commit: `feat(compliance): persist self-contained verification keys`

### Task 2: Capture verified public keys at signing time

**Files:**
- Modify: `src/server/auth/webauthnAssertion.ts`
- Modify: `src/server/auth/webauthnAssertion.test.ts`
- Modify: `src/server/services/complianceWebAuthnSigning.ts`
- Modify: `src/server/services/complianceWebAuthnSigning.test.ts`
- Modify: `src/services/compliance/cloudKmsComplianceSigner.ts`
- Modify: `src/services/compliance/cloudKmsComplianceSigner.test.ts`
- Modify: `src/server/routes/suseso.ts`
- Modify: `src/server/routes/ds67ds76.ts`

**Interfaces:**
- Produces: verified WebAuthn key snapshot `{ publicKeyB64, origin, rpId }` and KMS `{ publicKeyPem }` propagated into evidence v2.

- [ ] **Step 1: Write failing WebAuthn and KMS propagation tests**

Assert successful verifiers return the exact already-verified public key and
builders persist it; errors and logs must not contain key/assertion bodies.

- [ ] **Step 2: Run RED**

Run: `npm run test -- src/server/auth/webauthnAssertion.test.ts src/server/services/complianceWebAuthnSigning.test.ts src/services/compliance/cloudKmsComplianceSigner.test.ts --reporter=dot`
Expected: FAIL on missing key-evidence fields.

- [ ] **Step 3: Implement minimal propagation**

Return fields from existing verified results; do not perform a second signing
operation or add a new network call.

- [ ] **Step 4: Run GREEN and commit**

Commit: `feat(compliance): archive verified signing public keys`

### Task 3: Cryptographic archival verifier

**Files:**
- Create: `src/server/services/complianceSignatureVerification.ts`
- Create: `src/server/services/complianceSignatureVerification.test.ts`

**Interfaces:**
- Produces: `verifyPersistedComplianceSignature(input, deps): Promise<ComplianceVerificationOutcome>`.
- Consumes: renderer bytes, authoritative `ComplianceSigningContext`, persisted signature, optional v1 key resolvers.

- [ ] **Step 1: Write real-crypto failing tests**

Generate an ephemeral P-256 COSE credential and RSA key pair in tests. Assert
valid signatures verify and mutations of payload, challenge, context, origin,
RP ID, signer, key and signature fail. Assert absent v1 keys are unverifiable.

- [ ] **Step 2: Run RED**

Run: `npm run test -- src/server/services/complianceSignatureVerification.test.ts --reporter=dot`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement WebAuthn verification**

Decode client/authenticator data, derive the canonical challenge, validate
origin/RP/UP/UV and call SimpleWebAuthn `verifySignature()` over the exact
signature base. Never update authentication counters.

- [ ] **Step 4: Implement KMS verification**

Use `crypto.verify('sha256', payload, { padding: RSA_PKCS1_PSS_PADDING,
saltLength: 32 }, signature)` with the snapshotted or resolved historical PEM.

- [ ] **Step 5: Run GREEN and commit**

Commit: `feat(compliance): verify archived regulatory signatures`

### Task 4: Reject unbound signatures at document-service boundaries

**Files:**
- Modify: `src/services/suseso/susesoService.ts`
- Modify: `src/services/suseso/susesoService.test.ts`
- Modify: `src/services/compliance/ds67/ds67Service.ts`
- Modify: `src/services/compliance/ds67/ds67Service.test.ts`
- Modify: `src/services/compliance/ds76/ds76Service.ts`
- Modify: `src/services/compliance/ds76/ds76Service.test.ts`

**Interfaces:**
- Consumes: `matchesPersistedComplianceSignatureContext()` from Task 1.

- [ ] **Step 1: Replace AAAA success fixtures with rejection tests**

Each service must reject legacy/unbound evidence and mismatched hash/context;
successful cases use complete bound evidence generated by shared builders.

- [ ] **Step 2: Run RED**

Run the three service test files; expect fabricated evidence to be accepted by
current code, causing the new rejection assertions to fail.

- [ ] **Step 3: Add the minimal shared invariant gate**

Before atomic persistence, require bound v1/v2 evidence and exact authoritative
context. Do not perform browser/server cryptography inside browser-safe files.

- [ ] **Step 4: Run GREEN and commit**

Commit: `fix(compliance): reject unbound signature evidence`

### Task 5: Wire the public SUSESO folio verifier

**Files:**
- Modify: `src/services/suseso/types.ts`
- Modify: `src/services/suseso/susesoService.ts`
- Modify: `src/services/suseso/susesoService.test.ts`
- Modify: `src/server/routes/suseso.ts`
- Modify: `src/__tests__/server/suseso.router.test.ts`

**Interfaces:**
- Produces: backward-compatible `SusesoVerificationResult` with optional `verificationStatus`.
- Consumes: Task 3 verifier and Firestore/KMS v1 key resolvers.

- [ ] **Step 1: Write failing public-verifier tests**

Cover real v2 WebAuthn/KMS success, fabricated signature, altered form/hash,
legacy evidence, unavailable historical key, internal resolver error and PII
non-disclosure.

- [ ] **Step 2: Run RED**

Run service and router suites; expect fabricated signatures still return true.

- [ ] **Step 3: Reconstruct and verify before returning valid**

Return true only for outcome `verified`; map invalid/unverifiable reasons to
stable response codes. Resolve v1 WebAuthn credentials from Firestore and v1
KMS PEM by stored key-version, with no dependence on the active key setting.

- [ ] **Step 4: Run GREEN and commit**

Commit: `fix(suseso): verify public qr signatures cryptographically`

### Task 6: Documentation, full verification and PR

**Files:**
- Modify: `docs/security/COMPLIANCE_DOCUMENT_SIGNING.md`
- Modify: Notion tasks after code verification (external state)

- [ ] **Step 1: Document guarantees and operational behavior**

Describe v2 snapshots, v1 fallback, legacy/unverifiable semantics, key rotation,
revocation, privacy and rollback without claiming advanced electronic signature.

- [ ] **Step 2: Run focused tests and static gates**

Run all touched suites together, `npm run typecheck:ci`, repository lint,
`git diff --check`, `npm run build`, and the full suite when practical. Record
exact pre-existing warnings/leaks separately from new failures.

- [ ] **Step 3: Review diff and Graphify**

Run `graphify update .`; confirm `verifyFolio()` now reaches renderer and the
server cryptographic verifier. Check no PII, secret, generated report or feature
removal entered the diff.

- [ ] **Step 4: Push, open draft PR and update Notion**

Set both linked tasks to Review with PR URL, test evidence, migration/rollback
notes and remaining limitations. Do not mark Merged before GitHub merge.
