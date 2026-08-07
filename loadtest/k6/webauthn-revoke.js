// loadtest/k6/webauthn-revoke.js
//
// Oleada 4 — k6 load test para POST /api/admin/webauthn/revoke.
//
// NOTA: este script requiere que el caller pase assertAdminCaller.
// El fixture E2E pone role: 'supervisor' que NO es admin — se necesita
// un uid sembrado con role 'admin'. Revisar si la fixture e2e cubre
// este caso; si no, skipeamos este endpoint hasta tener un fixture
// admin (Oleada 5 follow-up).
//
// Thresholds más holgados que challenge:
//   - p95 < 500ms (Firestore read + delete + admin.auth().revokeRefreshTokens)
//   - p99 < 1000ms (el RPC a Firebase Auth puede ser lento)
//   - error rate < 2% (404 esperados si target no tiene creds sembradas)

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const SECRET = __ENV.E2E_TEST_SECRET || 'e2e-test-secret-do-not-use-in-prod';

const revokeLatency = new Trend('webauthn_revoke_latency');
const revokeErrors = new Counter('webauthn_revoke_errors');

export const options = {
  scenarios: {
    admin_revoke_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },  // admin ops son baja frecuencia
        { duration: '4m', target: 20 },   // sostener
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.02'],
    webauthn_revoke_latency: ['p(95)<500'],
  },
};

export default function () {
  // Admin caller — debe pasar assertAdminCaller + assertTargetInCallerTenant.
  // ⚠️ ESTE SCRIPT ASUME QUE LA FIXTURE E2E TIENE UN UID CON role 'admin'.
  // Verificar antes de merge — si no existe, comentar el cuerpo y skipear.
  const adminUid = `load-admin-${__VU}`;
  const targetUid = `load-target-${__VU}-${__ITER}`;

  const headers = {
    'Authorization': `E2E ${SECRET}:${adminUid}`,
    'Content-Type': 'application/json',
  };

  group('admin webauthn revoke', function () {
    const res = http.post(
      `${BASE}/api/admin/webauthn/revoke`,
      JSON.stringify({
        targetUid: targetUid,
        // Sin credentialId → revoke ALL del target
      }),
      { headers }
    );

    const ok = check(res, {
      'status is 200 or 404': (r) => r.status === 200 || r.status === 404,
      'response time < 500ms': (r) => r.timings.duration < 500,
    });

    if (!ok && res.status >= 500) {
      revokeErrors.add(1);
    }

    revokeLatency.add(res.timings.duration);
  });

  sleep(0.5); // admin ops son baja frecuencia — 500ms think time
}
