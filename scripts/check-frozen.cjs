#!/usr/bin/env node
/**
 * check-frozen.cjs — PreToolUse hook for Claude Code.
 *
 * Inspirado en `/freeze` de gstack (Garry Tan / gstack toolkit),
 * asimilado en forma "pirata" como artefacto local.
 *
 * Lee `.claude/freeze.json` y, si hay freeze activo, bloquea
 * Edit/Write/MultiEdit cuyo file_path NO esté dentro de los paths
 * congelados.
 *
 * Hook protocol: receives JSON via stdin, exits 0 to allow,
 * exits 2 with stderr to deny (Claude Code reads the message).
 *
 * Cero deps. Tolerante a freeze.json ausente o malformado (allow).
 */

const fs = require('fs');
const path = require('path');

const FREEZE_PATH = path.join(process.cwd(), '.claude', 'freeze.json');

function read(stream) {
  return new Promise((resolve) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => (data += c));
    stream.on('end', () => resolve(data));
    stream.on('error', () => resolve(data));
  });
}

(async () => {
  if (!fs.existsSync(FREEZE_PATH)) process.exit(0);

  let freeze;
  try {
    freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  } catch {
    process.exit(0); // malformed -> allow
  }

  const frozen = Array.isArray(freeze.frozen) ? freeze.frozen : [];
  if (!frozen.length) process.exit(0);

  const raw = await read(process.stdin);
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch {}

  const tool = payload.tool_name || payload.tool || '';
  const editTools = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  if (!editTools.has(tool)) process.exit(0);

  const input = payload.tool_input || payload.input || {};
  const target = (input.file_path || input.path || input.notebook_path || '').replace(/\\/g, '/');
  if (!target) process.exit(0);

  // Normalize repo-relative
  const cwd = process.cwd().replace(/\\/g, '/');
  const rel = target.startsWith(cwd) ? target.slice(cwd.length + 1) : target;

  const inScope = frozen.some((f) => {
    const norm = f.replace(/\\/g, '/').replace(/\/$/, '');
    return rel === norm || rel.startsWith(norm + '/');
  });

  if (inScope) process.exit(0);

  const reason = freeze.reason ? ` (reason: ${freeze.reason})` : '';
  process.stderr.write(
    `[check-frozen] BLOCKED: freeze active${reason}.\n` +
    `Frozen scope: ${frozen.join(', ')}.\n` +
    `Attempted edit: ${rel}\n` +
    `Run /unfreeze to release, or include the file inside the frozen scope.\n`
  );
  process.exit(2);
})();
