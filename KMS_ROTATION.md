# KMS Envelope Encryption — Operations Runbook

Status: **Round 2 (cloud-kms wiring done)** — types, in-memory dev adapter,
envelope math, real `cloudKmsAdapter` (`@google-cloud/kms`-backed), and the
one-shot migration script for legacy plaintext tokens are all in place.
`OAUTH_ENVELOPE_ENABLED` defaults to `false`; the remaining rollout work is
operational (Cloud KMS provisioning, env config, monitoring) — see §3 and
"Round 3 follow-ups" at the bottom.

## 1. Why envelope encryption

Firestore encrypts data at rest by default, which protects against disk-level
compromise. It does **not** protect against:

1. A privileged GCP-console export by an admin account, which yields plaintext.
2. A compromised service account that has read access to the
   `oauth_tokens` collection.

Wrapping `refresh_token` with a KMS-managed Key Encryption Key (KEK) adds
defense in depth: an attacker must compromise **both** Firestore read
access **and** Cloud KMS decrypt permission on the KEK to recover plaintext.

The pattern:

- Generate a per-token random Data Encryption Key (DEK), 32 bytes.
- Encrypt the token with the DEK using AES-256-GCM (Node `crypto`).
- Encrypt the DEK with the KEK via Cloud KMS.
- Store the AES-GCM ciphertext + IV + authTag + KMS-wrapped DEK in Firestore.

Cost: one KMS round-trip per token write and per token refresh, not per byte.

## 2. Cloud KMS one-time setup

Region: `southamerica-west1` (Santiago — same region as the Cloud Run
service, to keep latency in single-digit ms and avoid cross-region egress).

```bash
# 1. Enable the API
gcloud services enable cloudkms.googleapis.com --project=<PROD_PROJECT>

# 2. Create the keyring
gcloud kms keyrings create praeventio \
    --location=southamerica-west1 \
    --project=<PROD_PROJECT>

# 3. Create the KEK
gcloud kms keys create oauth-tokens-kek \
    --location=southamerica-west1 \
    --keyring=praeventio \
    --purpose=encryption \
    --rotation-period=90d \
    --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)" \
    --project=<PROD_PROJECT>

# 4. Grant the Cloud Run runtime SA the minimum role
gcloud kms keys add-iam-policy-binding oauth-tokens-kek \
    --location=southamerica-west1 \
    --keyring=praeventio \
    --member="serviceAccount:<CLOUD_RUN_SA>@<PROD_PROJECT>.iam.gserviceaccount.com" \
    --role=roles/cloudkms.cryptoKeyEncrypterDecrypter \
    --project=<PROD_PROJECT>
```

The role `roles/cloudkms.cryptoKeyEncrypterDecrypter` grants ONLY
`encrypt`/`decrypt` on the specific key — not key admin, not key listing.

## 3. Round 2 — SDK install, adapter, migration script (status)

- [done] `npm install @google-cloud/kms` (installed by orchestrator).
- [done] `cloudKmsAdapter` real implementation in
  `src/services/security/kmsAdapter.ts` (replaces the Round 1 stub).
- [done] `scripts/migrate-oauth-tokens-to-envelope.cjs` — see §4.

Adapter shape (now live):

```ts
import { KeyManagementServiceClient } from '@google-cloud/kms';

class CloudKmsAdapter implements KmsAdapter {
  readonly name = 'cloud-kms';
  readonly isAvailable: boolean;
  private client: KeyManagementServiceClient | null = null;
  private keyName: string;
  constructor() {
    this.keyName = process.env.KMS_KEY_RESOURCE_NAME ?? '';
    this.isAvailable = Boolean(this.keyName);
    if (this.isAvailable) this.client = new KeyManagementServiceClient();
  }
  async encrypt(plaintext) { /* client.encrypt({ name, plaintext }) */ }
  async decrypt(ciphertext) { /* client.decrypt({ name, ciphertext }) */ }
}
```

Configuration is a **single env var**: `KMS_KEY_RESOURCE_NAME` of the form
`projects/<proj>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek`.
When unset, `cloudKmsAdapter.isAvailable === false` and any call throws a
clean configuration error — `getKmsAdapter()` does NOT silently fall back to
the in-memory dev KEK (that would be a security bug).

GCP KMS auto-handles key versions: `decrypt` recovers any prior version
without us tracking which version wrapped which envelope.

**Remaining ops steps (do these in order before flipping prod traffic):**

