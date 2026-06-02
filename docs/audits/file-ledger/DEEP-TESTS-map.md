# DEEP — Tests: mapa de cobertura (I-TEST) · 2026-06-02

Cobertura mecánica de los 1247 archivos de test (categoría I-TEST). Los tests reflejan su módulo-sujeto; esta es la capa factual del barrido para esa categoría (cada test contabilizado + dónde están los gaps).

## 1. Tests por tipo

| Tipo | Archivos |
|---|---:|
| co-located unit | 1029 |
| server (supertest) | 154 |
| __tests__ suite | 37 |
| e2e/playwright | 13 |
| smoke | 6 |
| firestore rules | 4 |
| firestore (emulator) | 4 |
| **TOTAL I-TEST** | **1247** |

## 2. Cobertura co-located de código fuente

Archivos de código (FEAT*/I-CORE, no-test) con test co-located (`*.test.ts(x)` hermano):

- **Con test co-located:** 974 / 1794 (54.3%)
- **Sin test co-located:** 820 (pueden estar cubiertos por suites `__tests__/` no co-located)

> Nota: muchos módulos se prueban vía suites en `src/__tests__/` (server supertest, contracts) que no son co-located; este conteo subestima la cobertura real. Es un indicador de gaps, no la cobertura definitiva (usar `vitest --coverage` para la métrica oficial).

### Sin test co-located, por bloque/categoría (top)

| Bloque/Categoría | Archivos sin test co-located |
|---|---:|
| FEAT-components | 97 |
| FEAT-services | 86 |
| FEAT-hooks | 75 |
| FEAT-pages | 72 |
| B5-Cumplimiento | 60 |
| B1-Emergencia | 55 |
| B7-Salud | 51 |
| B6-Capacitacion | 37 |
| B18-Analitica | 33 |
| B14-IA | 30 |
| B9-Inspecciones | 28 |
| B10-EPP | 24 |
| I-CORE | 23 |
| B17-Admin | 21 |
| FEAT-server | 20 |
| B4-Incidentes | 19 |
| B2-RiesgoIPER | 16 |
| B13-MOC | 15 |
| B15-Billing | 13 |
| B8-PermisosLOTO | 11 |
| B12-CPHS | 11 |
| B3-Ergonomia | 9 |
| B16-Offline | 6 |
| B11-Contratistas | 5 |
| FEAT-routes | 3 |

## 3. Inventario de skips/fixme (20)

```
tests/e2e/fall-detection-toggle.spec.ts:12:    test.skip(
tests/e2e/accessibility.spec.ts:82:    test.skip(
tests/e2e/accessibility.spec.ts:96:    test.skip(
tests/e2e/accessibility.spec.ts:118:    test.skip(
tests/e2e/accessibility.spec.ts:130:    test.skip(
tests/e2e/accessibility.spec.ts:165:  // Each will need a `test.skip(!process.env.E2E_FULL_STACK_AUTH)` until the
tests/e2e/sos-button.spec.ts:23:test.describe.fixme('SOSButton long-press', () => {
tests/e2e/sos-button.spec.ts:25:    test.skip(
tests/e2e/sos-button.spec.ts:76:    test.skip(
tests/e2e/landing-i18n.spec.ts:34:  test.skip(
tests/e2e/process-lifecycle.spec.ts:21:test.describe.fixme('Process lifecycle (start → close → XP)', () => {
tests/e2e/process-lifecycle.spec.ts:23:    test.skip(
tests/e2e/offline-resilience.spec.ts:21:test.describe.fixme('Offline-first sync', () => {
tests/e2e/offline-resilience.spec.ts:23:    test.skip(
tests/e2e/landing.spec.ts:24:  test.skip(
tests/e2e/sw-models-cache.spec.ts:32:    test.skip(
src/__tests__/contracts/contactEmailConsistency.test.ts:56:      it.skip(`(no existe localmente; skipped)`, () => {});
src/__tests__/contracts/ds40Annotation.test.ts:79:      it.skip('(archivo no existe localmente)', () => {});
src/server/routes/curriculum.ts:103:      // server — Cloud Run / PM2 / systemd will surface the exit(1) in
src/server/routes/curriculum.ts:108:      process.exit(1);
```

## 4. Para decisión del usuario

- Los gaps de §2 son candidatos a priorizar tests (especialmente bloques de vida/privacidad).
- Los skips de §3 deben reconciliarse (reactivar o documentar por qué).
- La cobertura oficial debe medirse con `vitest run --coverage`; este mapa es estructural.
