#!/bin/bash
# Sprint 22 / Bucket V.2 — Bootstrap helper for Google Cloud Secret Manager.
#
# Creates the 16 secrets that deploy.yml expects from Secret Manager. Each
# is created with a placeholder value (`PLACEHOLDER_REPLACE_ME`) so the
# operator can populate the real value later via:
#
#     gcloud secrets versions add NAME --data-file=path/to/value.txt
#
# Idempotent: if a secret already exists, this script skips it. Safe to
# re-run whenever the desired-set drifts.
#
# Required env: GOOGLE_CLOUD_PROJECT
# Optional env: CLOUD_RUN_SA (defaults to praeventio-runtime@<project>.iam.gserviceaccount.com)
#
# Usage:
#   GOOGLE_CLOUD_PROJECT=praeventio-541ad bash scripts/secrets-bootstrap.sh
#
# Verification (CI): `bash -n scripts/secrets-bootstrap.sh` — syntax only.
# This script is NEVER executed in CI; it requires gcloud auth and would
# mutate prod state.

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT env var is required}"
SA="${CLOUD_RUN_SA:-praeventio-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"

SECRETS=(
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  VITE_FIREBASE_VAPID_KEY
  WEBPAY_COMMERCE_CODE
  WEBPAY_API_KEY
  MP_IPN_SECRET
  GOOGLE_PLAY_PACKAGE_NAME
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
  GOOGLE_PLAY_RTDN_TOPIC
  SENTRY_DSN
  VITE_SENTRY_DSN
  KHIPU_RECEIVER_ID
  KHIPU_SECRET
  PHOTOGRAMMETRY_WORKER_TOKEN
  DWG_CONVERTER_TOKEN
  MODAL_TOKEN
)

echo "Bootstrapping ${#SECRETS[@]} secrets in project=${PROJECT_ID}"
echo "Service account that will be granted accessor role: ${SA}"
echo

# 1. Create any missing secret with a placeholder value.
for SECRET in "${SECRETS[@]}"; do
  if gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "  ok   $SECRET (already exists)"
  else
    echo "  new  $SECRET (creating empty placeholder)"
    printf '%s' "PLACEHOLDER_REPLACE_ME" | gcloud secrets create "$SECRET" \
      --data-file=- \
      --project="$PROJECT_ID" \
      --replication-policy="automatic" \
      --labels="app=praeventio,env=production,managed-by=secrets-bootstrap"
  fi
done

echo
echo "Granting roles/secretmanager.secretAccessor to ${SA}"

# 2. Grant the Cloud Run runtime service account access to read each secret.
#    `|| true` because the binding may already exist on a re-run.
for SECRET in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null 2>&1 || true
done

echo
echo "Done. Next steps:"
echo "  1. Populate each secret with its real value:"
echo "       gcloud secrets versions add SECRET_NAME --data-file=value.txt --project=${PROJECT_ID}"
echo "  2. Trigger a Cloud Run redeploy so the new versions are picked up."
echo "  3. Run 'npm run validate:env -- --mode prod-secret-manager' to confirm shape."
echo
echo "See docs/runbooks/SECRETS_RUNBOOK.md for where to obtain each value."
