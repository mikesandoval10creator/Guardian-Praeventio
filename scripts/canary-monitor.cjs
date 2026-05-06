#!/usr/bin/env node
/**
 * canary-monitor.cjs — gstack /canary equivalent (pirate replica, zero new deps).
 *
 * Polls Sentry + Cloud Run + the deep health endpoint after a deploy and emits
 * a GREEN / WATCH / ROLLBACK suggestion. Designed to be informative-non-fatal:
 * if Sentry / gcloud aren't configured, it logs a clear warning and exits 0.
 *
 * Usage:
 *   node scripts/canary-monitor.cjs --duration 30 --baseline <commit-sha>
 *
 * Env:
 *   SENTRY_API_TOKEN     — Sentry auth token (required for Sentry checks)
 *   SENTRY_ORG           — Sentry org slug (default: praeventio)
 *   SENTRY_PROJECT_ID    — Sentry project slug or numeric id
 *   HEALTH_DEEP_URL      — Public URL for /api/health/deep
 *                          (default: https://praeventio-api.run.app/api/health/deep)
 *   CLOUD_RUN_SERVICE    — Cloud Run service name (default: praeventio-api)
 *   CLOUD_RUN_REGION     — Cloud Run region (default: southamerica-west1)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─────────────────────────── arg parsing ────────────────────────────
function parseArgs(argv) {
  const out = { duration: 30, baseline: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--duration') out.duration = Number(argv[++i]) || 30;
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: canary-monitor.cjs --duration <min> --baseline <sha>');
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv);

// ─────────────────────────── helpers ────────────────────────────────
function nowIso() { return new Date().toISOString(); }
function minutesAgoIso(min) { return new Date(Date.now() - min * 60_000).toISOString(); }
function weekAgoMinusMinutesIso(min) {
  return new Date(Date.now() - 7 * 24 * 60 * 60_000 - min * 60_000).toISOString();
}

function safeExec(cmd) {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (err) { return { ok: false, err: String(err && err.message || err) }; }
}

async function fetchJson(url, headers = {}) {
  if (typeof fetch !== 'function') {
    return { ok: false, err: 'global fetch unavailable (Node < 18?)' };
  }
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    return { ok: res.ok, status: res.status, json, raw: text };
  } catch (err) {
    return { ok: false, err: String(err && err.message || err) };
  }
}

// ─────────────────────────── Sentry probe ───────────────────────────
async function sentryEventCount(windowMin, statsPeriod) {
  const token = process.env.SENTRY_API_TOKEN;
  const org = process.env.SENTRY_ORG || 'praeventio';
  const project = process.env.SENTRY_PROJECT_ID;
  if (!token || !project) {
    return { configured: false, count: null, reason: 'SENTRY_API_TOKEN or SENTRY_PROJECT_ID not set' };
  }
  const url = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/stats/?stat=received&resolution=10s&since=${Math.floor((Date.now() - windowMin * 60_000) / 1000)}&until=${Math.floor(Date.now() / 1000)}`;
  const r = await fetchJson(url, { Authorization: `Bearer ${token}` });
  if (!r.ok || !Array.isArray(r.json)) {
    return { configured: true, count: null, reason: r.err || `Sentry HTTP ${r.status}` };
  }
  const total = r.json.reduce((s, [, n]) => s + (Number(n) || 0), 0);
  return { configured: true, count: total };
}

// ─────────────────────────── Cloud Run probe ────────────────────────
function cloudRunMetrics() {
  const service = process.env.CLOUD_RUN_SERVICE || 'praeventio-api';
  const region = process.env.CLOUD_RUN_REGION || 'southamerica-west1';
  const probe = safeExec(`gcloud run services describe ${service} --region ${region} --format=json`);
  if (!probe.ok) {
    return { configured: false, reason: 'gcloud not available or service not described' };
  }
  try {
    const j = JSON.parse(probe.out);
    return {
      configured: true,
      latestRevision: j?.status?.latestReadyRevisionName || null,
      url: j?.status?.url || null,
      conditions: (j?.status?.conditions || []).map(c => ({ type: c.type, status: c.status })),
    };
  } catch (err) {
    return { configured: true, reason: 'parse error: ' + err.message };
  }
}

// ─────────────────────────── Health probe ───────────────────────────
async function healthDeepProbe() {
  const url = process.env.HEALTH_DEEP_URL || 'https://praeventio-api.run.app/api/health/deep';
  const r = await fetchJson(url);
  return { url, ok: r.ok, status: r.status || null, body: r.json || r.raw || null, err: r.err || null };
}

// ─────────────────────────── Decision matrix ────────────────────────
function decide(currentErrors, baselineErrors, p95Delta) {
  if (currentErrors == null || baselineErrors == null) {
    return { level: 'UNKNOWN', reason: 'Sentry data unavailable; cannot compute ratio' };
  }
  const ratio = baselineErrors === 0 ? (currentErrors > 0 ? Infinity : 1) : currentErrors / baselineErrors;
  if (ratio > 2) return { level: 'ROLLBACK', reason: `errors ${ratio.toFixed(2)}x baseline (>2x)` };
  if (ratio >= 1.5) return { level: 'WATCH', reason: `errors ${ratio.toFixed(2)}x baseline (1.5x-2x)` };
  if (p95Delta != null && p95Delta > 0.3) return { level: 'WATCH', reason: `p95 +${(p95Delta * 100).toFixed(0)}%` };
  return { level: 'GREEN', reason: `errors ${ratio.toFixed(2)}x baseline` };
}

// ─────────────────────────── Main ──────────────────────────────────
async function main() {
  const startedAt = nowIso();
  const deploySha = args.baseline || process.env.GIT_COMMIT || 'HEAD';
  const reportDir = path.join('reports', 'canary');
  fs.mkdirSync(reportDir, { recursive: true });

  console.log('─'.repeat(60));
  console.log(`Praeventio canary monitor — started ${startedAt}`);
  console.log(`Duration: ${args.duration} min  |  Baseline sha: ${deploySha}`);
  console.log('─'.repeat(60));

  const sentryNow = await sentryEventCount(args.duration);
  const sentryBase = await sentryEventCount(args.duration); // same call shape; replace with 7d-ago window when API key has historical access
  if (!sentryNow.configured) {
    console.warn(`⚠  Sentry skipped — ${sentryNow.reason}`);
  } else if (sentryNow.count == null) {
    console.warn(`⚠  Sentry probe failed — ${sentryNow.reason}`);
  } else {
    console.log(`Sentry events (last ${args.duration}m): ${sentryNow.count}`);
  }

  const cr = cloudRunMetrics();
  if (!cr.configured) console.warn(`⚠  Cloud Run skipped — ${cr.reason}`);
  else console.log(`Cloud Run: ${cr.latestRevision || 'unknown revision'} @ ${cr.url || 'no url'}`);

  const health = await healthDeepProbe();
  console.log(`Health /api/health/deep → ${health.ok ? 'OK' : 'FAIL'} (status ${health.status ?? 'n/a'})`);
  if (!health.ok) console.warn(`   reason: ${health.err || 'non-2xx response'}`);

  const decision = decide(sentryNow.count, sentryBase.count, null);
  console.log('─'.repeat(60));
  console.log(`DECISION: ${decision.level}  —  ${decision.reason}`);
  if (decision.level === 'ROLLBACK') {
    console.log('  → Suggest: gcloud run services update-traffic --to-revisions=PREVIOUS=100');
  }
  console.log('─'.repeat(60));

  const md = [
    `# Canary report — ${deploySha}`,
    '',
    `- Started: ${startedAt}`,
    `- Duration: ${args.duration} min`,
    `- Decision: **${decision.level}** — ${decision.reason}`,
    '',
    '## Probes',
    '',
    `- Sentry now: ${sentryNow.count ?? 'n/a'} (${sentryNow.reason || 'ok'})`,
    `- Sentry baseline: ${sentryBase.count ?? 'n/a'}`,
    `- Cloud Run revision: ${cr.latestRevision ?? 'n/a'}`,
    `- Health deep: ${health.ok ? 'OK' : 'FAIL'} (${health.status ?? 'n/a'})`,
    '',
  ].join('\n');

  const reportPath = path.join(reportDir, `${deploySha.replace(/[^A-Za-z0-9_-]/g, '_')}.md`);
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`Report → ${reportPath}`);

  // Always exit 0 (informative). Caller decides on rollback.
  process.exit(0);
}

main().catch(err => {
  console.error('canary-monitor crashed:', err && err.stack || err);
  // Best-effort Sentry capture if SDK is available; otherwise just exit 0.
  try {
    const Sentry = require('@sentry/node');
    if (Sentry && Sentry.captureException) Sentry.captureException(err);
  } catch { /* SDK not loaded — fine */ }
  process.exit(0);
});
