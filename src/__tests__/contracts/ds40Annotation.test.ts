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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const ANNOTATION_KEYWORDS = [
  'derogado',
  'derogada',
  'histórico',
  'historico',
  'historical',
  'reemplaza',
  'reemplazado',
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
