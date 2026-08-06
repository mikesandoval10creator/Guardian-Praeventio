#!/usr/bin/env node
/**
 * security-review.cjs — Praeventio local security auditor
 *
 * Inspirado en el `/cso` de gstack (Garry Tan / gstack toolkit),
 * asimilado en forma "pirata" como artefacto local del repo.
 * Adaptado a Praeventio: HSE app, vida humana en SOS path.
 *
 * Run:  npm run security:review
 *       node scripts/security-review.cjs [--base origin/main] [--scope src/]
 *
 * Output: reports/security/<YYYY-MM-DD>.json + stdout summary.
 *
 * Cero deps nuevas: usa fs/path/child_process del runtime Node.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, 'reports', 'security');
const args = process.argv.slice(2);
const BASE = argFlag('--base') || 'origin/main';
const SCOPE = argFlag('--scope') || '';

function argFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return e.stdout?.toString() || '';
  }
}

function changedFiles() {
  const out = sh(`git diff --name-only ${BASE}...HEAD`);
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => (SCOPE ? f.startsWith(SCOPE) : true))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

const findings = [];
function flag(severity, category, file, line, msg, fix) {
  findings.push({ severity, category, file, line, msg, fix });
}

// ─────────────────────────────────────────────────────────────
// Pattern checks
// ─────────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { re: /\beval\s*\(/, sev: 'Critical', cat: 'OWASP-A03', msg: 'eval() — RCE risk', fix: 'Replace with safe parser (JSON.parse, function map).' },
  { re: /new\s+Function\s*\(/, sev: 'Critical', cat: 'OWASP-A03', msg: 'new Function() — dynamic code execution', fix: 'Avoid; if needed for templating use a sandboxed evaluator.' },
  { re: /dangerouslySetInnerHTML/, sev: 'High', cat: 'OWASP-A03', msg: 'dangerouslySetInnerHTML — verify DOMPurify/sanitize-html upstream', fix: 'Wrap input with DOMPurify.sanitize() or remove.' },
  { re: /child_process|spawn\(|exec\(/, sev: 'High', cat: 'OWASP-A03', msg: 'child_process call — command injection if input is unsanitized', fix: 'Use execFile with arg array, never shell:true with user input.' },
  { re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{20,}['"]/i, sev: 'Critical', cat: 'OWASP-A02', msg: 'Possible hardcoded secret', fix: 'Move to env / Secret Manager / KMS envelope.' },
  { re: /(MD5|sha1)\(/i, sev: 'Medium', cat: 'OWASP-A02', msg: 'Weak hash algorithm', fix: 'Use SHA-256+ for integrity, Argon2/bcrypt for passwords.' },
  { re: /AES-ECB|aes-128-ecb|aes-256-ecb/i, sev: 'High', cat: 'OWASP-A02', msg: 'AES-ECB mode — leaks structure', fix: 'Use AES-GCM (already standard in kmsEnvelope.ts).' },
  { re: /http:\/\/(?!localhost|127\.0\.0\.1)/, sev: 'Medium', cat: 'OWASP-A02', msg: 'Plain http:// URL', fix: 'Use https:// for any external endpoint.' },
  { re: /Math\.random\(\).*(token|secret|key|nonce|id)/i, sev: 'High', cat: 'OWASP-A02', msg: 'Math.random for security context', fix: 'Use crypto.randomUUID() / crypto.getRandomValues().' },
  // Praeventio directives
  { re: /(lockoutTagout|disableMachine|stopEquipment|killSwitch)/, sev: 'Critical', cat: 'PRAEV-D2', msg: 'Praeventio directive 2 — NO bloquear maquinaria automáticamente', fix: 'Reemplazar por alerta no-actuadora; sólo notificar al supervisor.' },
  { re: /(submitToSuseso|pushMuseg|reportToOrganism|achsAutoReport)/i, sev: 'Critical', cat: 'PRAEV-D3', msg: 'Praeventio directive 3 — NO push automático a organismos', fix: 'Requerir flag explícito de consentimiento; default = manual.' },
  { re: /(pkcs7|pkcs12|x509|digitalCertificate|pdfSign\()/i, sev: 'High', cat: 'PRAEV-D1', msg: 'Praeventio directive 1 — usar WebAuthn biom, no certs tradicionales', fix: 'Reemplazar por flujo WebAuthn / FIDO2.' },
  // Prompt injection surface
  { re: /(generateContent|generativeModel|vertex(AI)?|gemini|generateText)\b/, sev: 'Medium', cat: 'PROMPT-INJ', msg: 'LLM call — verify input separation + structured output schema', fix: 'Confirmar Zod responseSchema y separación system/user prompt.' },
];

const ROUTES_GLOB = /^src[/\\]server[/\\]routes[/\\].+\.ts$/i;

function scanFile(rel) {
  const abs = path.join(ROOT, rel);
  let txt;
  try {
    txt = fs.readFileSync(abs, 'utf8');
  } catch {
    return;
  }
  const lines = txt.split(/\r?\n/);

  // Pattern checks
  for (const p of DANGEROUS_PATTERNS) {
    lines.forEach((line, idx) => {
      if (p.re.test(line)) {
        flag(p.sev, p.cat, rel, idx + 1, p.msg, p.fix);
      }
    });
  }

  // Mutative-route specific checks
  if (ROUTES_GLOB.test(rel)) {
    const isMutative = /\b(router\.(post|put|patch|delete)|app\.(post|put|patch|delete))\(/.test(txt);
    if (isMutative) {
      if (!/verifyAuth|requireAuth|authMiddleware/.test(txt)) {
        flag('High', 'OWASP-A01', rel, 1, 'Mutative route without verifyAuth import/usage', 'Importar y aplicar verifyAuth middleware.');
      }
      if (!/z\.object|zod|\.parse\(/.test(txt)) {
        flag('High', 'OWASP-A03', rel, 1, 'Mutative route without Zod validation', 'Validar req.body con Zod schema.');
      }
      if (!/audit_?[Ll]og|writeAudit/.test(txt)) {
        flag('Medium', 'OWASP-A09', rel, 1, 'Mutative route without audit_logs write', 'Escribir audit_logs entry tras la mutación.');
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore rules coverage check
//
// Ticket 39aaa66d-73fe-8134-8321-d1c755ead1f8 — flat regex on
// `allow ... : if true` flagged the 4 DELIBERATE anonymous-readable
// collections (DEA / normatives / community_glossary / global_templates)
// as Critical on every run, drowning the real signal.
//
// Fix: parse the enclosing match chain and subtract the baseline
// allowlist (scripts/open-reads-ratchet-baseline.json). New or
// tightened-wrong collections still surface as Critical.
// ─────────────────────────────────────────────────────────────
const ROOT_RE_OPEN_READS = /^\/databases\/\{[^}]+\}\/documents$/;

function sanitizeLineOpenReads(line) {
  let s = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  const slash = s.indexOf('//');
  if (slash !== -1) s = s.slice(0, slash);
  return s;
}

/**
 * Pure helper exported for vitest (src/__tests__/scripts/securityReview.test.ts).
 * Map each `allow read|write : if true` to its enclosing match chain (root
 * /databases/{db}/documents frame dropped) and return only the paths
 * NOT in the allowlist. Line numbers are 1-based.
 *
 * Mirrors the heuristic of scripts/check-open-reads-ratchet.cjs so the
 * two gates stay coherent.
 */
