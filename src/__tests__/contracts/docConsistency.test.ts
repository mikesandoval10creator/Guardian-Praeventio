// Contract test — Fase B.3 del plan integrado (verificación 2026-05-21).
//
// Verifica higiene documental:
//   - Raíz no se vuelve a llenar de docs históricos (cap < 30 .md).
//   - docs/archive/ existe con el README explicativo.
//   - TODO.md sigue siendo la fuente única de verdad (existe + tamaño
//     razonable, no se borra accidentalmente).

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

describe('higiene documental — Fase B', () => {
  it('raíz tiene < 30 archivos .md (cap anti-bloat)', () => {
    const entries = readdirSync(repoRoot);
    const mdFiles = entries.filter((f) => {
      if (!f.endsWith('.md')) return false;
      const stat = statSync(resolve(repoRoot, f));
      return stat.isFile();
    });
    // Soft cap: hoy quedan ~24 docs. Cuando se cruza 30 hay que
    // reevaluar archivado (Fase B reset).
    expect(mdFiles.length).toBeLessThan(30);
  });

  it('docs/archive/ existe con README + snapshot 2026-05/', () => {
    expect(existsSync(resolve(repoRoot, 'docs/archive'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'docs/archive/README.md'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'docs/archive/2026-05'))).toBe(true);
  });

  it('docs/archive/README.md menciona TODO.md como fuente única', () => {
    const r = readFileSync(resolve(repoRoot, 'docs/archive/README.md'), 'utf8');
    expect(r).toMatch(/TODO\.md/);
    expect(r.toLowerCase()).toMatch(/fuente.*verdad|source of truth/);
  });

  it('TODO.md existe en raíz y no está vacío', () => {
    const t = readFileSync(resolve(repoRoot, 'TODO.md'), 'utf8');
    expect(t.length).toBeGreaterThan(1000);
    expect(t).toMatch(/Fuente Única de Verdad/);
  });

  it('README.md linka a TODO.md como estado vivo', () => {
    const r = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    expect(r).toMatch(/TODO\.md/);
  });
});