1. Provision the keyring + KEK + IAM as in §2 (one-time, per environment).
2. Set `KMS_KEY_RESOURCE_NAME` and `KMS_ADAPTER=cloud-kms` on the **staging**
   Cloud Run revision; soak for a week. Watch KMS metrics (§9).
3. Run the migration script in **dry-run** against staging (§4), confirm
   counts match expectation, then re-run without `--dry-run`.
4. Flip `OAUTH_ENVELOPE_ENABLED=true` in staging.
5. Repeat 2–4 for production.
6. Wire the Cloud Monitoring alerts in §9.

## 4. Migration of existing plaintext tokens

`oauthTokenStore.maybeUnwrapRefreshToken` already accepts both legacy
plaintext strings and new envelope objects on read, so the cutover does NOT
require downtime. To proactively wrap legacy entries, run the one-shot
script committed to the repo:

`scripts/migrate-oauth-tokens-to-envelope.cjs`

The script:

- iterates the `oauth_tokens` collection (single `get()` — small collection),
- skips docs whose `refresh_token` is missing, already-an-envelope, or has
  an unrecognized shape,
- wraps the rest with `envelopeEncrypt(adapter)` and writes back via
  `doc.ref.update({ refresh_token, updatedAt: serverTimestamp() })`,
- is **idempotent**: re-running it after a partial run yields zero
  migrations on the second pass (the envelope check returns true).

**Dry-run first** (no writes — just prints counts and the doc IDs that
would be migrated):

```bash
GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
KMS_KEY_RESOURCE_NAME=projects/<PROD_PROJECT>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek \
KMS_ADAPTER=cloud-kms \
OAUTH_ENVELOPE_ENABLED=true \
npx tsx scripts/migrate-oauth-tokens-to-envelope.cjs --dry-run
```

**Production run** (drop `--dry-run`):

```bash
GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
KMS_KEY_RESOURCE_NAME=projects/<PROD_PROJECT>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek \
KMS_ADAPTER=cloud-kms \
OAUTH_ENVELOPE_ENABLED=true \
npx tsx scripts/migrate-oauth-tokens-to-envelope.cjs
```

`--batch=<N>` caps the number of docs processed per run if you want to
shard a very large collection across maintenance windows. The script exits
0 on full success, 2 if any individual doc failed (so a cron orchestrator
can detect partial-failure runs without parsing logs).

Why `tsx`: the script imports the TS modules in `src/services/security/`
directly via dynamic `import()` so it always uses the same envelope/adapter
code as the runtime. Running under `tsx` avoids needing a separate compile
step; if `tsx` is not available the script prints a clear error.

## 5. Production env config

Once the Cloud KMS keyring/key is provisioned (see §2):

```
OAUTH_ENVELOPE_ENABLED=true
KMS_ADAPTER=cloud-kms
KMS_KEY_RESOURCE_NAME=projects/<PROD_PROJECT>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek
```

`KMS_KEY_RESOURCE_NAME` is the single source of truth for which key wraps
the DEKs. The adapter never builds the resource name from `GCP_PROJECT` —
that legacy approach broke when projects had non-default key paths. Setting
this env var explicitly avoids surprises during environment moves.