function evaluateOpenReads(rulesText, allowed) {
  const allowSet = new Set(allowed || []);
  const findings = [];
  const src = rulesText.split(/\r?\n/);
  const stack = []; // { path, depth }
  let depth = 0;

  for (let i = 0; i < src.length; i++) {
    const lineNo = i + 1;
    const raw = src[i];
    const cleaned = sanitizeLineOpenReads(raw);
    let s = cleaned;
    while (/\{[^{}]*\}/.test(s)) s = s.replace(/\{[^{}]*\}/g, '');

    if (/(allow\s+(read|write)\s*:\s*if\s+true|allow\s+(read|write|read,\s*write)\s*:\s*if\s+true)/.test(cleaned)) {
      const frames = stack
        .map((f) => f.path)
        .filter((p) => !ROOT_RE_OPEN_READS.test(p));
      const chain = frames.join('') || '(top-level)';
      if (!allowSet.has(chain)) {
        findings.push({ path: chain, line: lineNo });
      }
    }

    const decl = /^\s*match\s+(\S+)/.exec(cleaned);
    let pushedForThisLine = false;
    for (const ch of s) {
      if (ch === '{') {
        depth += 1;
        if (decl && !pushedForThisLine) {
          stack.push({ path: decl[1], depth });
          pushedForThisLine = true;
        }
      } else if (ch === '}') {
        if (stack.length && stack[stack.length - 1].depth === depth) stack.pop();
        depth -= 1;
      }
    }
  }
  return findings;
}

