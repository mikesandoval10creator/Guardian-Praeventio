# Compliance Document Signing Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development and verification checkpoints. The approved design is `docs/plans/2026-07-14-compliance-document-signing-design.md`.

**Goal:** Make SUSESO, DS-67, and DS-76 signatures cryptographically bound to the exact server-rendered document, with server-authoritative signer identity and time, single-use WebAuthn intents, and a real private Cloud KMS signing path.

**Architecture:** A shared, versioned signing-intent module canonicalizes the document context and derives the WebAuthn challenge from it. Existing document services persist a deterministic payload hash when creating forms. Human signing routes load and re-render the current form, resolve the signer from trusted server data, validate and consume the exact intent, verify WebAuthn, and construct the stored signature themselves. A separate internal router, protected by pinned Google service-account OIDC, performs Cloud KMS asymmetric signing and verifies the result locally before persistence.

**Tech Stack:** TypeScript, Express, Firebase Admin/Firestore, SimpleWebAuthn, Google Cloud KMS, google-auth-library, Vitest, Zod.

---

## Task 1: Canonical, versioned compliance signing intents

**Files:**

- Create: `src/services/auth/complianceSigningIntent.ts`
- Create: `src/services/auth/complianceSigningIntent.test.ts`

1. Write failing tests proving canonical output is deterministic, each security field changes the challenge, invalid hashes/expiry are rejected, and a context mismatch is rejected.
2. Run `npm run test -- src/services/auth/complianceSigningIntent.test.ts --reporter=dot` and confirm RED.
3. Implement `ComplianceSigningIntentV1`, exact-key-order canonicalization, SHA-256 challenge derivation, intent creation with injectable clock/nonce, and constant-shape context comparison.
4. Re-run the focused test and confirm GREEN.
5. Commit: `feat(security): bind compliance signing intents`.

## Task 2: Store and atomically validate intent metadata

**Files:**

- Modify: `src/services/auth/webauthnChallenge.ts`
- Modify: `src/services/auth/webauthnChallenge.test.ts`
- Modify: `src/server/auth/webauthnAssertion.ts`
- Modify: `src/server/auth/webauthnAssertion.test.ts`

1. Add failing tests for metadata round-trip, wrong document context, tampered metadata, expiry, replay, and no regression for generic WebAuthn challenges.
2. Extend challenge records with optional immutable metadata. Make consumption validate expected metadata inside the same atomic update precondition and return it only after successful consumption.
3. Let `verifyWebAuthnAssertion` accept a metadata validator and return validated metadata without weakening credential/origin/RP/counter checks.
4. Run both focused suites and confirm GREEN.
5. Commit: `feat(security): consume bound webauthn challenges`.

## Task 3: Persist and recompute authoritative document digests

**Files:**

- Modify: `src/services/suseso/susesoTypes.ts`
- Modify: `src/services/suseso/susesoService.ts`
- Modify: `src/services/suseso/susesoService.test.ts`
- Modify: `src/services/compliance/ds67/ds67Types.ts`
- Modify: `src/services/compliance/ds67/ds67Service.ts`
- Modify: `src/services/compliance/ds67/ds67Service.test.ts`
- Modify: `src/services/compliance/ds76/ds76Types.ts`
- Modify: `src/services/compliance/ds76/ds76Service.ts`
- Modify: `src/services/compliance/ds76/ds76Service.test.ts`

1. Add failing tests proving creation stores `payloadHashHex` and `payloadRendererVersion`, and sign-time digest recomputation is deterministic and excludes signature metadata.
2. Add optional legacy-compatible fields to the stored form models and shared helpers that render/hash the unsigned form.
3. Persist the digest during creation and expose authoritative digest recomputation for the server routes. Never trust a request hash.
4. Re-run the three service suites and confirm GREEN.
5. Commit: `feat(compliance): persist authoritative document digests`.

## Task 4: Resolve trusted signer identity and construct audit records

**Files:**

- Create: `src/server/services/complianceSignerIdentity.ts`
- Create: `src/server/services/complianceSignerIdentity.test.ts`
- Create: `src/services/compliance/complianceSignature.ts`
- Create: `src/services/compliance/complianceSignature.test.ts`
- Modify the three document signature model files discovered in Task 3.

1. Add failing tests for missing user, missing/invalid RUT, mismatch attempts, trusted KMS identity configuration, server clock, and full audit fields.
2. Resolve human UID solely from `req.user.uid` and RUT solely from `users/{uid}` using the existing Chilean RUT validator.
3. Build stored signatures only from verified assertion/KMS results plus server context. Include verification version, signing intent, credential evidence, authoritative hash, and authoritative signed time.
4. Run focused tests and confirm GREEN.
5. Commit: `feat(compliance): make signer audit data authoritative`.

## Task 5: Secure SUSESO human signing end to end

**Files:**

