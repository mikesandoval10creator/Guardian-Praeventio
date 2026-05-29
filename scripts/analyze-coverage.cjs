'use strict';
// One-off coverage analysis (Plan v3 Fase 1.0). Safe to delete later.
const path = require('node:path');
const s = require('../coverage/coverage-summary.json');
const rel = (p) => path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/');

const byDir = {};
const files = [];
for (const [k, v] of Object.entries(s)) {
  if (k === 'total' || !v.lines) continue;
  const r = rel(k);
  const lines = v.lines;
  files.push({ f: r, pct: lines.pct, total: lines.total, uncov: lines.total - lines.covered });
  const parts = r.split('/');
  const dir = parts.slice(0, Math.min(2, parts.length - 1)).join('/');
  byDir[dir] = byDir[dir] || { covered: 0, total: 0 };
  byDir[dir].covered += lines.covered;
  byDir[dir].total += lines.total;
}

console.log('=== COVERAGE BY TOP DIR (sorted by uncovered-line mass) ===');
Object.entries(byDir)
  .map(([d, m]) => ({ d, pct: m.total ? (100 * m.covered / m.total) : 0, uncov: m.total - m.covered, total: m.total }))
  .sort((a, b) => b.uncov - a.uncov)
  .slice(0, 16)
  .forEach((x) => console.log('  ' + String(x.uncov).padStart(6) + ' uncov  ' + x.pct.toFixed(0).padStart(3) + '%  ' + x.d + ' (' + x.total + ' lines)'));

console.log('');
console.log('=== BIGGEST-LEVERAGE non-UI files (most uncovered lines, pct<60, services/hooks/server/utils) ===');
files
  .filter((x) => x.pct < 60 && x.total >= 40 && /^(src\/(services|hooks|server|utils|store|contexts|lib)|server\.ts)/.test(x.f))
  .sort((a, b) => b.uncov - a.uncov)
  .slice(0, 30)
  .forEach((x) => console.log('  ' + String(x.uncov).padStart(4) + ' uncov  ' + x.pct.toFixed(0).padStart(3) + '%  ' + x.f));
