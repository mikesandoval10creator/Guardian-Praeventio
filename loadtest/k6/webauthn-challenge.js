// loadtest/k6/webauthn-challenge.js
//
// Oleada 4 — k6 load test para GET /api/auth/webauthn/challenge.
//
// Auth mock: el header `Authorization: E2E <secret>:<uid>` que el
// middleware verifyAuth reconoce cuando E2E_MODE=1 (bypass para tests).
// Permite correr k6 contra un Express local sin Firebase Auth real.
//
// Thresholds:
//   - p95 < 200ms (challenge es crypto-barato: random bytes + 1 Firestore write)
//   - p99 < 400ms (headroom para GC pauses del emulator)
//   - error rate < 1% (vida-safety, tolerancia mínima)
//
// Tiempo total del run: 30s ramp + 3m sustain + 30s drain = 4 min.
// Más 60-90s de boot emulator + ~5s teardown → ~6 min total.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const SECRET = __ENV.E2E_TEST_SECRET || 'e2e-test-secret-do-not-use-in-prod';

// Métricas custom para visibilidad en el summary
const challengeLatency = new Trend('webauthn_challenge_latency');
const challengeErrors = new Counter('webauthn_challenge_errors');

export const options = {
  scenarios: {
    steady_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // ramp-up a 50 VUs
        { duration: '3m', target: 50 },   // sostener 3 min
        { duration: '30s', target: 0 },   // ramp-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<400'],
    http_req_failed: ['rate<0.01'],
    webauthn_challenge_latency: ['p(95)<200'],
  },
};

export default function () {
  // Cada VU usa un uid único para evitar colisión en el challenge cache
  const uid = `load-vu-${__VU}-${__ITER}`;
  const headers = {
    'Authorization': `E2E ${SECRET}:${uid}`,
  };

  const res = http.get(`${BASE}/api/auth/webauthn/challenge`, { headers });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has challengeId': (r) => {
      const body = r.json();
      return body && typeof body.challengeId === 'string';
    },
    'has base64 challenge': (r) => {
      const body = r.json();
      return body && typeof body.challenge === 'string' && body.challenge.length > 0;
    },
  });

  if (!ok) {
    challengeErrors.add(1);
  }

  challengeLatency.add(res.timings.duration);
  sleep(0.1); // 100ms think time → ~500 RPS a 50 VUs
}
