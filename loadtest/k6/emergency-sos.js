// loadtest/k6/emergency-sos.js
//
// Oleada 4 PR-2 — k6 load test para POST /api/emergency/sos.
//
// /api/emergency/sos es VIDA-SAFETY DIRECTO: si el endpoint no responde
// <5s bajo carga, el sistema falla su promesa principal ("trabajador
// recibe ayuda"). Es el endpoint más sensible de Guardian.
//
// Auth mock: header `Authorization: E2E <secret>:<uid>` reconocido por
// verifyAuth cuando E2E_MODE=1. Bypass rate limit también bajo E2E_MODE.
//
// Idempotency-Key: header obligatorio en este endpoint (idempotencyKey()
// middleware). Cada VU genera keys únicos para evitar colisión.
//
// Payload:
//   { type: 'sos', projectId, geo: { lat, lng, accuracy }, timestamp }
//
// Thresholds (alineados con la promesa vida-safety):
//   - p95 < 2000ms (ventana para red de faena 3G + dispatcher fan-out)
//   - p99 < 4000ms (hard ceiling — más allá el worker ve UI colgada)
//   - error rate < 0.5% (cero tolerancia — un SOS fallido puede costar
//     una vida)
//
// Tiempo total del run: 20s ramp + 2m sustain + 20s drain = 2m 40s.
// Más 60-90s de boot emulator + ~5s teardown → ~4 min total.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const SECRET = __ENV.E2E_TEST_SECRET || 'e2e-test-secret-do-not-use-in-prod';
const PROJECT_ID = __ENV.PROJECT_ID || 'loadtest-project-001';

// Métricas custom — alta visibilidad en el summary de k6
const sosLatency = new Trend('sos_latency');
const sosErrors = new Counter('sos_errors');
const sosSuccessRate = new Rate('sos_success_rate');

export const options = {
  scenarios: {
    sos_burst: {
      // Simula una rafaga de SOS simultaneos (peor caso: multiple
      // trabajadores piden ayuda al mismo tiempo tras un accidente).
      // 20 VUs es modesto pero suficiente para validar el dispatcher
      // fan-out + Firestore writes + supervisor push notifications.
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },  // ramp-up
        { duration: '2m', target: 20 },   // sosten
        { duration: '20s', target: 0 },   // ramp-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Vida-safety: thresholds son HARD ceilings. Si se rompen, el CI
    // falla. Ajustar requiere justificacion (no relajar sin evidencia).
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    http_req_failed: ['rate<0.005'],
    sos_latency: ['p(95)<2000'],
    sos_success_rate: ['rate>0.995'],
  },
};

export default function () {
  // Cada VU usa un uid unico para no compartir buckets de rate-limit
  // (E2E_MODE bypass el rate limit, pero mantengo el patron por si
  // el script se corre en modo non-E2E para validacion adicional).
  const uid = `load-vu-${__VU}-${__ITER}`;

  // Idempotency key unico por iteracion — necesario porque
  // idempotencyKey() middleware cachea por (uid, projectId, key).
  // Sin keys unicos, la primera request "consume" el key y las
  // subsiguientes devuelven 200 cached (false success).
  const idempotencyKey = `sos-${__VU}-${__ITER}-${Date.now()}`;

  const url = `${BASE}/api/emergency/sos`;
  const headers = {
    'Authorization': `E2E ${SECRET}:${uid}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  const payload = JSON.stringify({
    type: 'sos',
    projectId: PROJECT_ID,
    geo: { lat: -33.4489, lng: -70.6693, accuracy: 10 },
    timestamp: new Date().toISOString(),
  });

  const res = http.post(url, payload, { headers });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has alertId': (r) => {
      const body = r.json();
      return body && typeof body.alertId === 'string' && body.alertId.length > 0;
    },
    'ok is true': (r) => {
      const body = r.json();
      return body && body.ok === true;
    },
    'response time < 2000ms': (r) => r.timings.duration < 2000,
  });

  if (!ok) {
    sosErrors.add(1);
  }
  sosSuccessRate.add(ok);

  sosLatency.add(res.timings.duration);
  sleep(0.5); // 500ms think time — un SOS real es un evento discreto, no un loop
}
