# KMS Prod Activation Runbook

**Sprint 25 — Bucket SS.5**

Switch the Guardian Praeventio production envelope-encryption layer from
the in-memory dev adapter to Google Cloud KMS.

> Sister doc: `docs/runbooks/KMS_ROTATION.md` covers the 90-day rotation
> drill once Cloud KMS is live. This runbook is the **one-time activation**.

---

## Pre-flight checklist

- [ ] You have `roles/cloudkms.admin` on the prod GCP project.
- [ ] You have `roles/run.admin` and `roles/secretmanager.admin` on the prod
      Cloud Run service.
- [ ] The Cloud Run service account is known
      (e.g. `praeventio-api-sa@$PROJECT_ID.iam.gserviceaccount.com`).
- [ ] Region pinned to `southamerica-west1` (Santiago) for residency
      compliance with Chilean Ley 19.628.
- [ ] Smoke target identified: `https://api.praeventio.cl/api/health/deep`.

```bash
export PROJECT_ID="praeventio-prod"
export REGION="southamerica-west1"
export RUN_SERVICE="praeventio-api"
export RUN_SA="praeventio-api-sa@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT_ID"
```

---

## 1. Create the keyring

```bash
gcloud kms keyrings create praeventio-prod \
  --location="$REGION"
```

Expected output: `Created keyring [praeventio-prod].`

If the keyring already exists, this command is a no-op (returns 6 ALREADY_EXISTS).
That is safe — proceed.

## 2. Create the KEK with 90-day rotation

```bash
gcloud kms keys create praeventio-kek-v1 \
  --keyring=praeventio-prod \
  --location="$REGION" \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"
```

Verify:

```bash
gcloud kms keys list \
  --keyring=praeventio-prod \
  --location="$REGION" \
  --format="table(name,purpose,rotationPeriod,nextRotationTime)"
```

## 3. Grant Cloud Run SA encrypt/decrypt

```bash
gcloud kms keys add-iam-policy-binding praeventio-kek-v1 \
  --keyring=praeventio-prod \
  --location="$REGION" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"
```

Principle of least privilege: do **not** grant `cloudkms.admin` to the
runtime SA. Only `cryptoKeyEncrypterDecrypter` on this single key.

## 4. Publish the key resource name to Secret Manager

```bash
KEY_RESOURCE="projects/${PROJECT_ID}/locations/${REGION}/keyRings/praeventio-prod/cryptoKeys/praeventio-kek-v1"

# Create the secret (first time only)
printf '%s' "$KEY_RESOURCE" | gcloud secrets create KMS_KEY_RESOURCE_NAME \
  --replication-policy="user-managed" \
  --locations="$REGION" \
  --data-file=-

# Or add a new version if it already exists
printf '%s' "$KEY_RESOURCE" | gcloud secrets versions add KMS_KEY_RESOURCE_NAME \
  --data-file=-

# Grant runtime SA access
gcloud secrets add-iam-policy-binding KMS_KEY_RESOURCE_NAME \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Flip the adapter on Cloud Run

`KMS_ADAPTER` is a config env var (not a secret). `KMS_KEY_RESOURCE_NAME`
is wired as a secret reference.

```bash
gcloud run services update "$RUN_SERVICE" \
  --region="$REGION" \
  --set-env-vars="KMS_ADAPTER=cloud-kms" \
  --update-secrets="KMS_KEY_RESOURCE_NAME=KMS_KEY_RESOURCE_NAME:latest"
```

This triggers a new revision. Cloud Run will route 100% of traffic only
after the new revision passes its readiness probe.

## 6. Smoke test

```bash
curl -s "https://api.praeventio.cl/api/health/deep" | jq '.checks.kms'
```

Expected:

```json
{ "ok": true, "adapter": "cloud-kms", "keyName": "praeventio-kek-v1" }
```

Additional sanity check — encrypt + decrypt a known payload through the
running service:

```bash
curl -s -X POST "https://api.praeventio.cl/api/health/kms-roundtrip" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  | jq
```

Expected: `{ "ok": true, "rttMs": <small number> }`.

## 7. Rollback

If `/health/deep` reports `checks.kms.ok === false` or any prod traffic
fails decryption, immediately revert:

```bash
gcloud run services update "$RUN_SERVICE" \
  --region="$REGION" \
  --set-env-vars="KMS_ADAPTER=in-memory-dev" \
  --remove-secrets="KMS_KEY_RESOURCE_NAME"
```

Then file an incident in `docs/runbooks/INCIDENT_RESPONSE.md` and capture
the failing `/health/deep` response. The in-memory adapter only protects
data created during the current process lifetime — any blobs encrypted
under `cloud-kms` will become unreadable after the rollback. If there
were writes in the failed window, follow the data-recovery branch of the
incident runbook.

## 8. Post-activation

- [ ] Tag the deploy: `git tag kms-prod-activated-$(date -u +%F) && git push --tags`
- [ ] Add a calendar entry 85 days out for the rotation drill
      (`KMS_ROTATION.md`).
- [ ] Update `docs/runbooks/SECRETS_RUNBOOK.md` to list
      `KMS_KEY_RESOURCE_NAME` under "active prod secrets".
- [ ] Verify Sentry dashboard `kms.encrypt.error` rate stays at 0 for 24 h.
