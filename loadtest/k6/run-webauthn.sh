#!/usr/bin/env bash
# loadtest/k6/run-webauthn.sh — wrapper para correr k6 contra los endpoints
# vida-safety de Guardian Praeventio.
#
# Patrón espejado de loadtest/run.sh (Artillery SOS 1k):
#   1. Verifica que firebase-tools este instalado
#   2. Inicia Firestore emulator en background
#   3. Espera a que el emulator responda
#   4. Inicia Express en background con E2E_MODE=1
#   5. Espera a que Express responda
#   6. Ejecuta k6 contra los scripts webauthn
#   7. Teardown (kill de PIDs, cleanup de temp files)
#
# Uso:
#   ./loadtest/k6/run-webauthn.sh [challenge|revoke|both]
#
# Default: both (corre los 2 scripts secuencialmente).

set -eu

TARGET="${1:-both}"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v k6 >/dev/null 2>&1; then
  echo "[k6-runner] ERROR: k6 no esta instalado. Instalar via:"
  echo "  sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A36442D574F49C486EB085579"
  echo "  echo 'deb https://dl.k6.io/deb stable main' | sudo tee /etc/apt/sources.list.d/k6.list"
  echo "  sudo apt-get update && sudo apt-get install k6"
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "[k6-runner] ERROR: firebase-tools no esta instalado. npm i -g firebase-tools"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Inicia Firestore emulator
# ─────────────────────────────────────────────────────────────────────────────
echo "[k6-runner] Iniciando Firestore emulator..."
firebase emulators:exec --config firebase.emulator-tests.json --only firestore --project praeventio-test &
EMULATOR_PID=$!
trap 'echo "[k6-runner] Teardown..."; kill $EXPRESS_PID $EMULATOR_PID 2>/dev/null || true; wait 2>/dev/null || true' EXIT

# Espera a que el emulator responda (puerto 8080)
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080 >/dev/null 2>&1; then
    echo "[k6-runner] Firestore emulator listo"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. Inicia Express con E2E_MODE=1 (auth bypass para k6)
# ─────────────────────────────────────────────────────────────────────────────
echo "[k6-runner] Iniciando Express..."
export E2E_MODE=1
export NODE_ENV=test
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export GOOGLE_CLOUD_PROJECT=praeventio-test
export E2E_TEST_SECRET=e2e-test-secret-do-not-use-in-prod
export PORT=3000

# Boot del servidor en background. tsx es el runner TypeScript del repo.
npx tsx server.ts >/tmp/express-k6.log 2>&1 &
EXPRESS_PID=$!

# Espera a que Express responda (puerto 3000)
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[k6-runner] Express listo"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────────────────────
# 4. Ejecuta k6 segun target
# ─────────────────────────────────────────────────────────────────────────────
case "$TARGET" in
  challenge)
    echo "[k6-runner] Corriendo webauthn-challenge.js..."
    k6 run loadtest/k6/webauthn-challenge.js
    ;;
  revoke)
    echo "[k6-runner] Corriendo webauthn-revoke.js..."
    k6 run loadtest/k6/webauthn-revoke.js
    ;;
  both)
    echo "[k6-runner] Corriendo webauthn-challenge.js..."
    k6 run loadtest/k6/webauthn-challenge.js
    echo ""
    echo "[k6-runner] Corriendo webauthn-revoke.js..."
    k6 run loadtest/k6/webauthn-revoke.js
    ;;
  *)
    echo "Uso: $0 [challenge|revoke|both]"
    exit 1
    ;;
esac
