/**
 * Sprint 26 Bucket XX.4 — tests para scripts/precommit-medical-guard.cjs
 *
 * Usa node:test stdlib (no vitest) porque el guard se invoca como CommonJS
 * en el hook pre-commit de husky. Correr: `node --test src/__tests__/scripts/medicalGuard.test.cjs`
 *
 * NOTA: Vitest NO descubre este archivo (.cjs fuera del glob src/**\/*.test.ts).
 * El job CI agregado en .github/workflows/ci.yml lo corre explícitamente.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require('../../../scripts/precommit-medical-guard.cjs');
const { checkFile, isInScope } = guard;

// Cada test escribe a un sandbox temporal y le pasa la ruta absoluta
// al guard, pero la verificación de "is view" usa pattern de path con prefijo
// src/. Para que VIEW_FILE_PATTERNS matchee, simulamos el layout dentro
// del sandbox y le damos un path RELATIVO con `src/...` al guard.
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medguard-'));
  return {
    dir,
    writeRel(relPath, content) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return abs;
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Helper: corre checkFile dentro del sandbox usando cwd para que la ruta
// relativa "src/..." apunte al archivo escrito.
function runIn(sandbox, relPath, content) {
  sandbox.writeRel(relPath, content);
  const prevCwd = process.cwd();
  process.chdir(sandbox.dir);
  try {
    return checkFile(relPath);
  } finally {
    process.chdir(prevCwd);
  }
}

test('1. checkFile en archivo fuera de scope → no violations', () => {
  const sb = makeSandbox();
  try {
    const violations = runIn(
      sb,
      'src/utils/foo.ts',
      'export function inferDiagnosis() { return "x"; }',
    );
    // Note: checkFile no filtra scope (eso lo hace main vía getStagedFiles+isInScope).
    // Pero la regla #3 (view) sí depende del path; aquí un .ts no es vista.
    // Las funciones prohibidas SE detectan aunque el archivo no sea de salud,
    // porque checkFile asume que el caller ya filtró scope. Por eso este test
    // valida el contrato del filtro isInScope, no checkFile.
    assert.strictEqual(isInScope('src/utils/foo.ts'), false);
    assert.strictEqual(isInScope('src/services/health/foo.ts'), true);
    // Y para confirmar que un archivo no-vista en scope no dispara MISSING_DISCLAIMER:
    const v2 = runIn(sb, 'src/services/health/clean.ts', 'export const x = 1;');
    assert.strictEqual(v2.length, 0);
    // El primer write tiene inferDiagnosis pero está fuera del filtro.
    void violations;
  } finally {
    sb.cleanup();
  }
});

test('2. inferDiagnosis() en src/services/health/ → FORBIDDEN_FUNCTION', () => {
  const sb = makeSandbox();
  try {
    const violations = runIn(
      sb,
      'src/services/health/risk.ts',
      `export function inferDiagnosis(exam: any) { return null; }`,
    );
    assert.ok(violations.length >= 1, 'expected at least one violation');
    const v = violations.find((x) => x.type === 'FORBIDDEN_FUNCTION');
    assert.ok(v, 'expected FORBIDDEN_FUNCTION');
    assert.match(v.match, /inferDiagnosis/);
  } finally {
    sb.cleanup();
  }
});

test('3. prompt "diagnose this exam" → FORBIDDEN_PROMPT', () => {
  const sb = makeSandbox();
  try {
    const violations = runIn(
      sb,
      'src/services/health/gemini.ts',
      `const prompt = "Please diagnose this exam result and tell user";`,
    );
    const v = violations.find((x) => x.type === 'FORBIDDEN_PROMPT');
    assert.ok(v, 'expected FORBIDDEN_PROMPT detection');
  } finally {
    sb.cleanup();
  }
});

test('4. src/pages/HealthVault.tsx sin MedicalDisclaimer → MISSING_DISCLAIMER', () => {
  const sb = makeSandbox();
  try {
    const violations = runIn(
      sb,
      'src/pages/HealthVault.tsx',
      `export default function HealthVault() { return <div>vault</div>; }`,
    );
    const v = violations.find((x) => x.type === 'MISSING_DISCLAIMER');
    assert.ok(v, 'expected MISSING_DISCLAIMER for view without disclaimer');
  } finally {
    sb.cleanup();
  }
});

test('5. src/pages/HealthVault.tsx CON import + render disclaimer → no violation', () => {
  const sb = makeSandbox();
  try {
    const content = `import { MedicalDisclaimer } from '@/components/medicine/MedicalDisclaimer';
export default function HealthVault() {
  return <div><MedicalDisclaimer /><span>vault</span></div>;
}`;
    const violations = runIn(sb, 'src/pages/HealthVault.tsx', content);
    assert.strictEqual(violations.length, 0, JSON.stringify(violations));
  } finally {
    sb.cleanup();
  }
});

test('6. multiple violations en mismo archivo → todas detectadas', () => {
  const sb = makeSandbox();
  try {
    const content = `import React from 'react';
export function inferDiagnosis() {}
export function assessClinicalRisk() {}
const prompt = "diagnose this please";
export default function HealthFoo() { return <div/>; }
`;
    const violations = runIn(sb, 'src/pages/HealthFoo.tsx', content);
    const types = new Set(violations.map((v) => v.type));
    assert.ok(types.has('FORBIDDEN_FUNCTION'), 'forbidden function');
    assert.ok(types.has('FORBIDDEN_PROMPT'), 'forbidden prompt');
    assert.ok(types.has('MISSING_DISCLAIMER'), 'missing disclaimer');
    // inferDiagnosis + assessClinicalRisk = 2 forbidden functions
    const fnViolations = violations.filter((v) => v.type === 'FORBIDDEN_FUNCTION');
    assert.strictEqual(fnViolations.length, 2);
  } finally {
    sb.cleanup();
  }
});

test('7. patterns de prompt son case-insensitive', () => {
  const sb = makeSandbox();
  try {
    const v1 = runIn(
      sb,
      'src/services/health/a.ts',
      `const prompt = "DIAGNOSE THIS NOW";`,
    );
    assert.ok(v1.find((v) => v.type === 'FORBIDDEN_PROMPT'), 'uppercase match');

    const v2 = runIn(
      sb,
      'src/services/health/b.ts',
      `const systemInstruction = "qué condición es?";`,
    );
    assert.ok(v2.find((v) => v.type === 'FORBIDDEN_PROMPT'), 'spanish lowercase match');
  } finally {
    sb.cleanup();
  }
});

test('8. comentarios siguen siendo escaneados (no se excluyen)', () => {
  const sb = makeSandbox();
  try {
    const content = `// TODO: implement inferDiagnosis later
export const x = 1;`;
    const violations = runIn(sb, 'src/services/health/todo.ts', content);
    // Sí, lo detecta — esto es intencional: nadie debería siquiera mencionar
    // la palabra en un TODO porque inevitablemente alguien lo destapará.
    assert.ok(
      violations.find((v) => v.type === 'FORBIDDEN_FUNCTION'),
      'comments should still be scanned',
    );
  } finally {
    sb.cleanup();
  }
});

test('9. isInScope normaliza separadores Windows', () => {
  // En Windows git devuelve forward slashes igual, pero validamos defensivamente.
  assert.strictEqual(isInScope('src/services/health/foo.ts'), true);
  assert.strictEqual(isInScope('src\\services\\health\\foo.ts'), true);
  assert.strictEqual(isInScope('src/utils/random.ts'), false);
});

test('10. B7 — src/components/hygiene/ está en scope', () => {
  assert.strictEqual(isInScope('src/components/hygiene/VitalityMonitor.tsx'), true);
  assert.strictEqual(isInScope('src/components/hygiene/SensoryFatigueMonitor.tsx'), true);
  assert.strictEqual(isInScope('src/components/other/Foo.tsx'), false);
});

test('11. VitalityMonitor sin MedicalDisclaimer → MISSING_DISCLAIMER', () => {
  const sb = makeSandbox();
  try {
    const violations = runIn(
      sb,
      'src/components/hygiene/VitalityMonitor.tsx',
      `export function VitalityMonitor() { return <div>vitals</div>; }`,
    );
    assert.ok(
      violations.find((v) => v.type === 'MISSING_DISCLAIMER'),
      'VitalityMonitor es vista médica → requiere <MedicalDisclaimer/>',
    );
  } finally {
    sb.cleanup();
  }
});

test('12. VitalityMonitor CON MedicalDisclaimer → sin violación', () => {
  const sb = makeSandbox();
  try {
    const content = `import { MedicalDisclaimer } from '../health/MedicalDisclaimer';
export function VitalityMonitor() {
  return <div><MedicalDisclaimer variant="compact" /><span>vitals</span></div>;
}`;
    const violations = runIn(sb, 'src/components/hygiene/VitalityMonitor.tsx', content);
    assert.strictEqual(violations.length, 0, JSON.stringify(violations));
  } finally {
    sb.cleanup();
  }
});
