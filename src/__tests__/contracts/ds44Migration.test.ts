// Praeventio Guard — Contract test #5: DS 44/2024 migración consciente.
//
// DS 40/1969 fue derogado por DS 44/2024 (vigente 2025-02-01).
// DS 54/1969 (Comités Paritarios) también fue derogado por DS 44/2024 en la
// misma fecha. Cualquier referencia a "DS 40" / "DS 54" en código vivo debe
// estar contextualizada como histórica (marcador de derogación cercano) para
// no transmitir información regulatoria incorrecta a un trabajador.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

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

// ───────────────────────────────────────────────────────────────────────────
// Barrido exhaustivo de TODO src/** (no sólo el allowlist).
//
// Regla: cada referencia a un decreto DEROGADO (DS 40 / DS 54, en cualquiera
// de las formas de cita en prosa) debe llevar un marcador de derogación en la
// MISMA línea o en una ADYACENTE (±1). Sin marcador = se está presentando un
// decreto derogado como vigente → falla el gate.
//
// EXCLUSIONES (por diseño):
//   - Los dos archivos de contrato (este + ds40Annotation): contienen los
//     propios regex/strings 'DS 40'/'DS 54' como datos del test.
//   - Archivos de test (*.test.* / *.spec.*): los fixtures pueden sembrar
//     'DS 54'/'DS 40' crudos a propósito para EJERCITAR la lógica de
//     anotación/guardrail (p.ej. backgroundTriggers siembra un doc 'DS 54'
//     para probar el detector). Anotarlos rompería el escenario bajo prueba.
//   - docs/ está fuera de `src/` y por tanto fuera de este barrido.
//   - Códigos/identificadores ENUM estables: 'DS-54'/'DS-40' usados como
//     valor de `source:`/`code:` o dentro de un `id:` ('norma-DS-54', …). Son
//     join-keys internas, NO una afirmación legal mostrada al trabajador. Su
//     supersesión está documentada en el encabezado de cada registry.
// ───────────────────────────────────────────────────────────────────────────

// Forma de cita EN PROSA de un decreto derogado (la peligrosa: texto leído por
// un humano / inyectado a un LLM):
//   - "DS 40" / "DS 54" con espacio (no "DS-54" con guion, que es enum/code)
//   - "decreto 40" / "Decreto Supremo 54"
const PROSE_CITATION_RE =
  /\bDS\s(?:40|54)\b|\bdecreto\s+(?:supremo\s+)?(?:40|54)\b/i;

// Marcadores de derogación aceptados.
const DEROGATION_MARKER_RE = /(?:\bex\s|derogad|reemplaza|DS\s*44)/i;

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // node_modules / dist never live under src, but be defensive.
      if (entry === 'node_modules' || entry === 'dist') continue;
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function isExcluded(absPath: string): boolean {
  const p = absPath.split(sep).join('/');
  if (/\.(test|spec)\.(ts|tsx)$/.test(p)) return true;
  if (p.includes('/__tests__/contracts/ds40Annotation')) return true;
  if (p.includes('/__tests__/contracts/ds44Migration')) return true;
  return false;
}

interface Offender {
  file: string;
  line: number;
  text: string;
}

function scanForUnannotatedDerogatedCitations(): Offender[] {
  const offenders: Offender[] = [];
  const files = listSourceFiles(SRC_ROOT);
  for (const file of files) {
    if (isExcluded(file)) continue;
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Sólo nos importa la cita EN PROSA (la que lee un humano): "DS 40" /
      // "DS 54" con espacio, "decreto 40/54", "Decreto Supremo 54". Las formas
      // con guion (DS-40 / DS-54 / cl-ds-54 / norma-DS-40 / source:'DS-54') son
      // SIEMPRE identificadores/enum/code estables en este repo — join-keys, no
      // afirmaciones legales visibles al trabajador — y su supersesión se
      // documenta en el encabezado de cada registry. Por eso el gate sólo
      // exige marcador para la forma en prosa.
      if (!PROSE_CITATION_RE.test(line)) continue;
      // Marcador en la misma o en una línea adyacente (±1).
      const prev = lines[i - 1] ?? '';
      const next = lines[i + 1] ?? '';
      const annotated =
        DEROGATION_MARKER_RE.test(line) ||
        DEROGATION_MARKER_RE.test(prev) ||
        DEROGATION_MARKER_RE.test(next);
      if (!annotated) {
        offenders.push({
          file: file.split(sep).join('/').replace(/.*\/src\//, 'src/'),
          line: i + 1,
          text: line.trim().slice(0, 120),
        });
      }
    }
  }
  return offenders;
}

describe('DS 40 / DS 54 derogados — barrido exhaustivo src/**', () => {
  it('ninguna cita de un decreto derogado aparece como vigente (sin marcador adyacente)', () => {
    const offenders = scanForUnannotatedDerogatedCitations();
    const report = offenders
      .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
      .join('\n');
    expect(
      offenders.length,
      offenders.length === 0
        ? ''
        : `Citas de decreto derogado SIN marcador de derogación (ex/derogado/reemplaza/DS 44) ` +
          `en la misma línea ni adyacente:\n${report}\n\n` +
          `Toda mención de DS 40/DS 54 en código vivo debe citar el DS 44/2024 ` +
          `(ex DS 40 / ex DS 54, derogados 01-02-2025).`,
    ).toBe(0);
  });

  it('el barrido efectivamente inspecciona archivos (sanity)', () => {
    // Si el walker se rompe (0 archivos), el test de arriba pasaría vacío.
    const files = listSourceFiles(SRC_ROOT).filter((f) => !isExcluded(f));
    expect(files.length).toBeGreaterThan(100);
  });
});
