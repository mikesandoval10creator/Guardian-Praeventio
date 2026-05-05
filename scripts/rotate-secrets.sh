#!/bin/bash
# Sprint 22 / Bucket V.3 — Rotation helper for a single Cloud Secret Manager
# secret. Adds a new version, redeploys Cloud Run, smoke-tests the new
# revision, then disables the previous version.
#
# Usage:
#   ./scripts/rotate-secrets.sh SECRET_NAME path/to/new-value.txt
#
# Required env:
#   GOOGLE_CLOUD_PROJECT  (e.g. praeventio-541ad)
# Optional env:
#   CLOUD_RUN_SERVICE     (default: guardian-praeventio)
#   CLOUD_RUN_REGION      (default: us-central1)
#
# Verification (CI): `bash -n scripts/rotate-secrets.sh` — syntax only.
# This script is NEVER executed in CI; it requires gcloud auth + curl
# access to a live Cloud Run URL.

set -euo pipefail

SECRET="${1:?usage: rotate-secrets.sh SECRET_NAME value-file}"
VALUE_FILE="${2:?usage: rotate-secrets.sh SECRET_NAME value-file}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT env var is required}"
SERVICE="${CLOUD_RUN_SERVICE:-guardian-praeventio}"
REGION="${CLOUD_RUN_REGION:-us-central1}"

if [[ ! -f "$VALUE_FILE" ]]; then
  echo "value file not found: $VALUE_FILE" >&2
  exit 1
fi

echo "Rotating $SECRET in project=$PROJECT_ID"

# 1. Add new version. Capture the version name so we can disable
#    the previous one only after the smoke test passes.
NEW_VERSION=$(gcloud secrets versions add "$SECRET" \
  --data-file="$VALUE_FILE" \
  --project="$PROJECT_ID" \
  --format='value(name)')
echo "  new version: $NEW_VERSION"

# 2. Trigger Cloud Run redeploy with the new revision. Re-pointing
#    the secret reference is enough to roll out a new revision because
#    Cloud Run resolves :latest at deploy time.
echo "Redeploying Cloud Run service=$SERVICE region=$REGION"
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --update-secrets="$SECRET=$SECRET:latest"

# 3. Smoke test the new revision before retiring the previous version.
URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)')

if [[ -z "$URL" ]]; then
  echo "Could not resolve Cloud Run URL — aborting rotation." >&2
  exit 1
fi

echo "Smoke testing $URL/api/health"
if ! curl -fsS --max-time 30 --retry 3 --retry-delay 5 "$URL/api/health" >/dev/null; then
  echo "Smoke test failed after rotation. The new version is live but" >&2
  echo "the service is unhealthy. Investigate logs and consider rolling" >&2
  echo "back via: gcloud secrets versions disable $NEW_VERSION --secret=$SECRET" >&2
  exit 1
fi

# 4. Disable previous version (the one immediately preceding NEW_VERSION).
PREV=$(gcloud secrets versions list "$SECRET" \
  --project="$PROJECT_ID" \
  --filter="state:enabled AND name!=$NEW_VERSION" \
  --format='value(name)' \
  --limit=1)

if [[ -n "$PREV" ]]; then
  gcloud secrets versions disable "$PREV" --secret="$SECRET" --project="$PROJECT_ID" \
    >/dev/null 2>&1 || true
  echo "Disabled previous version: $PREV"
fi

echo "Rotated $SECRET successfully."
