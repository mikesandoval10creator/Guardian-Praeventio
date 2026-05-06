#!/usr/bin/env bash
# Praeventio Guard — Sprint 34 / Brecha D.
#
# Drives the 1,000-concurrent-SOS load test end-to-end:
#
#   1. Boots Firestore emulator (project = demo-test).
#   2. Boots Express in E2E_MODE pointed at the emulator.
#   3. Seeds load-test-project with 1,000 member uids.
#   4. Runs Artillery (sos-1000-concurrent.yml) with HTML report.
#   5. Asserts emergency_alerts collection has exactly 1,000 docs.
#   6. Tears everything down.
#
# Run on Linux/macOS (or WSL on Windows). On native Windows the bash
# trap/kill semantics get flaky — use `docker run` against the
# `loadtest/Dockerfile` (not yet committed) or invoke under Git Bash
# accepting the caveat that Ctrl-C may leave orphan node processes.

set -euo pipefail

cd "$(dirname "$0")/.."

export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-demo-test}"
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8080}"
export E2E_TEST_SECRET="${E2E_TEST_SECRET:-e2e-test-secret-do-not-use-in-prod}"
export E2E_MODE=1
export NODE_ENV=test
export PORT="${PORT:-3000}"

REPORT_DIR="loadtest/reports"
mkdir -p "$REPORT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
JSON_REPORT="$REPORT_DIR/sos-1k-$TS.json"
HTML_REPORT="$REPORT_DIR/sos-1k-$TS.html"

EMU_PID=""
SRV_PID=""

cleanup() {
  echo "[run] tearing down..."
  if [[ -n "$SRV_PID" ]] && kill -0 "$SRV_PID" 2>/dev/null; then
    kill "$SRV_PID" 2>/dev/null || true
    wait "$SRV_PID" 2>/dev/null || true
  fi
  if [[ -n "$EMU_PID" ]] && kill -0 "$EMU_PID" 2>/dev/null; then
    kill "$EMU_PID" 2>/dev/null || true
    wait "$EMU_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[run] starting Firestore emulator..."
npx firebase emulators:start --only firestore --project "$GOOGLE_CLOUD_PROJECT" \
  > "$REPORT_DIR/emulator-$TS.log" 2>&1 &
EMU_PID=$!

# Wait for emulator port.
for i in $(seq 1 60); do
  if curl -fsS "http://$FIRESTORE_EMULATOR_HOST/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[run] starting Express (E2E_MODE=1)..."
npx tsx server.ts > "$REPORT_DIR/server-$TS.log" 2>&1 &
SRV_PID=$!

for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[run] seeding 1000 workers + project membership..."
node loadtest/seed-and-assert.cjs seed

echo "[run] running artillery..."
npx artillery run loadtest/sos-1000-concurrent.yml \
  --output "$JSON_REPORT"

echo "[run] generating HTML report..."
npx artillery report --output "$HTML_REPORT" "$JSON_REPORT" || true

echo "[run] asserting Firestore persistence..."
node loadtest/seed-and-assert.cjs assert

echo "[run] DONE. Report: $HTML_REPORT"
