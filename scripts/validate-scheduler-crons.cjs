#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const workflow = fs
  .readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8')
  .replace(/\r\n/g, '\n');
const lines = workflow.split('\n');

const required = [
  ['lone-worker-escalation', '*/5 * * * *', '/api/maintenance/run-lone-worker-escalation'],
  ['man-down-escalation', '* * * * *', '/api/maintenance/run-man-down-escalation'],
  ['aggregate-ai-feedback', '0 8 * * 1', '/api/admin/jobs/aggregate-ai-feedback'],
  ['b2d-mrr-snapshot', '30 0 1 * *', '/api/maintenance/run-b2d-mrr-snapshot'],
];

for (const [job, schedule, endpoint] of required) {
  const start = lines.findIndex((line) => line.trim() === `ensure_job "${job}" \\` || line.trim() === `ensure_vital_job "${job}" \\`);
  const valid =
    start >= 0 &&
    lines[start + 1]?.trim() === `"${schedule}" \\` &&
    lines[start + 2]?.trim() === `"${endpoint}" \\`;
  if (!valid) {
    throw new Error(`Missing or invalid vital scheduler contract: ${job}`);
  }
}

if (workflow.includes('"*/5* * * *"')) {
  throw new Error('Malformed lone-worker cron expression detected');
}

// The vital step must prove a real HTTP execution, not just job existence.
// Cloud Scheduler exposes the last attempt result as `status.code`; code 0 is
// the gRPC representation of an HTTP 2xx acknowledgement. A fresh job is
// allowed to have no previous attempt before the forced run below completes.
const vitalStepStart = workflow.indexOf('Setup Cloud Scheduler — vital life-safety crons');
const vitalStepEnd = workflow.indexOf('Discovery 2026-08-17', vitalStepStart);
if (vitalStepStart < 0 || vitalStepEnd < 0) {
  throw new Error('Vital Cloud Scheduler step is missing or moved');
}
const vitalStep = workflow.slice(vitalStepStart, vitalStepEnd);
if (vitalStep.includes('continue-on-error: true')) {
  throw new Error('Vital Cloud Scheduler step must fail closed');
}
for (const requiredFragment of [
  'gcloud scheduler jobs run "$probe_name"',
  "--format='value(lastAttemptTime,status.code)'",
  'status_code="0"',
  '--uri="${URL}${path}?schedulerProbe=1"',
  'cleanup_probe_jobs',
]) {
  if (!vitalStep.includes(requiredFragment)) {
    throw new Error(`Vital Scheduler 2xx verification is incomplete: ${requiredFragment}`);
  }
}

console.log(`SCHEDULER_CRONS=PASS (${required.length} vital jobs validated)`);