- Modify: `src/server/routes/suseso.ts`
- Modify: `src/__tests__/server/suseso.router.test.ts`
- Modify: `src/services/auth/webauthnComplianceSign.ts`
- Modify the SUSESO builder component and its test located with `rg "requestComplianceSignature" src`.

1. Add route tests for challenge binding and rejection of wrong tenant, form, hash, signer, expiry, replay, client identity/date/hash fields, and KMS bypass attempts.
2. Make challenge issuance load the form, enforce tenant access, recompute the digest, resolve identity, create the bound intent, and store it.
3. Replace the sign schema with strict `tenantId + webauthnAssertion`; validate/consume the expected intent; re-render immediately before verification/persistence; build the signature server-side.
4. Update the client helper and builder to request a form-specific challenge and submit assertion only.
5. Run SUSESO route/service/client suites and confirm GREEN.
6. Commit: `fix(suseso): bind signatures to authoritative forms`.

## Task 6: Secure DS-67 and DS-76 human signing end to end

**Files:**

- Modify: `src/server/routes/ds67ds76.ts`
- Modify: `src/__tests__/server/ds67ds76.audit.test.ts`
- Modify DS-67 and DS-76 builders and their tests located with `rg "requestComplianceSignature" src`.

1. Add failing attack tests equivalent to SUSESO for both document types, including cross-document and cross-form challenge reuse.
2. Reuse the shared signing-intent and trusted-identity path; do not duplicate security semantics.
3. Update both builders to submit assertion only.
4. Run route/service/client suites and confirm GREEN.
5. Commit: `fix(compliance): bind ds67 and ds76 signatures`.

## Task 7: Add the real, private Cloud KMS signing path

**Files:**

- Create: `src/services/compliance/cloudKmsComplianceSigner.ts`
- Create: `src/services/compliance/cloudKmsComplianceSigner.test.ts`
- Create: `src/server/middleware/verifyPinnedServiceAccount.ts`
- Create: `src/server/middleware/verifyPinnedServiceAccount.test.ts`
- Create: `src/server/routes/complianceKmsSigning.ts`
- Create: `src/__tests__/server/complianceKmsSigning.test.ts`
- Modify: `src/server/server.ts`
- Modify environment validation/preflight files found with `rg "KMS|validate-env" src scripts .github`.

1. Add failing tests for exact service-account pinning, audience/email verification, missing config, wrong key purpose/algorithm response, KMS error, local verification failure, and successful RSA-PSS SHA-256 signing.
2. Implement a dependency-injected KMS signer that calls `asymmetricSign`, fetches the public key, verifies the returned signature locally over the exact PDF bytes, and returns auditable key-version metadata.
3. Implement pinned Google OIDC middleware with no shared-secret fallback.
4. Add internal-only endpoints for SUSESO, DS-67, and DS-76. Mount them only under `/api`, never under the public SUSESO alias. Recompute digest and construct the audit record server-side.
5. Add fail-fast validation for `COMPLIANCE_KMS_SIGNING_KEY_VERSION`, `COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT`, `COMPLIANCE_KMS_SIGNER_UID`, and `COMPLIANCE_KMS_SIGNER_RUT` when the feature is enabled.
6. Run KMS/middleware/route/preflight suites and confirm GREEN.
7. Commit: `feat(compliance): sign regulatory documents with cloud kms`.

## Task 8: Contract, migration, and maintainability hardening

**Files:**

- Modify relevant API/model tests.
- Modify: `.env.example` or the repository's canonical env template.
- Modify: `docs/PENDIENTE.md` and/or task-linked technical documentation only where the code now changes the truthful state.
- Create a migration/backfill script only if existing unsigned records require persisted digests after inspecting actual repository migration conventions.

1. Add compatibility tests: legacy signed records remain readable and explicitly unverifiable; unsigned legacy records can obtain a deterministic digest without overwriting signed data.
2. Add structured, non-sensitive error codes and verify logs never include RUT, assertion blobs, challenges, or PDF bytes.
3. Document key rotation, OIDC caller setup, rollback, audit fields, and the separate pending public QR verification task.
4. Run connectivity/lint/typecheck for touched contracts.
5. Commit: `docs(compliance): document signing operations and migration`.

## Task 9: Full verification and PR 1270

1. Run all focused suites from Tasks 1-8 in one fresh command.
2. Run `npm run typecheck:ci`.
3. Run `npm run lint:connectivity` and the repository lint command applicable to touched files.
4. Run `npm run build`.
5. Run the complete unit/integration suite if time/resources permit; otherwise record exact unrun scope in the PR without claiming full coverage.
6. Review the complete branch diff for accidental feature removal, secrets, generated artifacts, duplicated paths, and public KMS exposure.
7. Push `codex/compliance-document-binding` and open the ready PR expected to be #1270 with threat model, migration/rollback, verification evidence, and linked Notion task.
8. Update Notion: status `Review`, PR URL, verification command/evidence, implementation notes; do not mark the separate QR verifier task complete.

