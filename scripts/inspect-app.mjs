/**
 * Joint-review orchestrator for the Guardian Praeventio application.
 *
 * The browser viewer shows the app; this script measures it. It runs
 * Lighthouse and a Playwright smoke against the REAL dev server — the Express
 * process that also hosts Vite in middleware mode — instead of the preview
 * build the CI perf job uses, so the numbers describe what a reviewer
 * actually sees while working in the app.
 *
 * Usage:
 *   node scripts/inspect-app.mjs                  # health, Lighthouse, Playwright smoke
 *   node scripts/inspect-app.mjs --only=lighthouse
 *   node scripts/inspect-app.mjs --only=e2e
 *   node scripts/inspect-app.mjs --url=http://localhost:3000
 *
 * The server is reused when it is already healthy; this script never starts a
 * second one, because two Express instances on one Firestore project would
 * fight over emulators and background jobs.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Port the project's dev server listens on (Express + Vite middleware). */
const DEFAULT_PORT = 57335

/** How long to wait for the dev server to answer its health probe. */
const HEALTH_TIMEOUT_MS = 60_000

/** Where Lighthouse and Playwright artifacts are written. */
const REPORT_DIR = 'reports'

/**
 * Parse `--flag=value` arguments.
 * @param {string[]} argv - raw arguments.
 * @returns {{ only: string[], url: string|undefined }} parsed options.
 */
function parseArgs(argv) {
  const only = []
  let url
  for (const arg of argv) {
    if (arg.startsWith('--only=')) only.push(arg.slice('--only='.length))
    else if (arg.startsWith('--url=')) url = arg.slice('--url='.length)
  }
  return { only, url }
}

const args = parseArgs(process.argv.slice(2))

/**
 * Resolve the URL under review.
 * @returns {string} the base URL.
 */
function resolveUrl() {
  if (args.url !== undefined) return args.url.replace(/\/$/, '')
  return `http://localhost:${DEFAULT_PORT}`
}

const BASE_URL = resolveUrl()

/**
 * Probe the dev server's health endpoint.
 * @param {string} url - base URL of the app.
 * @returns {Promise<boolean>} whether the server answered.
 */
async function checkHealth(url) {
  for (const path of ['/api/health', '/health']) {
    try {
      const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(4000) })
      if (response.ok) return true
    } catch {
      // Try the next candidate path.
    }
  }
  return false
}

/**
 * Wait until the dev server answers, reusing one that is already running.
 * @param {string} url - base URL of the app.
 * @returns {Promise<void>} resolves when the server is reachable.
 */
async function waitForHealth(url) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkHealth(url)) {
      console.log(`[inspect] dev server is healthy at ${url}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`dev server did not become healthy at ${url}`)
}

/**
 * Resolve a runnable command for this platform.
 *
 * The npm executables are `.cmd` shims on Windows, which `spawn` cannot run
 * from an argument array without a shell, and shelling out unescaped would be
 * unsafe. Both tools ship a plain JavaScript entry point instead, so the
 * script runs them through Node directly with an argument array.
 * @param {string} script - repository-relative path of the CLI entry point.
 * @returns {{ command: string, prefix: string[] }} the command and any prefix.
 */
function resolveNodeCli(script) {
  const absolute = join(process.cwd(), script)
  if (!existsSync(absolute)) {
    throw new Error(`CLI entry point not found: ${absolute}`)
  }
  return { command: process.execPath, prefix: [absolute] }
}

/**
 * Run a command and capture its output.
 * @param {{ command: string, prefix: string[] }} resolved - resolved command.
 * @param {string[]} commandArgs - arguments for the executable.
 * @param {object} options - extra options.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} the result.
 */
function run(resolved, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(resolved.command, [...resolved.prefix, ...commandArgs], {
      cwd: process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/**
 * Audit the app with Lighthouse.
 * @param {string} url - base URL of the app.
 * @returns {Promise<void>} resolves after reporting.
 */
async function runLighthouse(url) {
  const outDir = join(REPORT_DIR, 'lighthouse')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'dev')
  console.log(`[inspect] lighthouse → ${url}`)
  const result = await run(resolveNodeCli('node_modules/lighthouse/cli/index.js'), [
    url,
    '--output=html',
    '--output=json',
    `--output-path=${outPath}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--quiet',
  ])
  if (result.code !== 0) {
    console.log(`[inspect] lighthouse failed (exit ${result.code})`)
    console.log(result.stderr.trim().split('\n').slice(-8).join('\n'))
    return
  }
  try {
    const report = JSON.parse(readFileSync(`${outPath}.report.json`, 'utf8'))
    const categories = report.categories ?? {}
    for (const [name, category] of Object.entries(categories)) {
      const score = Math.round((category.score ?? 0) * 100)
      console.log(`[inspect]   ${name}: ${score}`)
    }
    console.log(`[inspect]   report: ${outPath}.report.html`)
  } catch (error) {
    console.log(`[inspect]   report written but not parsed: ${error.message}`)
  }
}

/**
 * Run a Playwright smoke against the already-running dev server.
 * @param {string} url - base URL of the app.
 * @returns {Promise<void>} resolves after reporting.
 */
async function runPlaywright(url) {
  console.log(`[inspect] playwright → ${url}`)
  const result = await run(resolveNodeCli('node_modules/@playwright/test/cli.js'), [
    'test',
    'tests/e2e/landing-smoke.spec.ts',
    '--project=chromium',
    '--reporter=line',
  ], {
    env: {
      E2E_NO_SERVER: '1',
      E2E_BASE_URL: url,
    },
  })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const lines = output.split('\n')
  console.log(`[inspect] playwright exit ${result.code}`)
  for (const line of lines.slice(-12)) console.log(`[inspect]   ${line}`)
}

/**
 * Run the requested steps.
 * @returns {Promise<void>} resolves when every requested step has reported.
 */
async function main() {
  const steps = args.only.length > 0 ? args.only : ['lighthouse', 'e2e']
  console.log(`[inspect] target: ${BASE_URL}`)
  console.log(`[inspect] steps: ${steps.join(', ')}`)

  await waitForHealth(BASE_URL)

  for (const step of steps) {
    try {
      if (step === 'lighthouse') await runLighthouse(BASE_URL)
      else if (step === 'e2e') await runPlaywright(BASE_URL)
      else console.log(`[inspect] unknown step: ${step}`)
    } catch (error) {
      console.log(`[inspect] step "${step}" failed: ${error.message}`)
    }
  }

  console.log(`[inspect] done`)
}

await main()
