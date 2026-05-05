#!/bin/bash
# Bucket W.3 — DR drill simulation
#
# Runs a non-destructive DR drill: deploys the current image to a
# temporary Cloud Run service named "<service>-dr-test" in the DR
# region, validates /api/health, then tears the test service down.
#
# Intended cadence: quarterly (DR_RUNBOOK §6 Q2 simulacro).
#
# Differences vs dr-failover.sh:
#   • Never touches production DNS.
#   • Uses a -dr-test suffix so it can never collide with a real -dr
#     deployment from a genuine failover.
#   • Always tears down the test service at exit, even on failure.
#   • Does not require the primary to be down.
#
# Usage:
#   ./dr-simulate.sh                # full drill (deploy → probe → teardown)
#   ./dr-simulate.sh --keep         # skip teardown so the operator can
#                                   # poke at the DR service manually
#                                   # (you MUST clean it up afterwards!)
#
# Required env: same as dr-failover.sh

set -euo pipefail

KEEP="${1:-}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is required}"
SERVICE="${CLOUD_RUN_SERVICE:-guardian-praeventio}"
PRIMARY_REGION="${PRIMARY_REGION:-us-central1}"
DR_REGION="${DR_REGION:-us-east1}"
TEST_SERVICE="${SERVICE}-dr-test"

cleanup() {
  if [ "$KEEP" = "--keep" ]; then
    echo "[dr-simulate] --keep set; leaving $TEST_SERVICE/$DR_REGION running."
    echo "[dr-simulate] Remember to tear it down manually:"
    echo "  gcloud run services delete $TEST_SERVICE --region=$DR_REGION --project=$PROJECT_ID --quiet"
    return
  fi
  echo "[dr-simulate] tearing down $TEST_SERVICE/$DR_REGION…"
  gcloud run services delete "$TEST_SERVICE" \
    --region="$DR_REGION" \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null || echo "[dr-simulate] (teardown best-effort: service may not exist)"
}
trap cleanup EXIT

echo "[dr-simulate] project=$PROJECT_ID test_service=$TEST_SERVICE dr=$DR_REGION keep=${KEEP:-no}"

# 1. Resolve the current production image.
LATEST_IMAGE=$(gcloud run services describe "$SERVICE" \
  --region="$PRIMARY_REGION" \
  --project="$PROJECT_ID" \
  --format='value(spec.template.spec.containers[0].image)')

if [ -z "$LATEST_IMAGE" ]; then
  echo "[dr-simulate] ERROR: could not resolve image from $SERVICE/$PRIMARY_REGION."
  exit 1
fi
echo "[dr-simulate] image=$LATEST_IMAGE"

# 2. Deploy under the test name. We use a low min-instances so a forgotten
# drill doesn't burn money.
echo "[dr-simulate] deploying $TEST_SERVICE to $DR_REGION…"
gcloud run deploy "$TEST_SERVICE" \
  --region="$DR_REGION" \
  --project="$PROJECT_ID" \
  --image="$LATEST_IMAGE" \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars=DR_MODE=1,DR_DRILL=1 \
  --no-allow-unauthenticated \
  --quiet

# 3. Probe with mock traffic. The DR_DRILL env makes the app surface an
# extra `/api/health` hint so dashboards can filter drill traffic out.
TEST_URL=$(gcloud run services describe "$TEST_SERVICE" \
  --region="$DR_REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)')

echo "[dr-simulate] probing $TEST_URL/api/health …"
# We use the gcloud-issued identity token so --no-allow-unauthenticated
# above does not block our own smoke test.
TOKEN=$(gcloud auth print-identity-token)
if ! curl -fsS --max-time 30 -H "Authorization: Bearer $TOKEN" \
  "$TEST_URL/api/health" >/dev/null 2>&1; then
  echo "[dr-simulate] ERROR: health check failed against $TEST_URL"
  exit 1
fi
echo "[dr-simulate] health OK."

# 4. Latency probe (5 sequential calls). We don't fail on latency here —
# this is reported in the rehearsal log; the runbook decides whether the
# RTO/RPO target was met.
echo "[dr-simulate] timing 5 sequential /api/health calls…"
for i in 1 2 3 4 5; do
  TIME=$(curl -o /dev/null -s --max-time 30 -H "Authorization: Bearer $TOKEN" \
    -w '%{time_total}' "$TEST_URL/api/health" || echo "FAIL")
  echo "  request $i: ${TIME}s"
done

echo "[dr-simulate] OK: drill validated. Service will be torn down on exit."
exit 0
