#!/usr/bin/env node
// scripts/gen-measured-state.cjs
//
// Doc-freshness gate. Two jobs:
//
//   1. Generate docs/ESTADO-MEDIDO.md from the ratchet baselines on disk, so
//      the project's counters are produced by measurement instead of typed by
//      hand. Same contract as gen-api-index.cjs: the committed file must equal
//      the generated one, and a vitest gate fails when it drifts.
//
//   2. Scan the governing .md documents for counters the code contradicts.
//
// Why (measured 2026-07-20): docs/PENDIENTE.md declares itself "la ÚNICA
// fuente de verdad" and stated "39 huérfanos" and "10 routers sin cobertura",
// while the baselines said 4 and 0. For a month that document sent work at
// problems already solved. Prose counters rot silently; the only durable fix
// is to generate them and fail the commit on drift.
//
// Deliberately NOT a source of truth itself: it reads the ratchets, which are
// the things that actually measure. Adding a counter here without a ratchet
// behind it would recreate the very problem this gate exists to kill.
//
//   node scripts/gen-measured-state.cjs           # check (prints drift, exit 1)
//   node scripts/gen-measured-state.cjs --write   # regenerate the doc
//
// Requiring this file does NOT run the CLI (guarded by require.main).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'docs', 'ESTADO-MEDIDO.md');

/** Documents allowed to talk about these counters — scanned for stale claims. */
const TRACKED_DOCS = [
  path.join(REPO_ROOT, 'TODO.md'),
  path.join(REPO_ROOT, 'docs', 'PENDIENTE.md'),
  path.join(REPO_ROOT, 'docs', 'PLAN-MAESTRO-HACER-REAL-2026-06-17.md'),
  path.join(REPO_ROOT, 'CLAUDE.md'),
];

function readJson(relPath) {
  const full = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The counters, straight from the ratchet baselines. A missing baseline yields
 * -1, which renders as "sin medir" instead of a plausible-looking zero: a gate
 * that quietly reports 0 for something it never measured is worse than one
 * that admits the gap.
 */
function readMeasuredState() {
  const connectivity = readJson('scripts/connectivity-ratchet-baseline.json');
  const routers = readJson('scripts/router-test-ratchet-baseline.json');
  const render = readJson('scripts/render-ratchet-baseline.json');
  const anyRatchet = readJson('scripts/any-ratchet-baseline.json');

  return {
    orphans: connectivity ? (connectivity.orphans || []).length : -1,
    routersTotal: routers ? routers.total_routers : -1,
    routersVerified: routers ? routers.verified : -1,
    routersUncovered: routers ? (routers.uncovered || []).length : -1,
    phantoms: render ? (render.phantoms || []).length : -1,
    anyTotal: anyRatchet ? anyRatchet.total : -1,
  };
}

const show = (n) => (n < 0 ? 'sin medir' : String(n));

/**
 * Deliberately no timestamp: the output must be a pure function of the
 * baselines, or the gate would fail on every regeneration and teach everyone
 * to ignore it.
 */
function generate() {
  const s = readMeasuredState();

  const content = `# Estado medido — generado, no escrito a mano

> **No editar a mano.** Lo genera \`scripts/gen-measured-state.cjs\` desde los
> baselines de los ratchets. Para actualizarlo: \`npm run gen:measured-state\`
> y commitear el resultado.
>
> Existe porque el 2026-07-20 se midió que \`docs/PENDIENTE.md\` afirmaba 39
> huérfanos y 10 routers sin cobertura cuando el código tenía 4 y 0. Un
> contador escrito a mano envejece en silencio y manda a trabajar en problemas
> ya resueltos.

## Contadores

| Dimensión | Valor | Lo mide |
| --- | --- | --- |
| Huérfanos (construido, sin montar) | ${show(s.orphans)} | \`connectivity-ratchet\` |
| Componentes fantasma (importados, no renderizados) | ${show(s.phantoms)} | \`render-ratchet\` |
| Routers de backend | ${show(s.routersTotal)} | \`router-test-ratchet\` |
| Routers con test conductual real | ${show(s.routersVerified)} | \`router-test-ratchet\` |
| Routers sin cobertura conductual | ${show(s.routersUncovered)} | \`router-test-ratchet\` |
| Usos de \`as any\` | ${show(s.anyTotal)} | \`any-ratchet\` |

## Qué NO mide este archivo

Estos contadores describen la **estructura** del código: si algo está montado,
renderizado y cubierto por un test que ejercita el código real. No dicen que la
función haga lo que promete en un teléfono, ni que esté desplegada.

- La **deuda funcional pendiente** vive en Notion (tablero Alpha 41 — Tasks).
- Lo que un test **no puede** verificar (supervivencia en segundo plano,
  sensores, entrega real de notificaciones) sólo se comprueba en terreno.
`;

  return { content };
}

/**
 * Stale counters in prose.
 *
 * Anchored on the ratchet's own name plus the word "baseline", never on a bare
 * number: a loose \d+ scan would flag dates, file:line references and sample
 * sizes, the gate would cry wolf, and a gate nobody trusts is worse than none.
 */
const CLAIM_PATTERNS = [
  {
    dimension: 'huérfanos (connectivity-ratchet)',
    key: 'orphans',
    re: /connectivity-ratchet[^)\n]{0,40}?baseline\s+(\d+)/gi,
  },
  {
    dimension: 'routers sin cobertura (router-test-ratchet)',
    key: 'routersUncovered',
    re: /router-test-ratchet[^)\n]{0,40}?baseline\s+(\d+)\s*uncovered/gi,
  },
  {
    dimension: 'componentes fantasma (render-ratchet)',
    key: 'phantoms',
    re: /render-ratchet[^)\n]{0,40}?baseline\s+(\d+)/gi,
  },
  {
    dimension: 'usos de as any (any-ratchet)',
    key: 'anyTotal',
    re: /any-ratchet[^)\n]{0,40}?baseline\s+(\d+)/gi,
  },
];

function findStaleClaims(text, state) {
  const claims = [];

  for (const line of String(text).split('\n')) {
    for (const { dimension, key, re } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        const claimed = Number(match[1]);
        const actual = state[key];
        // A dimension we could not measure cannot contradict anything.
        if (actual < 0) continue;
        if (claimed !== actual) claims.push({ claimed, actual, dimension, line });
      }
    }
  }

  return claims;
}

function main() {
  const { content } = generate();

  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, content, 'utf8');
    console.log(`[measured-state] escrito ${path.relative(REPO_ROOT, OUT)}`);
    return;
  }

  let failed = false;
  const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (committed.trim() !== content.trim()) {
    console.error(
      `[measured-state] FAIL — ${path.relative(REPO_ROOT, OUT)} no coincide con los baselines.\n` +
        '  Regenerar: npm run gen:measured-state',
    );
    failed = true;
  }

  const state = readMeasuredState();
  for (const doc of TRACKED_DOCS) {
    if (!fs.existsSync(doc)) continue;
    for (const c of findStaleClaims(fs.readFileSync(doc, 'utf8'), state)) {
      console.error(
        `[measured-state] FAIL — ${path.relative(REPO_ROOT, doc)}: dice ${c.claimed} para ` +
          `${c.dimension}, el código mide ${c.actual}.\n    "${c.line.trim()}"`,
      );
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('[measured-state] PASS — documentos al día con lo medido.');
}

if (require.main === module) main();

module.exports = { readMeasuredState, generate, findStaleClaims, OUT, TRACKED_DOCS };
