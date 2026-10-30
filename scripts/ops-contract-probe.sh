#!/usr/bin/env bash
# ops-contract-probe.sh — probes reales del contrato operacional (Etapa C).
#
# Levanta la conversación contra UNA imagen ya corriendo y captura evidencia
# literal de: /api/health (coherencia status↔checks), CSP, CORS (positivo y
# negativo), deep links SPA y /.well-known/*. Cada check queda en un log
# auditable y en un JSON de evidencia. Sale ≠ 0 si algún check falla.
#
# Uso:
#   scripts/ops-contract-probe.sh <api|frontend> <base-url> <sha256-esperado>
#
# Notas de honestidad:
#   - `api` espera que /api/health sea COHERENTE con su dependencia Firestore:
#     sin credenciales GCP el caso observado es 503 + {"status":"degraded",
#     "checks":{"firestore":"fail"}}. Se acepta 200 solo con firestore=ok
#     (coherencia estricta: un health que miente, falla).
#   - CORS negativo: el servidor NO debe emitir Access-Control-Allow-Origin
#     (fail-closed: el browser bloquea; el probe lo exige igual).
set -u

MODE="${1:?modo requerido: api|frontend}"
BASE_URL="${2:?base url requerida}"
EXPECTED_FP="${3:?fingerprint sha-256 esperado requerido}"

TSV_DIR=".ops-probe-tmp-$$"
mkdir -p "$TSV_DIR"
trap 'rm -rf "$TSV_DIR"' EXIT
TSV="$TSV_DIR/checks.tsv"
BODY="$TSV_DIR/body"
HEAD="$TSV_DIR/headers"
PASS=0
FAIL=0

record() { # name result observed
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$TSV"
  echo "[$2] $1 — $3"
  if [ "$2" = "PASS" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
}

fetch() { # url [curl extra args...] → $HEAD headers, $BODY body, $CODE status
  : > "$BODY"; : > "$HEAD"
  CODE=$(curl -sS -D "$HEAD.raw" -o "$BODY" -w '%{http_code}' --max-time 90 "$@") || CODE="000"
  # Los headers HTTP llegan con CRLF; normalizar para grep -x determinista.
  tr -d '\r' < "$HEAD.raw" > "$HEAD"
}

wait_ready() { # url → espera hasta 120s a que responda 200
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1")" = "200" ] && return 0
    sleep 2
  done
  return 1
}

echo "=== ops-contract-probe mode=$MODE base=$BASE_URL ==="

if [ "$MODE" = "api" ]; then
  READY_URL="$BASE_URL/robots.txt"
elif [ "$MODE" = "frontend" ]; then
  READY_URL="$BASE_URL/healthz"
else
  echo "modo desconocido: $MODE"; exit 2
fi

if wait_ready "$READY_URL"; then
  record "ready" "PASS" "$READY_URL responde 200"
else
  record "ready" "FAIL" "$READY_URL nunca respondió 200 (contenedor no levantó)"
  echo "=== resumen: pass=$PASS fail=$FAIL ==="
  exit 1
fi

if [ "$MODE" = "api" ]; then
  # ── 1. /api/health: coherencia status ↔ checks.firestore ↔ código HTTP ──
  fetch "$BASE_URL/api/health"
  HP_BODY=$(cat "$BODY")
  if echo "$HP_BODY" | grep -q '"status"' && echo "$HP_BODY" | grep -q '"firestore"'; then
    if echo "$HP_BODY" | grep -q '"firestore":"ok"' && [ "$CODE" = "200" ] && echo "$HP_BODY" | grep -q '"status":"ok"'; then
      record "api-health" "PASS" "code=$CODE firestore=ok (dependencia real alcanzable)"
    elif echo "$HP_BODY" | grep -q '"firestore":"fail"' && [ "$CODE" = "503" ] && echo "$HP_BODY" | grep -q '"status":"degraded"'; then
      record "api-health" "PASS" "code=$CODE firestore=fail (sin creds GCP: fail-closed honesto)"
    else
      record "api-health" "FAIL" "code=$CODE body=$HP_BODY (coherencia status/checks/HTTP rota)"
    fi
  else
    record "api-health" "FAIL" "code=$CODE body=$HP_BODY (shape inesperado)"
  fi

  # ── 2. CSP en la respuesta ──
  if grep -qi '^content-security-policy:' "$HEAD" \
     && grep -qi "frame-ancestors 'none'" "$HEAD" \
     && grep -qi 'wasm-unsafe-eval' "$HEAD"; then
    record "csp" "PASS" "Content-Security-Policy con frame-ancestors 'none' + wasm-unsafe-eval"
  else
    record "csp" "FAIL" "CSP ausente o incompleta en headers de /api/health"
  fi

  # ── 3. CORS preflight positivo (origin autorizado) ──
  fetch "$BASE_URL/api/health" -X OPTIONS \
    -H "Origin: https://app.praeventio.net" \
    -H "Access-Control-Request-Method: GET"
  if [ "$CODE" = "204" ] \
     && grep -qix 'access-control-allow-origin: https://app.praeventio.net' "$HEAD" \
     && grep -qix 'access-control-allow-credentials: true' "$HEAD"; then
    record "cors-allow" "PASS" "204 + ACAO app.praeventio.net + credentials=true"
  else
    record "cors-allow" "FAIL" "code=$CODE headers=$(tr -d '\r' < "$HEAD" | grep -i 'access-control' | tr '\n' ';')"
  fi

  # ── 4. CORS negativo (origin NO autorizado → sin ACAO, fail-closed) ──
  fetch "$BASE_URL/api/health" -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: GET"
  if grep -qix 'access-control-allow-origin:.*' "$HEAD"; then
    record "cors-deny" "FAIL" "origen malicioso recibió Access-Control-Allow-Origin"
  else
    record "cors-deny" "PASS" "sin Access-Control-Allow-Origin para evil.example.com (fail-closed)"
  fi

  # ── 5. Deep link SPA (fallback del router) ──
  fetch "$BASE_URL/panel/incidentes/abc-123"
  if [ "$CODE" = "200" ] && grep -qi '^content-type:.*text/html' "$HEAD"; then
    record "spa-deep-link" "PASS" "200 text/html para ruta profunda"
  else
    record "spa-deep-link" "FAIL" "code=$CODE type=$(grep -i '^content-type' "$HEAD" | tr -d '\r')"
  fi

  # ── 6. /.well-known/assetlinks.json (deep links Android, nunca vacío) ──
  fetch "$BASE_URL/.well-known/assetlinks.json"
  AL_BODY=$(cat "$BODY")
  if [ "$CODE" = "200" ] && [ -s "$BODY" ] \
     && echo "$AL_BODY" | grep -q 'com.praeventio.guard' \
     && echo "$AL_BODY" | grep -q "$EXPECTED_FP"; then
    record "assetlinks" "PASS" "200, $(wc -c < "$BODY") bytes, contiene paquete + fingerprint esperado"
  else
    record "assetlinks" "FAIL" "code=$CODE bytes=$(wc -c < "$BODY") body=$AL_BODY"
  fi

  # ── 7. apple-app-site-association ──
  fetch "$BASE_URL/.well-known/apple-app-site-association"
  if [ "$CODE" = "200" ] && [ -s "$BODY" ] && grep -q 'applinks' "$BODY"; then
    record "aasa" "PASS" "200 con bloque applinks"
  else
    record "aasa" "FAIL" "code=$CODE bytes=$(wc -c < "$BODY")"
  fi
