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

console.log(`SCHEDULER_CRONS=PASS (${required.length} vital jobs validated)`);
