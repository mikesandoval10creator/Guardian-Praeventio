#!/usr/bin/env node
/**
 * Weekly retrospective generator.
 *
 * Replicates gstack `/retro` as a local artifact (Sprint 40 pirate-form
 * assimilation, no gstack toolkit dep). Reads:
 *   - git log (commits, authors, scopes parsed from conventional commits)
 *   - gh pr list --state merged (if `gh` CLI is installed; degrades cleanly)
 *   - Test count delta (counts *.test.* files at HEAD vs at the from-ref)
 *
 * Produces a structured Markdown retro into reports/retro/week-of-<from>.md.
 *
 * Usage:
 *   node scripts/retro-weekly.cjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--author <name>]
 *
 * Defaults:
 *   --from = today - 7d
 *   --to   = today
 *   --author = (all)
 *
 * Output: prints summary to stdout AND writes the markdown file.
 *
 * No new deps. Uses only `node:child_process` + `node:fs` + `node:path`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

// ---------- arg parsing ----------

function parseArgs(argv) {
  const out = { from: null, to: null, author: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--author') out.author = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: retro-weekly.cjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--author <name>]');
      process.exit(0);
    }
  }
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (!out.to) out.to = fmt(today);
  if (!out.from) {
    const d = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    out.from = fmt(d);
  }
  return out;
}

// ---------- git helpers ----------

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function gitSafe(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

// ---------- gh helpers (optional) ----------

function ghAvailable() {
  // bash: command -v gh — fall back to direct path on Windows.
  const candidates = ['gh', 'gh.exe'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  // Windows default install
  const winPath = 'C:/Program Files/GitHub CLI/gh.exe';
  if (fs.existsSync(winPath)) return winPath;
  return null;
}

function ghPrsMergedBetween(ghBin, from, to) {
  if (!ghBin) return { available: false, prs: [] };
  // gh pr list supports --search merged:>=YYYY-MM-DD and merged:<=YYYY-MM-DD.
  const search = `merged:${from}..${to}`;
  const r = spawnSync(
    ghBin,
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      '200',
      '--search',
      search,
      '--json',
      'number,title,author,mergedAt,additions,deletions,files',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    return { available: true, prs: [], error: r.stderr || 'gh pr list failed' };
  }
  try {
    const arr = JSON.parse(r.stdout || '[]');
    return { available: true, prs: arr };
  } catch (e) {
    return { available: true, prs: [], error: `parse: ${e.message}` };
  }
}

// ---------- analytics ----------

const SCOPE_RE = /^(feat|fix|refactor|docs|test|chore|perf|ci|build|style|revert)(\([^)]+\))?(!)?:/i;

function parseCommits(rawLog) {
  // pretty: %H|%an|%ae|%ad|%s
  const lines = rawLog.split('\n').filter(Boolean);
  return lines.map((l) => {
    const [hash, author, email, date, ...rest] = l.split('|');
    const subject = rest.join('|');
    const m = subject.match(SCOPE_RE);
    const type = m ? m[1].toLowerCase() : 'other';
    const breaking = !!(m && m[3] === '!');
    return { hash, author, email, date, subject, type, breaking };
  });
}

function tallyByAuthor(commits, prs) {
  const byAuthor = new Map();
  const ensure = (name) => {
    if (!byAuthor.has(name)) {
      byAuthor.set(name, {
        commits: 0,
        loc: { add: 0, del: 0 },
        prsMerged: 0,
        types: {},
        breaking: 0,
      });
    }
    return byAuthor.get(name);
  };
  for (const c of commits) {
    const e = ensure(c.author);
    e.commits++;
    e.types[c.type] = (e.types[c.type] || 0) + 1;
    if (c.breaking) e.breaking++;
  }
  for (const pr of prs) {
    const name = pr.author?.login || pr.author?.name || 'unknown';
    const e = ensure(name);
    e.prsMerged++;
    e.loc.add += pr.additions || 0;
    e.loc.del += pr.deletions || 0;
  }
  return byAuthor;
}

function countTests() {
  // Count *.test.* and *.spec.* files at HEAD.
  const out = gitSafe([
    'ls-files',
    '--',
    '*.test.ts',
    '*.test.tsx',
    '*.test.cjs',
    '*.test.mjs',
    '*.test.js',
    '*.spec.ts',
    '*.spec.tsx',
    '*.spec.js',
  ]);
  const files = out.split('\n').filter(Boolean);
  return files.length;
}

function countTestsAtRef(ref) {
  // git ls-tree at the given ref. We can't trivially filter by glob server-side
  // across all ext combos, so we list and grep.
  const out = gitSafe(['ls-tree', '-r', '--name-only', ref]);
  if (!out) return null;
  const files = out
    .split('\n')
    .filter((p) => /\.(test|spec)\.(ts|tsx|cjs|mjs|js)$/.test(p));
  return files.length;
}

function findRefAtDate(date) {
  // Find the last commit on the current branch on/before <date>.
  const out = gitSafe([
    'rev-list',
    '-1',
    `--before=${date} 23:59:59`,
    'HEAD',
  ]);
  return out.trim() || null;
}

function highChurnFiles(from, to, top = 5) {
  const out = gitSafe([
    'log',
    `--since=${from}`,
    `--until=${to} 23:59:59`,
    '--pretty=format:',
    '--name-only',
  ]);
  const counts = new Map();
  for (const line of out.split('\n')) {
    const f = line.trim();
    if (!f) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([file, hits]) => ({ file, hits }));
}

function detectForcePushes(from, to) {
  // Heuristic: reflog entries with `forced-update` between dates.
  const reflog = gitSafe(['reflog', '--date=iso']);
  const lines = reflog.split('\n').filter((l) => /forced-update/i.test(l));
  return lines.length;
}

function prsWithoutTests(prs) {
  // Heuristic: PR has no file matching test/spec.
  const list = [];
  for (const pr of prs) {
    const files = pr.files || [];
    const hasTest = files.some((f) => /(test|spec|__tests__)/i.test(f.path || ''));
    if (!hasTest && files.length > 0) {
      list.push({ number: pr.number, title: pr.title });
    }
  }
  return list;
}

// ---------- main ----------

function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[retro-weekly] from=${args.from} to=${args.to}${args.author ? ` author=${args.author}` : ''}`);

  // Commits
  const sinceUntil = [
    `--since=${args.from}`,
    `--until=${args.to} 23:59:59`,
    '--pretty=format:%H|%an|%ae|%ad|%s',
    '--date=short',
    '--no-merges',
  ];
  if (args.author) sinceUntil.push(`--author=${args.author}`);
  const rawLog = gitSafe(['log', ...sinceUntil]);
  const commits = parseCommits(rawLog);

  // PRs (gh optional)
  const ghBin = ghAvailable();
  const prData = ghPrsMergedBetween(ghBin, args.from, args.to);
  const prs = prData.prs;

  // Per-author tally
  const byAuthor = tallyByAuthor(commits, prs);

  // Test delta
  const fromRef = findRefAtDate(args.from);
  const testsBefore = fromRef ? countTestsAtRef(fromRef) : null;
  const testsNow = countTests();
  const testDelta = testsBefore != null ? testsNow - testsBefore : null;

  // Risk flags
  const churn = highChurnFiles(args.from, args.to, 5);
  const forcePushes = detectForcePushes(args.from, args.to);
  const noTestPrs = prsWithoutTests(prs);

  // Highlights
  const feats = commits.filter((c) => c.type === 'feat');
  const fixes = commits.filter((c) => c.type === 'fix');
  const refactors = commits.filter((c) => c.type === 'refactor');
  const breaking = commits.filter((c) => c.breaking);

  // ---------- render markdown ----------

  const lines = [];
  lines.push(`# Retrospective — week of ${args.from} → ${args.to}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Commits: **${commits.length}**`);
  lines.push(`- Authors: **${byAuthor.size}**`);
  lines.push(`- PRs merged: **${prs.length}**${prData.available ? '' : ' _(gh CLI not available — PR data missing)_'}`);
  lines.push(`- feat: ${feats.length} | fix: ${fixes.length} | refactor: ${refactors.length} | breaking: ${breaking.length}`);
  if (testDelta !== null) {
    lines.push(`- Test files: ${testsBefore} → ${testsNow} (Δ ${testDelta >= 0 ? '+' : ''}${testDelta})`);
  } else {
    lines.push(`- Test files now: ${testsNow} (baseline ref unavailable)`);
  }
  lines.push('');

  lines.push('## Per-author');
  lines.push('');
  lines.push('| Author | Commits | PRs merged | LOC +/− | Top types | Breaking |');
  lines.push('|---|---:|---:|---|---|---:|');
  const authors = [...byAuthor.entries()].sort((a, b) => b[1].commits - a[1].commits);
  for (const [name, stats] of authors) {
    const topTypes = Object.entries(stats.types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, n]) => `${t}:${n}`)
      .join(', ');
    lines.push(
      `| ${name} | ${stats.commits} | ${stats.prsMerged} | +${stats.loc.add}/−${stats.loc.del} | ${topTypes || '—'} | ${stats.breaking} |`,
    );
  }
  lines.push('');

  lines.push('## Highlights');
  lines.push('');
  lines.push('### Top features (feat)');
  if (feats.length === 0) lines.push('- _none_');
  for (const c of feats.slice(0, 10)) lines.push(`- \`${c.hash.slice(0, 7)}\` ${c.subject} — _${c.author}_`);
  lines.push('');
  lines.push('### Top fixes (fix)');
  if (fixes.length === 0) lines.push('- _none_');
  for (const c of fixes.slice(0, 10)) lines.push(`- \`${c.hash.slice(0, 7)}\` ${c.subject} — _${c.author}_`);
  lines.push('');

  if (refactors.length) {
    lines.push('### Refactors');
    for (const c of refactors.slice(0, 5)) lines.push(`- \`${c.hash.slice(0, 7)}\` ${c.subject} — _${c.author}_`);
    lines.push('');
  }

  lines.push('## Risk flags');
  lines.push('');
  lines.push(`- Force pushes detected (heuristic): **${forcePushes}**`);
  lines.push(`- Breaking commits: **${breaking.length}**`);
  if (breaking.length) {
    for (const c of breaking) lines.push(`  - \`${c.hash.slice(0, 7)}\` ${c.subject} — _${c.author}_`);
  }
  lines.push(`- PRs merged without tests (heuristic): **${noTestPrs.length}**`);
  for (const p of noTestPrs.slice(0, 5)) lines.push(`  - #${p.number} ${p.title}`);
  lines.push('');
  lines.push('### High-churn files (top 5)');
  if (churn.length === 0) lines.push('- _none_');
  for (const c of churn) lines.push(`- ${c.file} — ${c.hits} commit(s)`);
  lines.push('');

  lines.push('## Sprint cycle position');
  lines.push(`- PRs merged in window: ${prs.length}`);
  if (ghBin && prData.available) {
    // Quick open count
    const openR = spawnSync(ghBin, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number'], {
      encoding: 'utf8',
    });
    if (openR.status === 0) {
      try {
        const open = JSON.parse(openR.stdout || '[]');
        lines.push(`- PRs open right now: ${open.length}`);
      } catch {
        // ignore
      }
    }
  } else {
    lines.push('- PRs open: _(gh CLI unavailable — skipped)_');
  }
  lines.push('');

  lines.push('## Qualitative notes');
  lines.push('');
  lines.push('_Para sintetizar narrativa humana sobre estos stats, correr `/retro` en Claude Code después de generar este reporte._');
  lines.push('');
  lines.push('---');
  lines.push(`_inspired by gstack \`/retro\`, asimilado pirate-form Sprint 40._`);
  lines.push('');

  const md = lines.join('\n');

  // Save
  const outDir = path.join(process.cwd(), 'reports', 'retro');
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `week-of-${args.from}.md`;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, md, 'utf8');
  console.log(`[retro-weekly] wrote ${filePath} (${md.length} bytes)`);

  // Stdout summary
  console.log('---');
  console.log(`commits=${commits.length} authors=${byAuthor.size} prs=${prs.length} tests=${testsNow} (Δ ${testDelta ?? 'n/a'})`);
}

main();
