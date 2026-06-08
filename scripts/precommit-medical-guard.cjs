#!/usr/bin/env node
/**
 * Sprint 26 Bucket XX — Pre-commit hook ADR 0012 enforcement
 *
 * Verifica que archivos staged en src/services/health/, src/components/health/,
 * src/components/medicine/, src/pages/Health*.tsx, src/pages/Medicine.tsx
 * NO contengan:
 *   - Function names diagnósticos prohibidos
 *   - Prompts Gemini diagnósticos
 *   - Vistas que rendericen sin <MedicalDisclaimer/>
 *
 * Si encuentra violación → exit 1 + mensaje claro al developer.
 *
 * Override de emergencia: `git commit --no-verify` con justificación
 * documentada en el commit body. No es la salida default.
 *
 * Ref: docs/architecture-decisions/0012-health-data-sovereignty-no-diagnosis.md
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Patterns prohibidos en código médico
const FORBIDDEN_FUNCTION_NAMES = [
  /\binferDiagnosis\b/,
  /\bassessClinicalRisk\b/,
  /\bsuggestTreatment\b/,
  /\bpredictPathology\b/,
  /\bdiagnoseFromExam\b/,
  /\bcategorizeAsProfessional\b/,
  /\bcalificarComoLaboral\b/,
  /\binferOccupationalDisease\b/,
];

const FORBIDDEN_PROMPT_PATTERNS = [
  /(?:prompt|systemInstruction|content)\s*[:=].*(?:diagnose|diagnosticar|diagnóstico)/i,
  /(?:prompt|systemInstruction|content)\s*[:=].*(?:what condition|qué condición|patología)/i,
  /(?:prompt|systemInstruction|content)\s*[:=].*(?:is this normal|es esto normal)/i,
];

// Vistas médicas DEBEN renderizar MedicalDisclaimer
const VIEW_FILE_PATTERNS = [
  /^src\/pages\/Health.*\.tsx$/,
  /^src\/pages\/MyData\.tsx$/,
  /^src\/pages\/Medicine\.tsx$/,
  /^src\/components\/health\/.*\.tsx$/,
  /^src\/components\/medicine\/HealthVault\.tsx$/,
  // B7 (2026-06) — VitalityMonitor procesa señales de salud (HR, vitales) y
  // emite recomendaciones; tras reconvertirlo a no-diagnóstico (ADR 0012) debe
  // mantener el <MedicalDisclaimer/> permanentemente.
  /^src\/components\/hygiene\/VitalityMonitor\.tsx$/,
];

const SCOPED_DIRS = [
  'src/services/health/',
  'src/services/medicine/',
  'src/components/health/',
  'src/components/medicine/',
  // B7 (2026-06) — el módulo de higiene procesa vitales/salud (VitalityMonitor,
  // SensoryFatigueMonitor) y antes coló inferencia CIE-10 sin que el guard lo
  // viera. Ahora se escanea para impedir regresiones diagnósticas.
  'src/components/hygiene/',
  // B7 (2026-06) — occupational-health alberga el visor corporal + el antiguo
  // MedicalAnalyzer (que inferían diagnóstico vía Gemini). Tras reconvertirlo a
  // SymptomDocumenter (documentación de síntomas, no diagnóstico) se escanea
  // para impedir que vuelva a colarse inferencia clínica.
  'src/components/occupational-health/',
  // B-medical-guard (2026-06) — los backends Gemini médicos viven en la RAÍZ de
  // src/services/ (no en las subcarpetas health/ o medicine/ ya escaneadas), así
  // que el prefijo de directorio NUNCA los matcheaba y quedaban fuera de ADR 0012.
  // Se agregan como rutas exactas (isInScope usa startsWith, así que la ruta
  // completa matchea). medicineBackend = vigilancia médica/epidemiología;
  // medicalAnalysisBackend = ilustración anatómica educativa (ex-diagnóstico,
  // reconvertido #674/#676/#677); psychosocialBackend = ISTAS-21. Todos son
  // superficies diagnóstico-shaped que el guard DEBE vigilar contra regresiones.
  'src/services/medicineBackend.ts',
  'src/services/medicalAnalysisBackend.ts',
  'src/services/psychosocialBackend.ts',
  'src/pages/HealthVault',
  'src/pages/MyData',
  'src/pages/Medicine',
];

function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only --diff-filter=ACM')
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isInScope(file) {
  // Normalize Windows backslashes so the check works regardless of platform.
  // path.sep is '/' on Linux, so split(path.sep) doesn't touch '\\' — replace
  // explicitly so paths emitted by Windows git tooling still match.
  const normalized = file.replace(/\\/g, '/');
  return SCOPED_DIRS.some((d) => normalized.startsWith(d));
}

function checkFile(file) {
  const violations = [];
  if (!fs.existsSync(file)) return violations;
  const content = fs.readFileSync(file, 'utf8');
  const normalizedFile = file.split(path.sep).join('/');

  // 1. Forbidden function names
  for (const pattern of FORBIDDEN_FUNCTION_NAMES) {
    const m = content.match(pattern);
    if (m) {
      violations.push({
        type: 'FORBIDDEN_FUNCTION',
        file,
        match: m[0],
        message: `Función prohibida ${m[0]} — la app NUNCA diagnostica (ADR 0012). Usa organize/visualize/cite.`,
      });
    }
  }

  // 2. Forbidden prompt patterns
  for (const pattern of FORBIDDEN_PROMPT_PATTERNS) {
    const m = content.match(pattern);
    if (m) {
      violations.push({
        type: 'FORBIDDEN_PROMPT',
        file,
        match: m[0].slice(0, 60),
        message: `Prompt diagnóstico detectado — la app NUNCA pide al modelo que diagnostique (ADR 0012).`,
      });
    }
  }

  // 3. View files MUST import + render MedicalDisclaimer
  const isView = VIEW_FILE_PATTERNS.some((p) => p.test(normalizedFile));
  if (isView) {
    const hasImport =
      /import\s+\{[^}]*MedicalDisclaimer[^}]*\}\s+from\s+['"][^'"]*MedicalDisclaimer['"]/.test(
        content,
      );
    const hasRender = /<MedicalDisclaimer\b/.test(content);
    if (!hasImport || !hasRender) {
      violations.push({
        type: 'MISSING_DISCLAIMER',
        file,
        message: `Vista médica DEBE renderizar <MedicalDisclaimer/> (ADR 0012).`,
      });
    }
  }

  return violations;
}

function main() {
  const staged = getStagedFiles().filter(isInScope);
  if (staged.length === 0) {
    process.exit(0);
  }

  const allViolations = [];
  for (const file of staged) {
    allViolations.push(...checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log('✓ ADR 0012 enforcement: clean (' + staged.length + ' health files staged)');
    process.exit(0);
  }

  console.error('\n❌ ADR 0012 VIOLATION — Praeventio nunca diagnostica\n');
  for (const v of allViolations) {
    console.error(`  ${v.file}`);
    console.error(`  → ${v.type}: ${v.message}`);
    if (v.match) console.error(`     match: "${v.match}"`);
    console.error('');
  }
  console.error('Ver: docs/architecture-decisions/0012-health-data-sovereignty-no-diagnosis.md');
  console.error(
    'Override de emergencia: `git commit --no-verify` con justificación en el commit body.',
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  checkFile,
  isInScope,
  FORBIDDEN_FUNCTION_NAMES,
  FORBIDDEN_PROMPT_PATTERNS,
  VIEW_FILE_PATTERNS,
  SCOPED_DIRS,
};
