// Contract test — §2.14 P0 SECURITY (cierre Fase C.1, 2026-05-21).
//
// SusesoApiClient lee process.env.SUSESO_API_KEY que en Vite browser
// bundle siempre será undefined (false completeness silenciosa). Si
// alguien renombrara con prefijo VITE_*, los secretos quedarían en el
// bundle accesibles via DevTools → P0 SECURITY leak.
//
// Adicional: directiva 2.6 inviolable — Praeventio NO envía DIAT/DIEP a
// SUSESO directamente.
//
// Este test recorre src/pages, src/components, src/hooks y falla si
// alguien re-importa SusesoApiClient (o sus tipos de payload) desde
// código browser.

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const FORBIDDEN_IDENTIFIERS = [
  'SusesoApiClient',
  'SusesoApiError',
  'DiatPayload',
  'DiepPayload',
  'RoiPayload',
];

const BROWSER_ROOTS = ['src/pages', 'src/components', 'src/hooks'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      yield* walk(abs);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      // Skip test files — pueden mockear sin riesgo.
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
      if (entry.endsWith('.spec.ts') || entry.endsWith('.spec.tsx')) continue;
      yield abs;
    }
  }
}

describe('no browser-side SusesoApiClient imports — §2.14 cierre Fase C.1', () => {
  it.each(BROWSER_ROOTS)('ningún archivo en %s importa el cliente SUSESO', (root) => {
    const abs = resolve(process.cwd(), root);
    const offenders: Array<{ file: string; lines: string[] }> = [];

    for (const file of walk(abs)) {
      const content = readFileSync(file, 'utf8');
      // Buscamos línea por línea para distinguir imports reales de
      // comentarios.
      const lines = content.split('\n');
      const hits: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        // Saltar líneas de comentario.
        const trimmed = line.trimStart();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          continue;
        }
        // Detectar import desde el módulo prohibido o uso del identificador
        // a nivel de import statement.
        if (line.includes('susesoApiClient')) {
          // Si la línea es un `import ... from '...susesoApiClient'`, fail.
          if (/from\s+['"][^'"]*susesoApiClient(\.js)?['"]/.test(line)) {
            hits.push(`${i + 1}: ${line.trim()}`);
            continue;
          }
        }
        for (const id of FORBIDDEN_IDENTIFIERS) {
          // Verifica uso del identificador en una línea de import.
          if (line.includes(id) && /^\s*(import|export)\s/.test(line)) {
            hits.push(`${i + 1} [${id}]: ${line.trim()}`);
            break;
          }
        }
      }
      if (hits.length > 0) {
        offenders.push({ file: file.replace(abs, root), lines: hits });
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:\n    ${o.lines.join('\n    ')}`)
        .join('\n');
      expect(
        offenders.length,
        `Archivos browser-side importando SusesoApiClient (prohibido por §2.14):\n${detail}`,
      ).toBe(0);
    }
    expect(offenders.length).toBe(0);
  });
});
