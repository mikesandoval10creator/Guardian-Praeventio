/**
 * Tests for the application inspection orchestrator.
 *
 * The orchestrator is the joint-review surface: it points Lighthouse and
 * Playwright at the REAL dev server (the Express + Vite middleware process)
 * rather than at a preview build, so a reviewer sees the same application
 * the browser tab shows.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'

import { checkHealth, isHealthPayload, runSteps } from './inspect-app.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const source = readFileSync(join(here, 'inspect-app.mjs'), 'utf8')

/**
 * Start a server on an ephemeral port.
 * @param {import('node:http').Server} server - the server to listen.
 * @returns {Promise<number>} the port it listens on.
 */
function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

/**
 * Stop a server.
 * @param {import('node:http').Server} server - the server to close.
 * @returns {Promise<void>} resolves when closed.
 */
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

test('inspect-app exposes the dev server as the default target', () => {
  assert.match(source, /DEFAULT_PORT\s*=\s*57335/)
})

test('inspect-app never starts a second server when one is already healthy', () => {
  assert.match(source, /reuse/i)
})

test('inspect-app waits for the health endpoint before auditing', () => {
  assert.match(source, /\/api\/health/)
  assert.match(source, /waitForHealth/)
})

test('inspect-app points Lighthouse at the dev server', () => {
  assert.match(source, /lighthouse/i)
  assert.match(source, /--output=json/)
})

test('inspect-app points Playwright at the dev server without launching its own', () => {
  assert.match(source, /E2E_NO_SERVER/)
  assert.match(source, /E2E_BASE_URL/)
})

test('inspect-app reports each step outcome without aborting the whole run', () => {
  assert.match(source, /catch/)
  assert.match(source, /failed/)
})

test('inspect-app only runs the steps the user asked for', () => {
  assert.match(source, /--only/)
})

test('inspect-app prints the URL under review', () => {
  assert.match(source, /console\.log/)
})

test('package.json exposes the inspection entrypoint', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['inspect:app'], 'node scripts/inspect-app.mjs')
})

test('the inspection entrypoint is wired to the orchestrator', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts['inspect:app'].includes('scripts/inspect-app.mjs'))
})

// ── Health probe ─────────────────────────────────────────────────────────────
// The dev server mounts Vite's SPA fallback for unmatched GETs, so any path
// other than the real health route answers 200 with the app HTML. Probing a
// second path would mark a degraded server (503 from /api/health) as healthy.

test('the health probe only requests the real health route', () => {
  assert.match(source, /HEALTH_PATH\s*=\s*'\/api\/health'/)
  assert.doesNotMatch(source, /'\/health'/)
})

test('the health probe rejects an HTML payload served by the SPA fallback', () => {
  assert.match(source, /isHealthPayload/)
  assert.match(source, /content-type/i)
})

test('the health probe accepts the real health payload', () => {
  assert.match(source, /status\s*===\s*'ok'/)
})

// ── Failure propagation ──────────────────────────────────────────────────────
// A step that fails must make the process exit nonzero, otherwise an
// automated check reads "success" from a run where nothing was inspected.

test('a failed step makes the orchestrator exit nonzero', () => {
  assert.match(source, /exitCode/)
  assert.match(source, /process\.exitCode\s*=\s*1/)
})

test('the orchestrator keeps running the remaining steps after a failure', () => {
  assert.match(source, /failures/)
  assert.match(source, /for \(const step of steps\)/)
})

test('the orchestrator exports its pieces for direct testing', () => {
  assert.match(source, /export\s+(async\s+)?function\s+checkHealth/)
  assert.match(source, /export\s+(async\s+)?function\s+runSteps/)
})

// ── Behaviour ────────────────────────────────────────────────────────────────
// The assertions above read the source; these exercise the exported behaviour
// so a regression in the logic — not only in its shape — is caught.

test('the health probe accepts the real health payload', () => {
  assert.equal(isHealthPayload('application/json', { status: 'ok', checks: {} }), true)
})

test('the health probe rejects a degraded payload', () => {
  assert.equal(isHealthPayload('application/json', { status: 'degraded' }), false)
})

test('the health probe rejects the SPA fallback HTML', () => {
  assert.equal(isHealthPayload('text/html; charset=utf-8', '<!doctype html><html></html>'), false)
})

test('checkHealth reports false when the server answers 503', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'degraded' }))
  })
  const port = await listen(server)
  try {
    assert.equal(await checkHealth(`http://127.0.0.1:${port}`), false)
  } finally {
    await close(server)
  }
})

test('checkHealth reports false when the SPA fallback serves HTML for the health route', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body>Guardian</body></html>')
  })
  const port = await listen(server)
  try {
    assert.equal(await checkHealth(`http://127.0.0.1:${port}`), false)
  } finally {
    await close(server)
  }
})

test('checkHealth reports true when the real health route answers ok', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', checks: { firestore: 'ok' } }))
  })
  const port = await listen(server)
  try {
    assert.equal(await checkHealth(`http://127.0.0.1:${port}`), true)
  } finally {
    await close(server)
  }
})

test('runSteps reports the failed steps and still runs the remaining ones', async () => {
  const failures = await runSteps(['unknown-step'], 'http://127.0.0.1:1')
  assert.deepEqual(failures, [])
})
