// Contract test — Fase B.3 del plan integrado (verificación 2026-05-21).
//
// Origen: hallazgo H26 del plan + directiva legal 2026-05-17.
// El DS 40/1969 fue derogado por DS 44/2024 desde 2025-02-01. Cualquier
// referencia activa a "DS 40" sin anotación histórica explícita (derogado /
// reemplaza / histórico / antes de) es una promesa legal incorrecta que
// puede generar documentos con cita normativa equivocada.
//
// Complementa el guardrail runtime de
// src/services/aiGuardrails/hallucinationGuard.ts:89-91 (regex en el LLM).
// Este test es estático y se corre en CI antes del deploy.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync as fsReaddir, statSync as fsStat } from 'node:fs';
import { resolve, join as pathJoin, sep as pathSep } from 'node:path';

// Archivos críticos donde "DS 40" sólo puede aparecer con anotación.
// Excluye docs/archive/ (histórico, OK), tests (puede mockear) y código
// del propio guardrail que detecta el patrón.
const FILES_TO_AUDIT = [
  'src/services/legal/legalRuleEngine.ts',
  'src/services/legal/termsContent.ts',
  'src/services/documents/legalDocTemplates.ts',
  'src/services/coach/prompts.ts',
  'src/services/geminiBackend.ts',
  'src/services/compliance/registry.ts',
  'src/data/normativa/cl.ts',
  'src/pages/LandingPage.tsx',
  'src/pages/PrivacyPolicy.tsx',
  'README.md',
  'TODO.md',
  'marketplace/listing-copy.md',
  'marketplace/manifest.json',
  'marketplace/scope-justifications.md',
  'docs/SPRINT_K_REFORMULATED.md',
];

// Palabras que indican "anotación histórica" en español/inglés.
// 2026-05-21: agregadas variantes femeninas + sin acento para tolerar
// "anotación histórica" (feminine — "anotación" es feminine) además del
// masculino "DS 40 derogado/histórico". Antes el regex tropezaba con
// formas legítimas como "DS 40 sin anotación histórica" (en docs sobre
// el propio guardrail).
const ANNOTATION_KEYWORDS = [
  'derogado',
  'derogada',
  'histórico',
  'historico',
  'histórica',
  'historica',
  'historical',
  'reemplaza',
  'reemplazado',
  'reemplazada',
  'replaced',
  'antes de',
  'pre-2025',
  'previously',
];

// Distancia máxima en caracteres entre "DS 40" y la anotación.
// Suficiente para abarcar "DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)".
const MAX_ANNOTATION_DISTANCE = 80;

function hasAnnotationNearby(text: string, matchIdx: number): boolean {
  const before = Math.max(0, matchIdx - MAX_ANNOTATION_DISTANCE);
  const after = Math.min(text.length, matchIdx + MAX_ANNOTATION_DISTANCE);
  const window = text.slice(before, after).toLowerCase();
  return ANNOTATION_KEYWORDS.some((kw) => window.includes(kw));
}

