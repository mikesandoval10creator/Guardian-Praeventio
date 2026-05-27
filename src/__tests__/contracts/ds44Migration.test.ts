// Praeventio Guard — Contract test #5: DS 44/2024 migración consciente.
//
// DS 40/1969 fue derogado por DS 44/2024 (vigente 2025-02-01).
// Cualquier referencia a "DS 40" en código vivo debe estar
// contextualizada como histórica (mencionando "derogado" o "reemplaza")
// para no transmitir información regulatoria incorrecta.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const FILES_THAT_MUST_USE_DS44 = [
  'src/services/legal/legalRuleEngine.ts',
  'src/services/legal/termsContent.ts',
  'src/data/normativa/cl.ts',
  'src/services/coach/prompts.ts',
];

const HISTORICAL_MARKERS = [
  /derogado/i,
  /reemplaza\s*DS\s*40\/1969/i,
  /antes de 2025/i,
  /histórico/i,
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('DS 44/2024 migration contract', () => {
  for (const rel of FILES_THAT_MUST_USE_DS44) {
    it(`${rel} menciona DS 44 (vigente desde 2025-02-01)`, () => {
      if (!existsSync(resolve(REPO_ROOT, rel))) return;
      const content = read(rel);
      expect(content).toMatch(/DS\s*44/);
    });

    it(`${rel} si menciona DS 40, lo hace en contexto histórico`, () => {
      if (!existsSync(resolve(REPO_ROOT, rel))) return;
      const content = read(rel);
      const ds40Mentions = content.match(/DS\s*40/gi) ?? [];
      if (ds40Mentions.length === 0) return; // OK — solo cita DS 44
      // Si menciona DS 40, debe haber al menos un marker histórico cerca.
      const hasHistoricalContext = HISTORICAL_MARKERS.some((re) => re.test(content));
      expect(
        hasHistoricalContext,
        `${rel} cita DS 40 pero sin marca histórica ('derogado'/'reemplaza DS 40'/'histórico')`,
      ).toBe(true);
    });
  }
});
