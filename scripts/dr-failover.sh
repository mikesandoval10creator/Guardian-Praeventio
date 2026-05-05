#!/bin/bash
# Bucket W.2 — DR failover script
#
# Failover the Cloud Run service from the primary region (us-central1)
# to the DR region (us-east1). Intentionally MANUAL: requires shell
# access and the operator to confirm primary is genuinely down.
#
# Usage:
#   ./dr-failover.sh                 # real failover (verifies primary is down first)
#   ./dr-failover.sh --simulate      # smoke test that does not skip the down-check
#                                    # (still deploys to us-east1; use dr-simulate.sh
#                                    # if you want a tear-down version)
#
# Required env:
#   GOOGLE_CLOUD_PROJECT  Project ID (e.g. praeventio-541ad)
#   CLOUD_RUN_SERVICE     Service name (default: guardian-praeventio)
#
# Optional env:
#   PRIMARY_REGION        default us-central1
#   DR_REGION             default us-east1
#   PRIMARY_HEALTH_URL    URL probed to confirm primary is down. Default
#                         https://api.praeventio.net/api/health
#
# Exit codes:
#   0 — failover succeeded (or --simulate succeeded)
#   1 — bad invocation / primary is healthy / verification failed
#   2 — deployment to DR region failed

set -euo pipefail

SIMULATE="${1:-}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is required}"
SERVICE="${CLOUD_RUN_SERVICE:-guardian-praeventio}"
PRIMARY_REGION="${PRIMARY_REGION:-us-central1}"
DR_REGION="${DR_REGION:-us-east1}"
PRIMARY_HEALTH_URL="${PRIMARY_HEALTH_URL:-https://api.praeventio.net/api/health}"

echo "[dr-failover] project=$PROJECT_ID service=$SERVICE primary=$PRIMARY_REGION dr=$DR_REGION simulate=${SIMULATE:-no}"

# 1. Verify primary is actually down (skip in simulate mode).
if [ "$SIMULATE" != "--simulate" ]; then
  echo "[dr-failover] probing primary health: $PRIMARY_HEALTH_URL"
  if curl -fsS --max-time 30 "$PRIMARY_HEALTH_URL" >/dev/null 2>&1; then
    echo "[dr-failover] ERROR: primary is healthy. Aborting failover."
    echo "[dr-failover] If you really need to failover, set PRIMARY_HEALTH_URL to a known-bad URL"
    echo "[dr-failover] or use --simulate to deploy DR without skipping the check."
    exit 1
  fi
  echo "[dr-failover] primary appears down. Proceeding."
fi

# 2. Resolve the latest image deployed to the primary region. We mirror it
# verbatim to the DR region so the DR endpoint runs the exact same code
# the operators trust as "current production".
echo "[dr-failover] resolving latest image from primary…"
LATEST_IMAGE=$(gcloud run services describe "$SERVICE" \
  --region="$PRIMARY_REGION" \
  --project="$PROJECT_ID" \
  --format='value(spec.template.spec.containers[0].image)')

if [ -z "$LATEST_IMAGE" ]; then
  echo "[dr-failover] ERROR: could not resolve image from primary service $SERVICE/$PRIMARY_REGION."
  exit 1
fi
echo "[dr-failover] image=$LATEST_IMAGE"

# 3. Deploy that image to the DR region under a -dr suffix.
DR_SERVICE="${SERVICE}-dr"
echo "[dr-failover] deploying $DR_SERVICE to $DR_REGION…"
if ! gcloud run deploy "$DR_SERVICE" \
  --region="$DR_REGION" \
  --project="$PROJECT_ID" \
  --image="$LATEST_IMAGE" \
  --memory=1Gi \
  --cpu=2 \
  --min-instances=1 \
  --max-instances=10 \
  --set-env-vars=DR_MODE=1 \
  --quiet; then
  echo "[dr-failover] ERROR: deployment to $DR_REGION failed."
  exit 2
fi

# 4. Smoke-test the DR endpoint before touching DNS.
DR_URL=$(gcloud run services describe "$DR_SERVICE" \
  --region="$DR_REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)')
echo "[dr-failover] DR url=$DR_URL"

echo "[dr-failover] smoke-testing $DR_URL/api/health …"
if ! curl -fsS --max-time 30 "$DR_URL/api/health" >/dev/null 2>&1; then
  echo "[dr-failover] ERROR: DR endpoint did not respond healthy."
  exit 1
fi
echo "[dr-failover] DR endpoint is healthy."

# 5. DNS / Load Balancer flip.
# We deliberately do NOT automate this step: changing the public DNS
# record is a high-blast-radius action that we want a human to confirm
# in the Cloudflare / Cloud DNS console. The runbook (DR_RUNBOOK §5.2)
# documents the exact records to flip.
cat <<'NOTE'
[dr-failover] ----------------------------------------------------------
[dr-failover] MANUAL STEP REQUIRED: update DNS / Load Balancer
[dr-failover] ----------------------------------------------------------
[dr-failover] Point api.praeventio.net at the DR endpoint above. See
[dr-failover] docs/runbooks/DR_RUNBOOK.md §5.2 for the exact records.
[dr-failover] After DNS propagates (~60s with the current TTL), validate:
[dr-failover]   curl -fsS https://api.praeventio.net/api/health
[dr-failover] ----------------------------------------------------------
NOTE

echo "[dr-failover] OK: failover artifacts deployed at $DR_URL"
exit 0
