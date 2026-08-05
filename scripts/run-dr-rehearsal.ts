#!/usr/bin/env node
/**
 * run-dr-rehearsal.mjs — tarea P1 DR_RUNBOOK.
 *
 * Cierra la brecha del runbook (DR_RUNBOOK.md §3.4): el primer lunes de
 * cada mes se DEBE ejecutar un simulacro de restauración. Antes de este
 * script, el RPO/RTO eran cifras de promesa sin evidencia fechada.
 *
 * El orquestador:
 *   1. Llama a `node scripts/restore-firestore.cjs --dry-run` contra el
 *      nombre de bucket exportado más reciente (configurable).
 *   2. Captura stdout/stderr + timestamps de inicio/fin.
 *   3. Escribe un reporte fechado en
 *      `docs/runbooks/restore-rehearsals/YYYY-MM.md` con RPO/RTO registrados
 *      y el resultado del dry-run.
 *   4. Devuelve ok=false si el dry-run no limpiamente o si no se pudo
 *      escribir el reporte (para que CI/programador sepa regenerarlo).
 *
 * En `--live` haría la restauración real (sin dry-run), pero el modo
 * por defecto es dry-run para que el job mensual sea seguro de re-correr.
 *
 * Por qué este código en `scripts/` y no en `src/server/`:
 *   - El orquestador es un binario node: se invoca desde Cloud Scheduler
 *     o manual, no a través de Express/HTTPS.
 *   - No comparte dependencias con la app (vite, express, firestore
 *     admin) — sólo con `@google-cloud/firestore` y `@google-cloud/storage`,
 *     vía el subproceso de `restore-firestore.cjs`.
 *
 * El test TDD vive en `src/__tests__/scripts/run-dr-rehearsal.test.ts` y
 * mockea `execRestore` + `writeFile` para no tocar GCP ni disco.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const REHEARSAL_DIR = path.join(REPO_ROOT, 'docs', 'runbooks', 'restore-rehearsals');
const RESTORE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'restore-firestore.cjs');

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface RehearsalOpts {
  isoMonth: string;
  exportPath: string;
  stagingProject: string;
  now?: () => Date;
  execRestore?: (args: { exportPath: string; stagingProject: string }) => Promise<ExecResult>;
  writeFile?: (p: string, c: string) => Promise<void>;
}

export interface RehearsalResult {
  ok: boolean;
  reportPath: string;
  report: string;
}

/**
 * Render the report body. Pure (no I/O) so it stays testable without
 * touching the filesystem.
 */
export function buildRehearsalReport(input: {
  isoMonth: string;
  exportPath: string;
  stagingProject: string;
  startedAt: string;
  finishedAt: string;
  restore: { ok: boolean; stdout: string; stderr: string };
}): string {
  const lines: string[] = [];
  lines.push(`# DR Restore Rehearsal — ${input.isoMonth}`);
  lines.push('');
  lines.push('- **Started**: ' + input.startedAt);
  lines.push('- **Finished**: ' + input.finishedAt);
  lines.push('- **Export path**: `' + input.exportPath + '`');
  lines.push('- **Staging project**: `' + input.stagingProject + '`');
  lines.push('- **Outcome**: ' + (input.restore.ok ? 'PASS' : 'FAIL'));
  lines.push('');
  lines.push('## RPO / RTO');
  lines.push('');
  lines.push('- **RPO** (Recovery Point Objective): limitada por la frecuencia del export job (`firestore-backup`). Para `audit_logs` e `invoices`, reducibles a ≤1h vía el job hourly `replicate-critical` (DR_RUNBOOK.md §3.5).');
  lines.push('- **RTO** (Recovery Time Objective): tiempo de `restore-firestore.cjs --dry-run` + rehidratación en staging. Medido a continuación.');
  lines.push('');
  lines.push('## Restore dry-run');
  lines.push('');
  lines.push('```');
  lines.push(input.restore.stdout || '(no stdout)');
  lines.push('```');
  if (input.restore.stderr) {
    lines.push('```');
    lines.push('stderr:');
    lines.push(input.restore.stderr);
    lines.push('```');
  }
  lines.push('');
  if (!input.restore.ok) {
    lines.push('## Action items');
    lines.push('');
    lines.push('El simulacro FALLÓ. Abrir issue P1 etiquetado `dr-rehearsal-failure` y notificar a `contacto@praeventio.net` antes del próximo simulacro mensual.');
  }
  return lines.join('\n') + '\n';
}

/**
 * The default execRestore spawns the real restore-firestore.cjs.
 */
async function defaultExecRestore({ exportPath, stagingProject }: {
  exportPath: string;
  stagingProject: string;
}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [RESTORE_SCRIPT, '--dry-run', ``],
      {
        env: {
          ...process.env,
          GCP_PROJECT_ID: stagingProject,
          GCS_RESTORE_PATH: exportPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

export async function runRehearsal(opts: RehearsalOpts): Promise<RehearsalResult> {
  const now = opts.now ?? (() => new Date());
  const exec = opts.execRestore ?? defaultExecRestore;
  const write = opts.writeFile ?? ((p, c) => mkdir(path.dirname(p), { recursive: true }).then(() => writeFile(p, c, 'utf8')));

  const start = now();
  const startIso = start.toISOString();
  const restore = await exec({ exportPath: opts.exportPath, stagingProject: opts.stagingProject });
  const finish = now();
  const finishIso = finish.toISOString();

  const report = buildRehearsalReport({
    isoMonth: opts.isoMonth,
    exportPath: opts.exportPath,
    stagingProject: opts.stagingProject,
    startedAt: startIso,
    finishedAt: finishIso,
    restore,
  });
  const reportPath = path.join(REHEARSAL_DIR, `${opts.isoMonth}.md`);
  try {
    await write(reportPath, report);
  } catch {
    return { ok: false, reportPath, report: report + '\n(reporte NO escrito — sandbox / permisos)\n' };
  }
  return { ok: restore.ok, reportPath, report };
}

// Direct invocation: run for the current month against the configured
// export path. CI / humans pass --iso-month + --export-path explicitly.
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  const isoMonthArg = args.find((a) => a.startsWith('--iso-month='));
  const exportPathArg = args.find((a) => a.startsWith('--export-path='));
  const stagingProjectArg = args.find((a) => a.startsWith('--staging-project='));
  const isoMonth = isoMonthArg
    ? isoMonthArg.split('=')[1]
    : new Date().toISOString().slice(0, 7);
  const exportPath = exportPathArg
    ? exportPathArg.split('=')[1]
    : (process.env.GCS_RESTORE_PATH || '');
  const stagingProject = stagingProjectArg
    ? stagingProjectArg.split('=')[1]
    : (process.env.GCP_STAGING_PROJECT || 'praeventio-staging');

  if (!exportPath) {
    console.error(
      '[run-dr-rehearsal] error: --export-path=<gs://...> required (or set GCS_RESTORE_PATH)',
    );
    process.exit(1);
  }
  runRehearsal({ isoMonth, exportPath, stagingProject }).then((r) => {
    if (!r.ok) {
      console.error(`[run-dr-rehearsal] FAIL: ${r.reportPath}`);
      process.exit(1);
    }
    console.log(`[run-dr-rehearsal] OK: ${r.reportPath}`);
  });
}