Staging should mirror production (`cloud-kms` against a staging KEK in a
**different** project) so the KMS code path is exercised before each deploy.
Local dev keeps `KMS_ADAPTER=in-memory-dev` (or unset — it's the default).

## 6. Key rotation

GCP KMS automatic rotation is set to **90 days** (see step 2 above). When a
new version is created:

- New envelopes wrap their DEK under the new version (KMS picks "primary"
  automatically on `encrypt`).
- Old envelopes still decrypt: the wrapped DEK contains the version
  identifier in its header, and `KMS.decrypt` resolves it transparently.

No code change or migration is required for rotation. Old key versions
should remain `ENABLED` for at least one rotation cycle (180 days) before
being `DESTROY_SCHEDULED` — that's the default GCP behavior.

To rotate manually (e.g. suspected compromise):

```bash
gcloud kms keys versions create \
    --location=southamerica-west1 \
    --keyring=praeventio \
    --key=oauth-tokens-kek \
    --primary
```

## 7. Disaster recovery

If KMS access is lost (project-level lockout, billing failure, IAM mistake):

- **OAuth refresh tokens become unrecoverable.** Wrapped DEKs cannot be
  unwrapped without the KEK.
- **Firebase Auth ID tokens are unaffected** — they live in Firebase Auth,
  not Firestore, and use Google-managed signing keys.
- **User impact:** users must re-link Google Calendar / Google Drive on
  next use. The app's `getValidAccessToken` returns `null`, the request
  handler surfaces a "please reconnect" UX, and `saveTokens` re-runs after
  the OAuth callback.

This trade-off is accepted because:

1. KMS access loss is low-probability (GCP IAM is well-tested).
2. The blast radius is limited to "users re-link Calendar/Drive" — no data
   loss, no auth lockout.
3. The defense-in-depth benefit (admin-export-resistant tokens) outweighs
   the rare re-link cost.

Document this trade-off in the user-facing connection flow ("If you lose
access, you can reconnect Google Calendar in Settings").

## 8. Testing

Unit-test coverage:

- `src/services/security/kmsEnvelope.test.ts` — envelope math (Round 1).
- `src/services/security/cloudKmsAdapter.test.ts` — `cloudKmsAdapter`
  wiring (Round 2). **The `@google-cloud/kms` SDK is mocked** via
  `vi.mock('@google-cloud/kms', ...)`, so the suite never reaches GCP.
  This test pins request/response shape and the env-var gate; it does NOT
  prove that real Cloud KMS round-trips succeed.

Full integration coverage against a real KMS key requires:

- A staging service account with `roles/cloudkms.cryptoKeyEncrypterDecrypter`
  on a dedicated test keyring,
- That SA's credentials available to CI via Workload Identity Federation
  (preferred over a JSON key in a CI secret).

Both are operational lift — **deferred** to a CI hardening pass. Until
then, the staging soak (§3 step 2) provides the only real-traffic check
that the SDK wiring works against live GCP.

Recommended manual smoke test on each deploy: write a token to staging,
read it back, confirm Cloud Logging shows exactly one `Encrypt` and one
`Decrypt` per token round-trip on the `oauth-tokens-kek` key.

## 9. Monitoring

Once `cloud-kms` is live, add Cloud Monitoring alerts:

- KMS API error rate > 1% over 5 min → page.
- KMS latency p99 > 500 ms over 5 min → warn.
- KMS quota usage > 80% → warn (default quota is 60k req/min — plenty).

## Round 2 TODO checklist

- [x] `npm install @google-cloud/kms` (orchestrator).
- [x] Replace `cloudKmsAdapter` stub with the real implementation.
- [x] Add `scripts/migrate-oauth-tokens-to-envelope.cjs`.
- [x] Smoke test for `cloudKmsAdapter` wiring (mocked SDK).
- [ ] Add Firestore-emulator integration test (deferred — requires
      `@firebase/rules-unit-testing` + emulator setup; not a blocker for
      flipping the flag in staging).
- [ ] Set `OAUTH_ENVELOPE_ENABLED=true` and `KMS_ADAPTER=cloud-kms` (with
      `KMS_KEY_RESOURCE_NAME`) in staging, then production after one week
      of staging soak.
- [ ] Wire Cloud Monitoring alerts (§9).

## Round 3 follow-ups

Tracked here so they don't get lost in tickets:

1. **Real Cloud KMS integration test in CI.** The current smoke test mocks
   the SDK. Stand up a dedicated staging KEK + a CI service account
   (Workload Identity Federation, not a JSON key) and add a CI job that
   does one `encrypt` + one `decrypt` against the real key per PR. Gate it
   behind a `KMS_INTEGRATION=1` env var so PRs from forks (which can't
   authenticate to GCP) skip cleanly.
2. **Cloud Monitoring alerts on KMS error rate.** Wire the §9 alerts via
   Terraform / `gcloud monitoring policies create`. Page on >1% error rate
   sustained 5 min; warn on p99 latency >500ms. KMS quota dashboard sits
   in the same project — link it from the runbook.
3. **Per-tenant key rotation strategy.** Today everyone shares
   `oauth-tokens-kek`. If we sign a customer who needs cryptographic
   isolation (BAA-style requirement, sovereign-tenant contract, or a
   regulated vertical we haven't entered yet), we'll need per-tenant keys.
   Sketch: use `KMS_KEY_RESOURCE_NAME` as a *default* and look up a
   `tenantKeyName` from a tenants collection on saveTokens; envelopes
   already record the wrapping adapter so we'd extend that to record the
   key resource name too. Don't build it until the customer actually
   shows up — premature multi-tenancy is a lot of code to maintain.
