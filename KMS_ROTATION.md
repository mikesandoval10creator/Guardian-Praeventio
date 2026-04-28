# KMS Envelope Encryption — Operations Runbook

Status: **Round 1 (scaffolding)** — types, in-memory dev adapter, and
envelope math landed. `cloud-kms` adapter is a stub. `OAUTH_ENVELOPE_ENABLED`
defaults to `false`. See "Round 2 TODO" at the bottom.

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

## 3. Round 2 TODO — install the SDK & implement `cloudKmsAdapter`

This is owned by **Agent O5** (package.json owner). Until O5 lands the
install, do not flip `KMS_ADAPTER=cloud-kms` in production — calls will
throw.

```bash
npm install @google-cloud/kms
```

Then in `src/services/security/kmsAdapter.ts`, replace the `cloudKmsAdapter`
stub with:

```ts
import { KeyManagementServiceClient } from '@google-cloud/kms';

const KEY_NAME =
  `projects/${process.env.GCP_PROJECT}/locations/southamerica-west1` +
  `/keyRings/praeventio/cryptoKeys/oauth-tokens-kek`;

const client = new KeyManagementServiceClient();

export const cloudKmsAdapter: KmsAdapter = {
  name: 'cloud-kms',
  isAvailable: true,
  async encrypt(plaintext) {
    const [resp] = await client.encrypt({ name: KEY_NAME, plaintext });
    return Buffer.from(resp.ciphertext as Uint8Array);
  },
  async decrypt(ciphertext) {
    const [resp] = await client.decrypt({ name: KEY_NAME, ciphertext });
    return Buffer.from(resp.plaintext as Uint8Array);
  },
};
```

GCP KMS auto-handles key versions: `decrypt` recovers any prior version
without us tracking which version wrapped which envelope.

## 4. Migration of existing plaintext tokens

`oauthTokenStore.maybeUnwrapRefreshToken` already accepts both legacy
plaintext strings and new envelope objects on read, so the cutover does NOT
require downtime. To proactively wrap legacy entries, run a one-shot script
**after** flipping `OAUTH_ENVELOPE_ENABLED=true`:

```ts
// scripts/migrate-oauth-tokens-to-envelope.ts (NOT YET CREATED — Round 2)
import admin from 'firebase-admin';
import { envelopeEncrypt, isEnvelopeCiphertext } from '../src/services/security/kmsEnvelope.ts';
import { getKmsAdapter } from '../src/services/security/kmsAdapter.ts';

admin.initializeApp();
const adapter = getKmsAdapter();
const docs = await admin.firestore().collection('oauth_tokens').get();
let wrapped = 0, skipped = 0;
for (const doc of docs.docs) {
  const data = doc.data();
  const rt = data.refresh_token;
  if (rt === undefined) { skipped++; continue; }
  if (isEnvelopeCiphertext(rt)) { skipped++; continue; }
  if (typeof rt !== 'string') { skipped++; continue; }
  const env = await envelopeEncrypt(rt, adapter);
  await doc.ref.update({ refresh_token: env });
  wrapped++;
}
console.log({ wrapped, skipped });
```

Run it idempotently — re-running skips already-wrapped docs.

## 5. Production env config

Once Round 2 is done:

```
OAUTH_ENVELOPE_ENABLED=true
KMS_ADAPTER=cloud-kms
GCP_PROJECT=<PROD_PROJECT>
```

Staging should mirror production (`cloud-kms` against a staging KEK) so the
KMS code path is exercised before each deploy. Local dev keeps
`KMS_ADAPTER=in-memory-dev` (or unset — it's the default).

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

Round 1 ships unit tests for the envelope math at
`src/services/security/kmsEnvelope.test.ts`. Round 2 should add:

- Integration test: `oauthTokenStore.saveTokens` + `getValidAccessToken`
  with `OAUTH_ENVELOPE_ENABLED=true` against a Firestore emulator.
- Smoke test in staging: write a token, read it back, confirm KMS access
  log shows exactly one `Encrypt` and one `Decrypt` per round-trip.

## 9. Monitoring

Once `cloud-kms` is live, add Cloud Monitoring alerts:

- KMS API error rate > 1% over 5 min → page.
- KMS latency p99 > 500 ms over 5 min → warn.
- KMS quota usage > 80% → warn (default quota is 60k req/min — plenty).

## Round 2 TODO checklist

- [ ] `npm install @google-cloud/kms` (Agent O5 / package.json owner).
- [ ] Replace `cloudKmsAdapter` stub with the real implementation (above).
- [ ] Add `scripts/migrate-oauth-tokens-to-envelope.ts`.
- [ ] Add Firestore-emulator integration test.
- [ ] Set `OAUTH_ENVELOPE_ENABLED=true` and `KMS_ADAPTER=cloud-kms` in
      staging, then production after one week of staging soak.
- [ ] Wire Cloud Monitoring alerts.
