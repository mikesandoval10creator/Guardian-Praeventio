#!/usr/bin/env bash
# loadtest/k6/run-emergency.sh — wrapper para correr k6 contra los
# endpoints de emergencia de Guardian Praeventio.
#
# Patron espejado de loadtest/k6/run-webauthn.sh (Oleada 4 PR-1):
#   1. Verifica que k6 y firebase-tools esten instalados
#   2. Inicia Firestore emulator en background
#   3. Espera a que el emulator responda
#   4. Inicia Express en background con E2E_MODE=1
#   5. Espera a que Express responda
#   6. Ejecuta k6 contra los scripts de emergencia
#   7. Teardown (kill de PIDs, cleanup)
#
# Uso:
#   ./loadtest/k6/run-emergency.sh
#
# Default: corre el script `emergency-sos.js`.

set -eu

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v k6 >/dev/null 2>&1; then
  echo "[emergency-runner] ERROR: k6 no esta instalado."
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "[emergency-runner] ERROR: firebase-tools no esta instalado. npm i -g firebase-tools"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Inicia Firestore emulator
# ─────────────────────────────────────────────────────────────────────────────
echo "[emergency-runner] Iniciando Firestore emulator..."
firebase emulators:exec --config firebase.emulator-tests.json --only firestore --project praeventio-test &
EMULATOR_PID=$!
trap 'echo "[emergency-runner] Teardown..."; kill $EXPRESS_PID $EMULATOR_PID 2>/dev/null || true; wait 2>/dev/null || true' EXIT

# Espera a que el emulator responda (puerto 8080)
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080 >/dev/null 2>&1; then
    echo "[emergency-runner] Firestore emulator listo"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. Inicia Express con E2E_MODE=1
# ─────────────────────────────────────────────────────────────────────────────
echo "[emergency-runner] Iniciando Express..."
export E2E_MODE=1
export NODE_ENV=test
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export GOOGLE_CLOUD_PROJECT=praeventio-test
export E2E_TEST_SECRET=e2e-test-secret-do-not-use-in-prod
export PORT=3000

# NOTA: el caller DEBE haber seed-eado el projectId antes de correr este
# script. Usar scripts/seed-and-assert.cjs + loadtest/sos-1000-concurrent.yml
# como bootstrap, o definir PROJECT_ID via env si ya hay un proyecto
# sembrado en el emulator. El script asume assertProjectMember pasara
# (el callerUid del E2E_MODE bypass debe ser miembro del projectId).

# Boot del servidor en background
npx tsx server.ts >/tmp/express-emergency.log 2>&1 &
EXPRESS_PID=$!

# Espera a que Express responda (puerto 3000)
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[emergency-runner] Express listo"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────────────────────
# 4. Ejecuta k6
# ─────────────────────────────────────────────────────────────────────────────
echo "[emergency-runner] Corriendo emergency-sos.js..."
k6 run loadtest/k6/emergency-sos.js