else
  # ── frontend (nginx estático) ──
  fetch "$BASE_URL/healthz"
  if [ "$CODE" = "200" ]; then
    record "healthz" "PASS" "200 ok"
  else
    record "healthz" "FAIL" "code=$CODE"
  fi

  fetch "$BASE_URL/"
  if grep -qi '^content-security-policy:.*frame-ancestors' "$HEAD" \
     && grep -qi "frame-ancestors 'none'" "$HEAD" \
     && grep -qix 'x-frame-options: DENY' "$HEAD" \
     && grep -qix 'x-content-type-options: nosniff' "$HEAD"; then
    record "static-headers" "PASS" "CSP frame-ancestors + X-Frame-Options DENY + nosniff"
  else
    record "static-headers" "FAIL" "headers=$(tr -d '\r' < "$HEAD" | grep -iE 'content-security|x-frame|x-content' | tr '\n' ';')"
  fi

  fetch "$BASE_URL/panel/incidentes/abc-123"
  if [ "$CODE" = "200" ] && grep -qi '^content-type:.*text/html' "$HEAD"; then
    record "spa-deep-link" "PASS" "200 text/html vía try_files fallback"
  else
    record "spa-deep-link" "FAIL" "code=$CODE"
  fi

  fetch "$BASE_URL/.well-known/assetlinks.json"
  AL_BODY=$(cat "$BODY")
  if [ "$CODE" = "200" ] && [ -s "$BODY" ] \
     && echo "$AL_BODY" | grep -q 'com.praeventio.guard' \
     && echo "$AL_BODY" | grep -q "$EXPECTED_FP"; then
    record "assetlinks" "PASS" "200, $(wc -c < "$BODY") bytes, contiene paquete + fingerprint esperado"
  else
    record "assetlinks" "FAIL" "code=$CODE bytes=$(wc -c < "$BODY") body=$AL_BODY"
  fi

  fetch "$BASE_URL/.well-known/apple-app-site-association"
  if [ "$CODE" = "200" ] && [ -s "$BODY" ] && grep -q 'applinks' "$BODY"; then
    record "aasa" "PASS" "200 con bloque applinks"
  else
    record "aasa" "FAIL" "code=$CODE bytes=$(wc -c < "$BODY")"
  fi
fi

echo "=== resumen: pass=$PASS fail=$FAIL ==="

# JSON de evidencia (best-effort; el log literal es la autoridad)
EVIDENCE_JSON="${EVIDENCE_JSON:-ops-contract-evidence-$MODE.json}"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$TSV" "$EVIDENCE_JSON" "$MODE" "$BASE_URL" "$PASS" "$FAIL" <<'PY'
import csv, json, sys
tsv, out, mode, base, p, f = sys.argv[1:7]
checks = []
with open(tsv, encoding='utf-8') as fh:
    for row in csv.reader(fh, delimiter='\t'):
        if len(row) == 3:
            checks.append({'check': row[0], 'result': row[1], 'observed': row[2]})
json.dump({'mode': mode, 'base_url': base, 'pass': int(p), 'fail': int(f), 'checks': checks},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'evidence json → {out}')
PY
fi

rm -f "$TSV" "$BODY" "$HEAD"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
