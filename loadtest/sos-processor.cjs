// Artillery processor for sos-1000-concurrent.yml.
//
// Each virtual user gets a unique uid (`load-worker-0001` … `load-worker-1000`)
// so the per-uid rate limit (10/min) never trips: every VU fires exactly one
// SOS, against its own bucket.
//
// The E2E_TEST_SECRET must match what the Express server was booted with.
// run.sh exports it; we read it from env here.

'use strict';

let counter = 0;

function assignWorker(context, events, done) {
  counter += 1;
  const idx = String(counter).padStart(4, '0');
  context.vars.uid = `load-worker-${idx}`;
  context.vars.e2eSecret =
    process.env.E2E_TEST_SECRET || 'e2e-test-secret-do-not-use-in-prod';
  return done();
}

module.exports = { assignWorker };