function loadOpenReadsBaseline() {
  const baselinePath = path.join(ROOT, 'scripts', 'open-reads-ratchet-baseline.json');
  try {
    const data = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    return Array.isArray(data.allowed) ? data.allowed : [];
  } catch {
    return [];
  }
}

function checkFirestoreRulesCoverage() {
  const rulesPath = path.join(ROOT, 'firestore.rules');
  if (!fs.existsSync(rulesPath)) {
    flag('High', 'OWASP-A01', 'firestore.rules', 0, 'firestore.rules not found at repo root', 'Crear o verificar path.');
    return;
  }
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const allowed = loadOpenReadsBaseline();
  const offenders = evaluateOpenReads(rules, allowed);
  for (const o of offenders) {
    flag(
      'Critical',
      'OWASP-A01',
      'firestore.rules',
      o.line,
      `open read/write (allow ... if true) at ${o.path} is NOT in the deliberate-public allowlist`,
      'Reemplazar por reglas con auth/role/tenant checks, o justificar inline y agregar a scripts/open-reads-ratchet-baseline.json.',
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
function main() {
  const files = changedFiles();
  if (!files.length) {
    console.log(`[security-review] No files changed vs ${BASE}. Exiting clean.`);
  }
  for (const f of files) scanFile(f);
  checkFirestoreRulesCoverage();

  const summary = {
    Critical: findings.filter((f) => f.severity === 'Critical').length,
    High: findings.filter((f) => f.severity === 'High').length,
    Medium: findings.filter((f) => f.severity === 'Medium').length,
    Low: findings.filter((f) => f.severity === 'Low').length,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const out = path.join(REPORT_DIR, `${date}.json`);
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    base: BASE,
    scope: SCOPE || '<all>',
    filesScanned: files.length,
    summary,
    findings,
  }, null, 2));

  console.log(`\n[security-review] Files scanned: ${files.length}`);
  console.log(`[security-review] Summary: ${JSON.stringify(summary)}`);
  console.log(`[security-review] Report: ${path.relative(ROOT, out)}`);

  if (summary.Critical > 0) {
    console.error('\n[security-review] CRITICAL findings present. Review required.');
    process.exitCode = 2;
  } else if (summary.High > 0) {
    console.warn('\n[security-review] High-severity findings present.');
    process.exitCode = 1;
  }
}

// Only run main() when invoked as a CLI entry point (`npm run security:review`).
// When vitest imports this script via createRequire, require.main !== module
// and we want to keep the side-effects (process.exitCode, file writes) silent.
if (require.main === module) {
  main();
}

// Exported for vitest (src/__tests__/scripts/securityReview.test.ts).
module.exports = { evaluateOpenReads, sanitizeLineOpenReads, ROOT_RE_OPEN_READS };
