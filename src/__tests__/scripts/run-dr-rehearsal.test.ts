// @vitest-environment node
// Praeventio Guard — DR rehearsal orchestrator (tarea P1).
//
// El runbook (DR_RUNBOOK.md §3.4) exige un simulacro mensual con:
//   1. restore --dry-run del último export a praeventio-staging
//   2. reporte fechado de RPO/RTO en docs/runbooks/restore-rehearsals/YYYY-MM.md
//   3. evidencia correlativa (pasos + timestampos + path del export)
//
// Antes: el script `test:dr-restore` referenciado NO existía en package.json,
// la carpeta `restore-rehearsals/` no existía, y el Scheduler en deploy.yml
// no creaba el job de critical-replica. Este test es la red de seguridad del
// nuevo orquestador (independiente de la red real de GCP).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '..', '..', '..', 'scripts', 'run-dr-rehearsal.ts');

const mod = await import(scriptPath);
const { runRehearsal, buildRehearsalReport } = mod as {
  runRehearsal: (opts: {
    isoMonth: string; // YYYY-MM
    exportPath: string;
    stagingProject: string;
    now: () => Date;
    execRestore: (args: { exportPath: string; stagingProject: string }) => Promise<{
      ok: boolean;
      stdout: string;
      stderr: string;
    }>;
    writeFile: (p: string, c: string) => Promise<void>;
  }) => Promise<{
    ok: boolean;
    reportPath: string;
    report: string;
  }>;
  buildRehearsalReport: (input: {
    isoMonth: string;
    exportPath: string;
    stagingProject: string;
    startedAt: string;
    finishedAt: string;
    restore: { ok: boolean; stdout: string; stderr: string };
  }) => string;
};

const FAKE_EXPORT = 'gs://praeventio-backups/firestore-export-2026-08-04/';

describe('run-dr-rehearsal.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T15:30:00Z'));
  });

  it('corre restore --dry-run y reporta el resultado', async () => {
    const result = await runRehearsal({
      isoMonth: '2026-08',
      exportPath: FAKE_EXPORT,
      stagingProject: 'praeventio-staging',
      now: () => new Date('2026-08-04T15:30:00Z'),
      execRestore: async () => ({
        ok: true,
        stdout: '--- dry-run summary ---\ncollection: audit_logs ok\ncollection: invoices ok',
        stderr: '',
      }),
      writeFile: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.reportPath).toMatch(/docs.*restore-rehearsals.*2026-08\.md$/);
    expect(result.report).toContain('2026-08');
    expect(result.report).toContain(FAKE_EXPORT);
    expect(result.report).toContain('praeventio-staging');
  });

  it('reporte fechado con timestamps exactos (evidencia)', async () => {
    const report = buildRehearsalReport({
      isoMonth: '2026-08',
      exportPath: FAKE_EXPORT,
      stagingProject: 'praeventio-staging',
      startedAt: '2026-08-04T15:30:00.000Z',
      finishedAt: '2026-08-04T15:30:01.234Z',
      restore: { ok: true, stdout: 'ok', stderr: '' },
    });
    expect(report).toContain('15:30:00');
    expect(report).toContain('15:30:01');
    expect(report).toContain('RPO');
    expect(report).toContain('RTO');
  });

  it('reporte marca fallo si restore --dry-run devolvió stderr/ok=false', async () => {
    const result = await runRehearsal({
      isoMonth: '2026-08',
      exportPath: FAKE_EXPORT,
      stagingProject: 'praeventio-staging',
      now: () => new Date('2026-08-04T15:30:00Z'),
      execRestore: async () => ({
        ok: false,
        stdout: '',
        stderr: 'export_metadata_missing',
      }),
      writeFile: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(/fail|FAIL|falló/);
    expect(result.report).toContain('export_metadata_missing');
  });

  it('NO escribe el reporte si writeFile lanza (sandbox)', async () => {
    // El orquestador debe distinguir "restore failed" de "no pude escribir
    // el reporte". Si writeFile rompe, devolvemos ok=false y NO afirmamos
    // que se generó evidencia.
    const result = await runRehearsal({
      isoMonth: '2026-08',
      exportPath: FAKE_EXPORT,
      stagingProject: 'praeventio-staging',
      now: () => new Date('2026-08-04T15:30:00Z'),
      execRestore: async () => ({ ok: true, stdout: 'ok', stderr: '' }),
      writeFile: async () => {
        throw new Error('EACCES: docs/runbooks/restore-rehearsals/');
      },
    });
    expect(result.ok).toBe(false);
  });
});
