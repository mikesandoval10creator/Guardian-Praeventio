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

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const source = readFileSync(join(here, 'inspect-app.mjs'), 'utf8')

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