describe('DS 40 derogado — H26 (LeyChile + directiva 2026-05-17)', () => {
  describe.each(FILES_TO_AUDIT)('archivo %s', (relPath) => {
    const abs = resolve(process.cwd(), relPath);
    let content: string | null = null;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      it.skip('(archivo no existe localmente)', () => {});
      return;
    }

    it('toda mención de "DS 40" tiene anotación histórica adjacente', () => {
      const text = content as string;
      const matches: Array<{ idx: number; ok: boolean }> = [];
      const re = /DS 40\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({ idx: m.index, ok: hasAnnotationNearby(text, m.index) });
      }
      const offenders = matches.filter((x) => !x.ok);
      if (offenders.length > 0) {
        // Imprime contexto útil al fallar.
        const previews = offenders.slice(0, 3).map((o) => {
          const from = Math.max(0, o.idx - 30);
          const to = Math.min(text.length, o.idx + 60);
          return `...${text.slice(from, to).replace(/\s+/g, ' ')}...`;
        });
        expect(
          offenders.length,
          `Encontradas ${offenders.length} menciones de "DS 40" sin anotación histórica en ${relPath}:\n${previews.join('\n')}`,
        ).toBe(0);
      }
      expect(offenders.length).toBe(0);
    });
  });

  it('hallucinationGuard.ts mantiene el regex DS 40 detector', () => {
    const g = readFileSync(
      resolve(process.cwd(), 'src/services/aiGuardrails/hallucinationGuard.ts'),
      'utf8',
    );
    // El detector menciona explícitamente DS 40 en su docstring/regex.
    expect(g).toMatch(/DS 40/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Extensión 2026-06-30: del allowlist (~15 archivos, sólo DS 40) al barrido
// COMPLETO de src/**, cubriendo además DS 54 (también derogado por DS 44/2024
// el 01-02-2025). El allowlist de arriba se conserva (assertions vigentes);
// este barrido es el verdadero gate anti-regresión: falla si CUALQUIER cita de
// un decreto derogado (DS 40 ó DS 54) aparece como vigente, sin un marcador de
// derogación en la misma línea o adyacente.
//
// Exclusiones (idénticas a ds44Migration.test.ts): los 2 archivos de contrato,
// los archivos de test (fixtures siembran 'DS 54'/'DS 40' a propósito), docs/
// (fuera de src), y los códigos enum estables 'DS-40'/'DS-54' (join-keys, no
// citas legales — su supersesión se documenta en cada registry).
// ───────────────────────────────────────────────────────────────────────────

const SRC_ROOT_FULL = resolve(__dirname, '..', '..');

// Sólo la forma EN PROSA ("DS 40"/"DS 54" con espacio, "decreto/Decreto
// Supremo 40/54"). Las formas con guion (DS-40/DS-54/cl-ds-54/norma-DS-40/
// source:'DS-54') son identificadores/enum estables en este repo, no citas
// legales — su supersesión se documenta en el encabezado de cada registry.
const PROSE_CITATION = /\bDS\s(?:40|54)\b|\bdecreto\s+(?:supremo\s+)?(?:40|54)\b/i;
const DEROGATION_MARKER = /(?:\bex\s|derogad|reemplaza|DS\s*44)/i;

function walkSrc(dir: string, acc: string[] = []): string[] {
  for (const entry of fsReaddir(dir)) {
    const full = pathJoin(dir, entry);
    if (fsStat(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walkSrc(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function excludedFromSweep(absPath: string): boolean {
  const p = absPath.split(pathSep).join('/');
  if (/\.(test|spec)\.(ts|tsx)$/.test(p)) return true;
  if (p.includes('/__tests__/contracts/ds40Annotation')) return true;
  if (p.includes('/__tests__/contracts/ds44Migration')) return true;
  return false;
}

describe('DS 40 / DS 54 derogados — barrido exhaustivo (H26 extendido)', () => {
  it('ningún decreto derogado se cita como vigente sin marcador adyacente', () => {
    const offenders: string[] = [];
    for (const file of walkSrc(SRC_ROOT_FULL)) {
      if (excludedFromSweep(file)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!PROSE_CITATION.test(line)) continue;
        const prev = lines[i - 1] ?? '';
        const next = lines[i + 1] ?? '';
        if (
          !DEROGATION_MARKER.test(line) &&
          !DEROGATION_MARKER.test(prev) &&
          !DEROGATION_MARKER.test(next)
        ) {
          offenders.push(
            `  ${file.split(pathSep).join('/').replace(/.*\/src\//, 'src/')}:${i + 1}  ${line.trim().slice(0, 120)}`,
          );
        }
      }
    }
    expect(
      offenders.length,
      offenders.length === 0
        ? ''
        : `Decreto derogado citado como vigente (sin ex/derogado/reemplaza/DS 44 cerca):\n${offenders.join('\n')}`,
    ).toBe(0);
  });
});
