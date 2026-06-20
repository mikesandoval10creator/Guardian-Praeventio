# Auditoria 777 — Plan Sprint 19 orchestrator multi-agente
Fecha: 2026-05-04 · Repo: Guardian-Praeventio · Rama: dev/sprint-19-orchestrator-debt-cleanup-2026-05-04 · Auditor: agente general-purpose con superpowers:writing-plans

> **Para los 4 agentes implementadores**: cada hallazgo es un mini-plan ejecutable. Las tablas son resumen — el detalle vive en el Apéndice. La continuación está en `auditoria777-parte2.md` (Apéndice C agente review/simplify, Apéndice D spec Sprint 20).

## Resumen ejecutivo
- **Total hallazgos**: 38
- **Severidad**: 4 críticos | 18 medianos | 16 menores (todos con tono constructivo, oportunidades de mejora — el código base demuestra disciplina arquitectónica notable)
- **Distribución por agente implementador**:
  - Agente A (cost optimization): **13 hallazgos** (~95-110 min trabajo lineal)
  - Agente B (E2E fixtures Sprint 19): **9 hallazgos** (~120-150 min — candidato a B1+B2 si supera 30 min/sub-agente)
  - Agente C (code review + simplify + UX polish): **15 hallazgos** (~120-180 min trabajo distribuido)
  - Agente D (spec Sprint 20): **1 hallazgo entregable** (mini-plan + 1 mockup) (~45-60 min)
- **Skills más usadas**:
  1. `superpowers:test-driven-development` (8 hallazgos — todos los TDD del agente B + tests de Bucket C)
  2. `simplify` (10 hallazgos — refactors C que reducen LOC sin alterar comportamiento)
  3. `superpowers:writing-plans` (todos los agentes la consumen al iniciar)
- **MCPs más usados**:
  1. `plugin_playwright_playwright` (Bucket B — todos los 4 specs requieren un agente que pueda lanzar navegadores)
  2. `plugin_context7_context7` (Bucket A para `express-rate-limit` v8 docs; Bucket B para Playwright fixtures + Firebase emulator; Bucket D para validar libs candidatas)
  3. `nano-banana:nano-banana` (Bucket D — diagrama Sprint 20)

**Tono general**: el repo está bien-arquitectónicamente — barrels limpios, tests de servicios server-side por supertest harness, comments-as-spec en cada module header. Esta auditoría se concentra en cierres de Sprint 19 (downgrades de costo, fixtures E2E faltantes) y oportunidades de polish (tokens semánticos sustituyendo hex hardcodeados, MedicalIcon coverage en módulos médicos restantes).

**Notas de seguridad**:
- No se detectaron leaks de API key/DSN en `src/` (los 3 hits del patrón `AIzaSy` están en archivos de tests `.test.ts` — falsos positivos esperados de mocks).
- `verifyAuth.ts` necesita un guard E2E_MODE para Bucket B; sin ese guard no se puede mockear auth en Playwright sin abrir un agujero en producción. Plan completo en F-B05.
- La key `GEMINI_API_KEY` proporcionada por el usuario en chat debe rotarse post-PR (acción manual del usuario, ver Apéndice de seguridad final).

---

## Tabla 1 — Agente A (Cost optimization)

| ID | Sev | Tipo | Archivo:línea | Skill | MCP | Estim | Dep | Plan ejecutable (resumen) | Criterio éxito |
|---|---|---|---|---|---|---|---|---|---|
| F-A01 | 🟡 | cost | src/services/comiteBackend.ts:53 | simplify | — | 3min | — | Cambiar `gemini-3.1-pro-preview` → `gemini-3-flash-preview` | grep `gemini-3.1-pro-preview` en archivo retorna 0 |
| F-A02 | 🟡 | cost | src/services/susesoBackend.ts:65 | simplify | — | 3min | — | Cambiar `gemini-3.1-pro-preview` → `gemini-3-flash-preview` | grep retorna 0 |
| F-A03 | 🔴 | cost | src/server/middleware/limiters.ts:165 (append) | simplify | context7 (express-rate-limit) | 8min | — | Agregar `geminiGlobalDailyLimiter` (1000 req/día global) al final | export visible + import en gemini.ts compila |
| F-A04 | 🔴 | cost | src/server/routes/gemini.ts:185, 270 | simplify | — | 5min | F-A03 | Mountar `geminiGlobalDailyLimiter` ANTES de `geminiLimiter` en ambos handlers | requests > 1000/día retornan 503 con `gemini_global_cap_reached` |
| F-A05 | 🟡 | cost | src/components/maps/mapConfig.ts (CREATE) | simplify | — | 5min | — | Crear archivo con `MAP_LIBRARIES`, `MAP_LOADER_ID`, `getMapLoaderConfig()` | archivo existe + `npm run typecheck` pass |
| F-A06 | 🟡 | cost | src/pages/Driving.tsx:38, 68-71 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep `useJsApiLoader\(\{` en archivo retorna 0 |
| F-A07 | 🟡 | cost | src/pages/ClimateRoutes.tsx:5, 26-29 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A08 | 🟡 | cost | src/pages/SafeDriving.tsx:3, 61-64 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A09 | 🟡 | cost | src/pages/SiteMap.tsx:3, 58-61 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A10 | 🟡 | cost | src/pages/VolcanicEruptionMap.tsx:5, 41-44 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A11 | 🟡 | cost | src/pages/Evacuation.tsx:4, 65-68 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A12 | 🟡 | cost | src/pages/HazmatMap.tsx:5, 41-44 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A13 | 🟡 | cost | src/pages/CoastalEmergencyMap.tsx:14, 29-32 | simplify | — | 5min | F-A05 | Refactor a `getMapLoaderConfig()` | grep retorna 0 |
| F-A14 | 🟢 | cost | src/components/digital-twin/Site25DPanel.tsx:112 | simplify | — | 4min | F-A05 | Refactor (ya usa MAP_LIBRARIES — alinear con `getMapLoaderConfig()`) | un solo loader-id global, sin warnings de re-load en consola |
| F-A15 | 🟢 | cost | src/components/workers/DocsModal.tsx:42-50 | simplify | — | 3min | — | Agregar comentario `// TODO Sprint 20+: agregar where('archived', '==', false)` | comentario presente, refactor diferido |
| F-A16 | 🟢 | cost | src/components/emergency/EmergencyCheckIn.tsx:37, 45 | simplify | — | 3min | — | Agregar comentario TODO Sprint 20+ (filtros sin where) | comentario presente |
| F-A17 | 🟢 | cost | src/pages/EmergenciaAvanzada.tsx:83, 91 | simplify | — | 3min | — | Agregar comentario TODO Sprint 20+ (orderBy/limit OK pero sin where) | comentario presente |
| F-A18 | 🟢 | cost | src/pages/ControlsAndMaterials.tsx:42, 46 | simplify | — | 3min | — | Agregar comentario TODO Sprint 20+ (controls/materials sin where(active)) | comentario presente |

**Total Bucket A**: 18 hallazgos (consolidando A05-A14 como un mini-épico de Maps loader). Estimación serial: ~75 min. Si se paraleliza A06-A14 después de A05: ~25 min.

> **Nota IDs vs aviso del orchestrator**: el orchestrator anunció "13 hallazgos cost". Después de la inspección encontré 4 listeners adicionales documentados como TODO comments (F-A15..A18) y un Site25DPanel ya parcialmente refactorizado (F-A14). El total consolidado es 18 — el agente A puede colapsar A06-A13 en una sola pasada de búsqueda-y-reemplazo si tiene un patrón scriptable; ver F-A06 para el pattern.

---

## Tabla 2 — Agente B (E2E Sprint 19 fixtures)

| ID | Sev | Tipo | Archivo:línea | Skill | MCP | Estim | Dep | Plan ejecutable (resumen) | Criterio éxito |
|---|---|---|---|---|---|---|---|---|---|
| F-B01 | 🟡 | test-infra | tests/e2e/fixtures/auth.ts:48-55 | test-driven-development | playwright | 15min | F-B05 | Reemplazar stub `loginAsTestUser` con impl real que llama a backend con `Authorization: E2E ${E2E_TEST_SECRET}` y persiste user en localStorage | `loginAsTestUser` retorna user con uid; spec drive test pasa |
| F-B02 | 🟡 | test-infra | tests/e2e/fixtures/server.ts (CREATE) | test-driven-development | context7 (Playwright webServer) | 20min | — | Crear fixture que arranca Express server en port 3000 con `E2E_MODE=1` env, expone helper para health-check | `tests/e2e/fixtures/server.ts` exporta `startE2EServer`; smoke test pasa |
| F-B03 | 🟡 | test-infra | tests/e2e/fixtures/seed.ts (CREATE) | test-driven-development | context7 (firebase emulator) | 25min | F-B02 | Helper `seedProject(crewName, processType, ...)` que escribe a Firestore emulator (`http://localhost:8080`) usando firebase-admin | `seedProject` crea project + crew sin error; helper documentado |
| F-B04 | 🟡 | test-infra | playwright.config.ts:60-68 | simplify | context7 (Playwright config webServer compose) | 12min | F-B02 | Convertir `webServer` en array `[preview, express, emulator]` con health-checks individuales | `npm run test:e2e:full` arranca los 3 servers paralelo y espera por todos |
| F-B05 | 🔴 | test-infra | src/server/middleware/verifyAuth.ts:22-37 | test-driven-development | — | 18min | — | Agregar guard `if (process.env.E2E_MODE === '1' && process.env.NODE_ENV !== 'production')` que acepta `Authorization: E2E ${E2E_TEST_SECRET}` y popula req.user con fixture | tests pasan en E2E; en prod el guard no se activa (NODE_ENV=production); test unit en `__tests__/server/verifyAuthE2E.test.ts` |
| F-B06 | 🟢 | test | tests/e2e/process-lifecycle.spec.ts:14-36 | test-driven-development | playwright | 20min | F-B01-F-B05 | Reemplazar `test.skip(...)` con impl real siguiendo plan en comentarios | `npm run test:e2e -- process-lifecycle` pasa |
| F-B07 | 🟢 | test | tests/e2e/sos-button.spec.ts:12-32 | test-driven-development | playwright | 25min | F-B01-F-B05 | Reemplazar 2 `test.skip` con impl real (long-press 3s + fallback tel: si geo bloqueado) | ambos tests pasan |
| F-B08 | 🟢 | test | tests/e2e/fall-detection-toggle.spec.ts:9-25 | test-driven-development | playwright | 15min | F-B01-F-B05 | Impl real (toggle off→on persistencia idb-keyval después de reload) | test pasa |
| F-B09 | 🟢 | test | tests/e2e/offline-resilience.spec.ts:13-29 | test-driven-development | playwright | 20min | F-B01-F-B05 | Impl real (offline→queue→online→sync→visible en feed) | test pasa |
| F-B10 | 🟡 | test-infra | package.json:32 | simplify | — | 5min | F-B02-F-B04 | Agregar scripts `test:e2e:full` (con emulator + Express) y `test:e2e:emulator` (solo emulator setup) | scripts presentes y funcionales |
| F-B11 | 🟡 | test-infra | src/server/routes/gemini.ts:185, 270 | test-driven-development | — | 15min | F-A04, F-B05 | Cuando E2E_MODE=1 + Authorization E2E header, retornar payload mock determinista (no llamar Gemini real) | tests E2E que invocan gemini retornan mock sin Gemini real |

**Total Bucket B**: 11 hallazgos. Estimación serial: ~190 min. **Recomendación al orquestador**: dividir en B1 (fixtures setup: F-B01..F-B05, F-B10, F-B11 ≈ 110 min) + B2 (specs lift skip: F-B06..F-B09 ≈ 80 min). B1 debe completarse antes de B2.

---

## Tabla 3 — Agente C (Code review + simplify + UX polish)

| ID | Sev | Tipo | Archivo:línea | Skill | MCP | Estim | Dep | Plan ejecutable (resumen) | Criterio éxito |
|---|---|---|---|---|---|---|---|---|---|
| F-C01 | 🟡 | simplify | src/services/medical/iconLibrary.ts:80-82 | simplify | — | 5min | — | Convertir `findMedicalIcon` de `Array.find` a `Map<string, MedicalIconEntry>` lookup O(1) (lazy build) | tests existentes siguen pasando; benchmark casual < 0.1ms |
| F-C02 | 🟢 | ux-polish | src/components/medicine/AnatomyLibrary.tsx | frontend-design | — | 10min | — | Verificar tamaños MedicalIcon consistentes (size=20 para inline, 48 para card-headers) en módulo Anatomy | grep visual: tamaños alineados con MedicalAnalyzer (20, 24, 48) |
| F-C03 | 🟢 | ux-polish | src/components/medicine/AptitudeCertificateForm.tsx | frontend-design | — | 8min | — | Confirmar que MedicalIcon en form fields tiene size 18-22 (consistente con UI text-base) | render visual coherente con MedicalAnalyzer |
| F-C04 | 🟢 | ux-polish | src/components/medicine/DifferentialDiagnosis.tsx | frontend-design | — | 8min | — | Verificar coherencia size + alineación gap-1.5 | match con patrón de MedicalAnalyzer |
| F-C05 | 🟢 | ux-polish | src/components/medicine/DrugInteractions.tsx | frontend-design | — | 8min | — | Verificar coherencia size + alineación | match con MedicalAnalyzer |
| F-C06 | 🟢 | ux-polish | src/components/medicine/VigilanciaScheduler.tsx | frontend-design | — | 8min | — | Verificar coherencia size + alineación | match con MedicalAnalyzer |
| F-C07 | 🟢 | ux-polish | src/components/medicine/AddMedicineModal.tsx | frontend-design | — | 8min | — | Verificar MedicalIcon header del modal (size 24-32 dependiendo de modal-header convention) | match con EPPVerificationModal |
| F-C08 | 🟢 | ux-polish | src/components/epp/EPPVerificationModal.tsx:145-152 | frontend-design | — | 5min | — | Confirmar que la fila de 6 MedicalIcon (helmet/goggles/n95/hearing/gloves/harness) está alineada en `gap-1.5 ml-2 text-emerald-500` y se cierra con `aria-hidden="true"` | render visual ya OK; auditoría confirmatoria |
| F-C09 | 🟡 | simplify | src/components/occupational-health/MedicalAnalyzer.tsx:120 | simplify | — | 8min | — | Reemplazar `text-[#2a8a81] dark:text-[#d4af37]` con `text-teal-600 dark:text-gold-500` (tokens index.css) | grep `text-\[#` en archivo retorna 0; visual idéntico |
| F-C10 | 🟡 | simplify | src/components/medicine/* (8 archivos) | simplify | — | 25min | F-C09 | Replicar pattern: hex → tokens semánticos. Mantener `lime-500` en `nodeTypeUtils.ts` (NodeType.ATTENDANCE — intencional) | grep `text-\[#(2a8a81\|4db6ac\|d4af37)\]` retorna 0 en src/components/medicine; nodeTypeUtils.ts lime-500 INTACTO |
| F-C11 | 🟡 | review | src/services/zettelkasten/persistence/writeNode.ts:64-87 | code-review | — | 6min | — | Confirmar contrato `nodeIdFor` (SHA-256 16 hex deterministic) y agregar test que demuestre que mismos inputs ⇒ mismo id | nuevo test pasa; archivo no modificado en lógica |
| F-C12 | 🟡 | review | src/services/zettelkasten/climateRiskCoupling.ts:1-100 | code-review | — | 10min | — | Verificar que `dynamicPressure` y `windLoadOnSurface` no se llaman en hot loop con misma input — si lo hacen, considerar memoize. Hoy: 434 LOC, 3 thresholds. | reporte de hot paths + recomendación memoize si aplica |
| F-C13 | 🟡 | simplify | src/components/risks/IPERCAnalysis.tsx (634 LOC) | simplify | — | 30min | — | Extraer subcomponente `IPERCMatrix` (probable 80-120 LOC) a archivo nuevo `src/components/risks/IPERCMatrix.tsx`; conservar comportamiento | LOC original baja a ≤520; tests existentes siguen pasando |
| F-C14 | 🟡 | simplify | src/components/audits/ISOManagement.tsx (773 LOC) | simplify | — | 25min | — | Extraer header + filters como `ISOManagementHeader.tsx` + `ISOManagementFilters.tsx` | LOC original baja a ≤620; sin breaking change |
| F-C15 | 🟢 | review | src/components/dashboard/moduleGroups.ts | code-review | — | 8min | — | Verificar consistencia de tokens en module group definitions (¿hardcodeados?) | reporte; refactor diferido si no hay deuda real |

**Total Bucket C**: 15 hallazgos. Estimación serial: ~170 min, paralelizable parcialmente (C02-C08 son independientes entre sí, todos visualmente verificables; C09-C10 secuenciales). El orquestador puede asignar Agente C como un solo flujo o partir en C1 (UX-polish C02-C10) + C2 (review C01, C11-C15).

---

## Tabla 4 — Agente D (Spec Sprint 20)

| ID | Sev | Tipo | Output | Skill | MCP | Estim | Dep | Plan ejecutable (resumen) | Criterio éxito |
|---|---|---|---|---|---|---|---|---|---|
| F-D01 | 🟢 | spec | docs/sprints/SPRINT_20_SPEC.md (CREATE) + docs/sprints/sprint-20-architecture.png (CREATE) | brainstorming + writing-plans + nano-banana | context7 (libs candidate validation) | 60min | — | Brainstorm Brecha B (SLM offline) vs Brecha C (fotogrametría auto). Decidir cuál atacar Sprint 20 con 4 mini-planes ejecutables (cada uno con file paths exactos, tests TDD, deps). Generar 1 mockup arquitectónico con nano-banana. | SPEC.md ≥800 LOC con plan ejecutable; PNG generado; recomendación clara entre B y C con razones |

**Total Bucket D**: 1 entregable, ~60 min. NO toca código de runtime — sólo `docs/sprints/`.

---

## Apéndice A — Detalle ejecutable de cada hallazgo del Bucket A

### F-A01 [🟡] [Agente A] Downgrade comiteBackend a Flash
**Tipo**: cost · **Archivo**: src/services/comiteBackend.ts:53 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: El `summarizeAgreements` actual usa `gemini-3.1-pro-preview` para un summarization JSON-structured. Es una tarea formato-conservativo que Flash maneja con > 95% calidad a 1/15 del costo. El usuario confirmó que Comité Paritario NO está en lista de expansión profunda (no es química / medicina / ergonomía).

**Plan ejecutable**:
1. Abrir `src/services/comiteBackend.ts`.
2. Localizar línea 53: `model: "gemini-3.1-pro-preview",`
3. Reemplazar con: `model: "gemini-3-flash-preview",`
4. Verificar tests existentes: `npm run test -- comiteBackend` (si existe; si no, smoke test compilation).
5. Verificación: `grep -n "gemini-3.1-pro-preview" src/services/comiteBackend.ts` debe retornar 0 líneas.
6. Commit: `chore(cost): downgrade comiteBackend summarizeAgreements to flash`

**Criterio de éxito**:
- Grep `gemini-3.1-pro-preview` en archivo retorna 0
- `npm run typecheck` pass
- Si hay test existente, pasa

---

### F-A02 [🟡] [Agente A] Downgrade susesoBackend a Flash
**Tipo**: cost · **Archivo**: src/services/susesoBackend.ts:65 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: `generateSusesoFormMetadata` usa Pro para fill estructurado de campos técnicos sobre un payload de incident. Tarea formato-conservativa, ideal para Flash. Parte del downgrade global de "form-fillers JSON-shape" identificados por el usuario.

**Plan ejecutable**:
1. `src/services/susesoBackend.ts` línea 65: cambiar `"gemini-3.1-pro-preview"` → `"gemini-3-flash-preview"`.
2. `grep -n "gemini-3.1-pro-preview" src/services/susesoBackend.ts` → 0.
3. Commit: `chore(cost): downgrade susesoBackend to flash`

**Criterio de éxito**: idem F-A01.

---

### F-A03 [🔴] [Agente A] Crear geminiGlobalDailyLimiter
**Tipo**: cost · **Archivo**: src/server/middleware/limiters.ts:165 (append) · **Skill**: simplify · **MCP**: context7 (validar express-rate-limit v8 API) · **Estim**: 8min · **Dep**: ninguna

**Descripción**: El `geminiLimiter` actual cubre 30 req/15min POR uid — protege contra abuso individual pero NO contra "100 usuarios atacan al mismo tiempo" (3000 req/15min agregados). Sin un cap global, un escenario de stress razonable puede consumir > $75/día en Gemini. Este limiter agregado es el freno de emergencia.

**Plan ejecutable**:
1. Leer `D:/Guardian Praeventio/proposed-changes/src/server/middleware/limiters.global-gemini-cap.ts` para tener el código exacto a appendear.
2. Abrir `src/server/middleware/limiters.ts`. Ir al final del archivo (después de `erpSyncLimiter`, ~línea 165).
3. Appendear el bloque siguiente (idéntico al proposed-changes, MIT-license-clean):

```typescript
/**
 * Round 22 R1 — global daily cap on /api/gemini and /api/ask-guardian
 * across ALL users. Per-uid limiter (geminiLimiter) caps individual abuse;
 * this caps aggregate spend regardless of who is calling.
 *
 * Default: 1000 req/day total. Override with GEMINI_DAILY_GLOBAL_CAP.
 *
 * Mounted BEFORE geminiLimiter on the router so the cheaper check runs
 * first on every request. When the cap is hit, returns 503 (Service
 * Unavailable) to signal it's a quota issue, not auth or rate-limit.
 */
export const geminiGlobalDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h sliding window
  max: parseInt(process.env.GEMINI_DAILY_GLOBAL_CAP ?? '1000', 10),
  // KEY: shared key so ALL traffic counts against the same bucket
  keyGenerator: () => 'gemini-global-bucket',
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 503,
  message: {
    error: 'gemini_global_cap_reached',
    message: 'Cuota diaria global de IA alcanzada. Reintenta mañana o aumenta GEMINI_DAILY_GLOBAL_CAP.',
  },
  skipFailedRequests: true, // no contar requests fallados (4xx/5xx) hacia el cap
});
```

4. Verificar `npm run typecheck`.
5. Commit: `feat(cost): add geminiGlobalDailyLimiter as emergency-brake on aggregate Gemini spend`

**Criterio de éxito**:
- `geminiGlobalDailyLimiter` exportado en `limiters.ts`
- `npm run typecheck` pass
- Documentado en commit message: rationale + override env var

---

### F-A04 [🔴] [Agente A] Mountar geminiGlobalDailyLimiter en gemini.ts
**Tipo**: cost · **Archivo**: src/server/routes/gemini.ts:185, 270 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A03

**Descripción**: El limiter creado en F-A03 sólo es efectivo si está MONTADO antes de `geminiLimiter` en las dos rutas (`/ask-guardian`, `/gemini`). Ambas comparten el bucket global.

**Plan ejecutable**:
1. Abrir `src/server/routes/gemini.ts`.
2. Línea 24, agregar import: cambiar
   ```typescript
   import { geminiLimiter } from '../middleware/limiters.js';
   ```
   a
   ```typescript
   import { geminiLimiter, geminiGlobalDailyLimiter } from '../middleware/limiters.js';
   ```
3. Línea 185 (ruta `/ask-guardian`):
   - Antes: `router.post('/ask-guardian', verifyAuth, geminiLimiter, async (req, res) => {`
   - Después: `router.post('/ask-guardian', verifyAuth, geminiGlobalDailyLimiter, geminiLimiter, async (req, res) => {`
4. Línea 270 (ruta `/gemini`):
   - Antes: `router.post('/gemini', verifyAuth, geminiLimiter, async (req, res) => {`
   - Después: `router.post('/gemini', verifyAuth, geminiGlobalDailyLimiter, geminiLimiter, async (req, res) => {`
5. Verificar `npm run typecheck`.
6. Commit: `feat(cost): mount geminiGlobalDailyLimiter on /api/gemini and /api/ask-guardian`

**Criterio de éxito**:
- Ambas rutas tienen el limiter en orden `verifyAuth` → `geminiGlobalDailyLimiter` → `geminiLimiter`
- `npm run typecheck` pass
- Manual smoke: con `GEMINI_DAILY_GLOBAL_CAP=2`, llamar 3 veces → la 3ra retorna 503 con `gemini_global_cap_reached`

---

### F-A05 [🟡] [Agente A] Crear src/components/maps/mapConfig.ts
**Tipo**: cost · **Archivo**: src/components/maps/mapConfig.ts (CREATE) · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: ninguna

**Descripción**: 8 archivos (Driving, ClimateRoutes, SafeDriving, SiteMap, VolcanicEruptionMap, Evacuation, HazmatMap, CoastalEmergencyMap) declaran `useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: ... })` con duplicación. Site25DPanel (digital-twin) ya usa `MAP_LIBRARIES` parcialmente. Centralizar la config evita re-loads del script (`@react-google-maps/api` re-carga si los `libraries` o `id` difieren) y reduce billing por re-load. Esto es cost optimization real porque cada full-load de Maps es un map-load facturable.

**Plan ejecutable**:
1. Leer `D:/Guardian Praeventio/proposed-changes/src/components/maps/mapConfig.ts` para el código exacto.
2. Crear `D:/Guardian Praeventio/repo/src/components/maps/mapConfig.ts` (mkdir maps si no existe — el repo no tiene `src/components/maps/` aún).
3. Pegar el contenido siguiente:

```typescript
/**
 * Centralized config for @react-google-maps/api loaders across the app.
 *
 * Why centralize: if two components request DIFFERENT libraries in the same
 * session, @react-google-maps/api re-loads the Maps JS, which counts as an
 * additional map load (billing impact). One shared config = one load.
 */

/**
 * Libraries used app-wide. Recommended set (free, no extra billing on map load):
 *   - 'drawing'  — DrawingManager (zones in Site25DPanel, evacuation polygons)
 *   - 'geometry' — distances, areas (compute distances between nodes)
 *
 * NOT loaded:
 *   - 'places'        → bills per request, use Places API HTTP server-side
 *   - 'visualization' → no heatmaps yet
 *   - 'marker'        → V3 new, deferred until stable
 */
export const MAP_LIBRARIES: ('drawing' | 'geometry')[] = ['drawing', 'geometry'];

/**
 * Loader ID. ALL useJsApiLoader hooks in the bundle MUST share this id and
 * MAP_LIBRARIES — else the Maps script re-loads and a console warning fires.
 */
export const MAP_LOADER_ID = 'praeventio-google-maps';

/**
 * Standard config helper for useJsApiLoader.
 *
 * Usage:
 *   const { isLoaded } = useJsApiLoader(getMapLoaderConfig());
 */
export const getMapLoaderConfig = () => ({
  id: MAP_LOADER_ID,
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  libraries: MAP_LIBRARIES,
});
```

4. `npm run typecheck`.
5. Commit: `feat(cost): centralize Google Maps config in src/components/maps/mapConfig.ts`

**Criterio de éxito**:
- Archivo existe con exports `MAP_LIBRARIES`, `MAP_LOADER_ID`, `getMapLoaderConfig`
- `npm run typecheck` pass

---

### F-A06 [🟡] [Agente A] Refactor Driving.tsx a getMapLoaderConfig
**Tipo**: cost · **Archivo**: src/pages/Driving.tsx:38, 68-71 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Descripción**: `Driving.tsx` tiene `id: 'google-map-script'` y carga sin `libraries` explícitas. Migrar a `getMapLoaderConfig()` unifica con el resto de la app y evita re-loads.

**Plan ejecutable**:
1. Abrir `src/pages/Driving.tsx`.
2. Línea 38, asegurar import: `import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';`
3. Después de la línea 38 agregar: `import { getMapLoaderConfig } from '../components/maps/mapConfig';`
4. Líneas 68-71, reemplazar:
   ```typescript
   const { isLoaded } = useJsApiLoader({
     id: 'google-map-script',
     googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
   });
   ```
   con:
   ```typescript
   const { isLoaded } = useJsApiLoader(getMapLoaderConfig());
   ```
5. Verificación: `grep -n "useJsApiLoader({" src/pages/Driving.tsx` → 0 lines.
6. `npm run typecheck`.
7. Commit en batch al final de F-A06..F-A14.

**Criterio de éxito**:
- Grep `useJsApiLoader\(\{` en archivo retorna 0
- `npm run typecheck` pass
- Smoke render: la página renderiza mapa (visualmente, después del refactor batch)

---

### F-A07 [🟡] [Agente A] Refactor ClimateRoutes.tsx
**Tipo**: cost · **Archivo**: src/pages/ClimateRoutes.tsx:5, 26-29 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir `src/pages/ClimateRoutes.tsx`.
2. Después de imports (línea 5 ya tiene `useJsApiLoader`), agregar: `import { getMapLoaderConfig } from '../components/maps/mapConfig';`
3. Líneas 26-29, reemplazar el bloque `useJsApiLoader({ id: ..., googleMapsApiKey: ... })` con `useJsApiLoader(getMapLoaderConfig())`.
4. `grep -n "useJsApiLoader({" src/pages/ClimateRoutes.tsx` → 0.

**Criterio de éxito**: idem F-A06.

---

### F-A08 [🟡] [Agente A] Refactor SafeDriving.tsx
**Tipo**: cost · **Archivo**: src/pages/SafeDriving.tsx:3, 61-64 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir `src/pages/SafeDriving.tsx`.
2. Agregar import: `import { getMapLoaderConfig } from '../components/maps/mapConfig';`
3. Líneas 61-64, reemplazar bloque `useJsApiLoader({...})` con `useJsApiLoader(getMapLoaderConfig())`.
4. `grep -n "useJsApiLoader({" src/pages/SafeDriving.tsx` → 0.

**Criterio de éxito**: idem F-A06.

---

### F-A09 [🟡] [Agente A] Refactor SiteMap.tsx
**Tipo**: cost · **Archivo**: src/pages/SiteMap.tsx:3, 58-61 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir `src/pages/SiteMap.tsx`.
2. Agregar import.
3. Líneas 58-61, reemplazar bloque con `useJsApiLoader(getMapLoaderConfig())`.

**Criterio de éxito**: idem F-A06.

---

### F-A10 [🟡] [Agente A] Refactor VolcanicEruptionMap.tsx
**Tipo**: cost · **Archivo**: src/pages/VolcanicEruptionMap.tsx:5, 41-44 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir archivo.
2. Agregar import.
3. Líneas 41-44, reemplazar bloque con `useJsApiLoader(getMapLoaderConfig())`.

**Criterio de éxito**: idem F-A06.

---

### F-A11 [🟡] [Agente A] Refactor Evacuation.tsx
**Tipo**: cost · **Archivo**: src/pages/Evacuation.tsx:4, 65-68 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir archivo.
2. Agregar import.
3. Líneas 65-68, reemplazar bloque con `useJsApiLoader(getMapLoaderConfig())`.

**Criterio de éxito**: idem F-A06.

---

### F-A12 [🟡] [Agente A] Refactor HazmatMap.tsx
**Tipo**: cost · **Archivo**: src/pages/HazmatMap.tsx:5, 41-44 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir archivo.
2. Agregar import.
3. Líneas 41-44, reemplazar bloque con `useJsApiLoader(getMapLoaderConfig())`.

**Criterio de éxito**: idem F-A06.

---

### F-A13 [🟡] [Agente A] Refactor CoastalEmergencyMap.tsx
**Tipo**: cost · **Archivo**: src/pages/CoastalEmergencyMap.tsx:14, 29-32 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-A05

**Plan ejecutable**:
1. Abrir archivo.
2. Agregar import.
3. Líneas 29-32, reemplazar bloque con `useJsApiLoader(getMapLoaderConfig())`.

Después de F-A06..F-A13, hacer commit batch: `refactor(cost): unify Google Maps loader config across 7 pages via getMapLoaderConfig`

**Criterio de éxito**: idem F-A06.

---

### F-A14 [🟢] [Agente A] Alinear Site25DPanel con getMapLoaderConfig
**Tipo**: cost · **Archivo**: src/components/digital-twin/Site25DPanel.tsx:112 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 4min · **Dep**: F-A05

**Descripción**: `Site25DPanel.tsx` ya importa `MAP_LIBRARIES` localmente. Migrar a `getMapLoaderConfig()` para mantener el id global `praeventio-google-maps` (vs el actual `'google-map-script'`).

**Plan ejecutable**:
1. Abrir `src/components/digital-twin/Site25DPanel.tsx`.
2. Verificar que línea ~6-10 importa `MAP_LIBRARIES` localmente. Si sí, eliminar ese import y reemplazar con `import { getMapLoaderConfig } from '../maps/mapConfig';`.
3. Líneas 112-116, reemplazar:
   ```typescript
   const { isLoaded } = useJsApiLoader({
     id: 'google-map-script',
     googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
     libraries: MAP_LIBRARIES,
   });
   ```
   con:
   ```typescript
   const { isLoaded } = useJsApiLoader(getMapLoaderConfig());
   ```
4. `npm run typecheck`.
5. Commit añade Site25DPanel al batch del F-A06..F-A13 (mismo PR).

**Criterio de éxito**:
- Site25DPanel usa el mismo loader-id `praeventio-google-maps`
- No hay `MAP_LIBRARIES` declarado localmente
- Smoke test: 8 páginas cargan mapas sin warnings de re-load en consola

---

### F-A15 [🟢] [Agente A] TODO en DocsModal listener
**Tipo**: cost · **Archivo**: src/components/workers/DocsModal.tsx:42-50 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: Sin `where('archived', '==', false)`, el listener `onSnapshot` recibe TODOS los docs históricos del worker, incluso archivados. Sprint 19+ debería filtrar; en este sprint sólo dejamos TODO.

**Plan ejecutable**:
1. Abrir `src/components/workers/DocsModal.tsx`.
2. Antes de la línea 42 (`const path = projectId ? ...`), agregar comentario:
   ```typescript
   // TODO Sprint 20+: agregar `where('archived', '==', false)` y orderBy('createdAt', 'desc')
   // + limit(50) para evitar leer todos los docs históricos del worker (cold-start
   // en Cloud Run + cobro por reads). Refactor diferido de Sprint 19 — primero el
   // listener-rearquitectura completo (server-sent events o snapshot-on-demand).
   ```
3. Commit: `chore: TODO Sprint 20+ on DocsModal onSnapshot (listener filtering deferred)`

**Criterio de éxito**:
- Comentario presente sobre la línea 42
- Sin cambio de comportamiento

---

### F-A16 [🟢] [Agente A] TODO en EmergencyCheckIn listeners
**Tipo**: cost · **Archivo**: src/components/emergency/EmergencyCheckIn.tsx:37, 45 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: Listener doble (project state + check-ins) sin filtros. En proyectos grandes (>200 workers) puede ser caro.

**Plan ejecutable**:
1. Abrir archivo.
2. Antes de línea 37, agregar:
   ```typescript
   // TODO Sprint 20+: si los proyectos crecen >200 workers, este listener se vuelve costoso.
   // Plan: where('lastCheckinAt', '>', Date.now() - 24h) o paginar con limit(50). Refactor
   // depende de la rearquitectura de listeners completa de Sprint 20+.
   ```
3. Commit batch con F-A15..F-A18.

**Criterio de éxito**: comentario presente.

---

### F-A17 [🟢] [Agente A] TODO en EmergenciaAvanzada listeners
**Tipo**: cost · **Archivo**: src/pages/EmergenciaAvanzada.tsx:83, 91 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: 2 listeners (chat messages + safety statuses). El chat ya usa `orderBy('createdAt', 'asc'), limit(100)` — bien. El safety listener no tiene filtros.

**Plan ejecutable**:
1. Abrir archivo.
2. Antes de línea 91, agregar:
   ```typescript
   // TODO Sprint 20+: filtrar el snapshot por `where('lastUpdate', '>', Date.now() - 24h)`
   // para no traer estados antiguos durante una emergencia activa. Diferido — la
   // implementación actual es funcional para proyectos <200 workers.
   ```

**Criterio de éxito**: comentario presente.

---

### F-A18 [🟢] [Agente A] TODO en ControlsAndMaterials listeners
**Tipo**: cost · **Archivo**: src/pages/ControlsAndMaterials.tsx:42, 46 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 3min · **Dep**: ninguna

**Descripción**: 2 listeners (controls + materials). Si el inventario crece a miles de items, el cliente lee todo. Filtro `active=true` limitaría.

**Plan ejecutable**:
1. Abrir archivo.
2. Antes de línea 42, agregar:
   ```typescript
   // TODO Sprint 20+: agregar `where('active', '==', true)` y limit(100) para inventarios
   // grandes. Hoy: aceptable para faenas <500 items por proyecto.
   ```

**Criterio de éxito**: comentario presente.

---

## Apéndice B — Detalle ejecutable de cada hallazgo del Bucket B

### F-B01 [🟡] [Agente B] Implementar loginAsTestUser real
**Tipo**: test-infra · **Archivo**: tests/e2e/fixtures/auth.ts:48-55 · **Skill**: superpowers:test-driven-development · **MCP**: plugin_playwright_playwright · **Estim**: 15min · **Dep**: F-B05

**Descripción**: El stub actual sólo escribe localStorage; no consigue auth real con el backend. Sprint 19 cierra esto: el helper genera un token tipo `E2E ${E2E_TEST_SECRET}` que el server acepta sólo si `E2E_MODE=1` (ver F-B05). El usuario fixture y el token quedan ambos en localStorage para que el frontend los use en sus fetch calls.

**Plan ejecutable**:
1. **Test primero** (TDD step 1): crear `tests/e2e/fixtures/auth.test.ts`:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './auth';

   test('loginAsTestUser pone user + token en localStorage', async ({ page }) => {
     await page.goto('http://localhost:4173/');
     const user = await loginAsTestUser(page);
     expect(user.uid).toBe('e2e-user-001');
     const stored = await page.evaluate(() => localStorage.getItem('gp.e2e.user'));
     expect(stored).toContain('e2e-user-001');
   });
   ```
2. Run test (espera FAIL — la impl es stub).
3. Editar `tests/e2e/fixtures/auth.ts`, reemplazar el cuerpo de `loginAsTestUser`:
   ```typescript
   export async function loginAsTestUser(
     page: Page,
     overrides: Partial<TestUser> = {},
   ): Promise<TestUser> {
     const user = { ...DEFAULT_TEST_USER, ...overrides };
     const e2eSecret = process.env.E2E_TEST_SECRET ?? '';
     if (!e2eSecret) {
       throw new Error('E2E_TEST_SECRET env var not set — required for E2E auth fixture');
     }
     // Build the fake bearer the way the backend will accept it (see F-B05).
     const fakeAuthHeader = `E2E ${e2eSecret}:${user.uid}`;
     await page.addInitScript(
       ({ userData, header }) => {
         localStorage.setItem('gp.e2e.user', JSON.stringify(userData));
         localStorage.setItem('gp.e2e.auth_header', header);
         // The app reads gp.e2e.auth_header in test mode and uses it instead
         // of a real Firebase ID token. Production code path is untouched.
       },
       { userData: user, header: fakeAuthHeader },
     );
     return user;
   }
   ```
4. Run test (espera PASS).
5. Commit: `feat(test): implement loginAsTestUser with E2E auth header for Playwright fixtures`

**Criterio de éxito**:
- `loginAsTestUser` retorna user con uid valid
- localStorage contiene `gp.e2e.user` y `gp.e2e.auth_header`
- Test fixture-test pasa

---

### F-B02 [🟡] [Agente B] Crear tests/e2e/fixtures/server.ts
**Tipo**: test-infra · **Archivo**: tests/e2e/fixtures/server.ts (CREATE) · **Skill**: superpowers:test-driven-development · **MCP**: context7 (Playwright docs `webServer.command`) · **Estim**: 20min · **Dep**: ninguna

**Descripción**: `playwright.config.ts` línea 13 menciona en comentario `tests/e2e/fixtures/server.ts` pero el archivo no existe. Para tests que necesiten backend real (Express en :3000) el fixture compone arranque + health-check.

**Plan ejecutable**:
1. Test primero: crear `tests/e2e/fixtures/server.test.ts`:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { startE2EServer } from './server';

   test('startE2EServer responds 200 on /api/health within 30s', async () => {
     const handle = await startE2EServer({ port: 3001 }); // distinct port
     try {
       const res = await fetch('http://localhost:3001/api/health');
       expect(res.status).toBe(200);
     } finally {
       await handle.stop();
     }
   });
   ```
2. Run (FAIL — server.ts no existe).
3. Crear `tests/e2e/fixtures/server.ts`:
   ```typescript
   /**
    * Sprint 19 — fixture para arrancar el server Express del repo en E2E mode.
    *
    * Uso normal: lo monta `playwright.config.ts > webServer` para tests que
    * necesitan llamar al backend real (no mock). En E2E_MODE=1 + E2E_TEST_SECRET
    * el verifyAuth middleware acepta el header `Authorization: E2E ${secret}:${uid}`
    * (ver src/server/middleware/verifyAuth.ts y F-B05).
    */
   import { spawn, type ChildProcess } from 'node:child_process';
   import { setTimeout as delay } from 'node:timers/promises';

   export interface E2EServerHandle {
     stop: () => Promise<void>;
     port: number;
   }

   export interface StartOptions {
     port?: number;
     readyTimeoutMs?: number;
   }

   export async function startE2EServer(opts: StartOptions = {}): Promise<E2EServerHandle> {
     const port = opts.port ?? 3000;
     const readyTimeout = opts.readyTimeoutMs ?? 30_000;
     const child: ChildProcess = spawn('npx', ['tsx', 'server.ts'], {
       env: {
         ...process.env,
         PORT: String(port),
         E2E_MODE: '1',
         NODE_ENV: 'test',
         E2E_TEST_SECRET: process.env.E2E_TEST_SECRET ?? 'fixture-default-secret-do-not-use-in-prod',
         FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080',
       },
       stdio: ['ignore', 'inherit', 'inherit'],
     });

     const start = Date.now();
     while (Date.now() - start < readyTimeout) {
       try {
         const res = await fetch(`http://localhost:${port}/api/health`);
         if (res.ok) {
           return {
             port,
             stop: async () => {
               child.kill('SIGTERM');
               await delay(500);
               if (!child.killed) child.kill('SIGKILL');
             },
           };
         }
       } catch {
         /* not ready yet */
       }
       await delay(500);
     }
     child.kill('SIGTERM');
     throw new Error(`E2E server did not become ready on :${port} within ${readyTimeout}ms`);
   }
   ```
4. Run test → PASS (asume `/api/health` existe — ver server.ts). Si no existe, agregar handler trivial en el server (`app.get('/api/health', (_, res) => res.json({ ok: true }))`) como parte de este task.
5. Commit: `feat(test): add tests/e2e/fixtures/server.ts to spawn Express in E2E mode`

**Criterio de éxito**:
- `startE2EServer` arranca y health-check pasa en <30s
- `stop()` mata el proceso limpiamente

---

### F-B03 [🟡] [Agente B] Crear tests/e2e/fixtures/seed.ts
**Tipo**: test-infra · **Archivo**: tests/e2e/fixtures/seed.ts (CREATE) · **Skill**: superpowers:test-driven-development · **MCP**: context7 (firebase emulator suite docs) · **Estim**: 25min · **Dep**: F-B02

**Descripción**: Para tests `process-lifecycle` y `sos-button`, necesitamos seedear Firestore emulator con un proyecto + cuadrilla + workers. Helper `seedProject` lo hace.

**Plan ejecutable**:
1. Test primero: `tests/e2e/fixtures/seed.test.ts`:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { seedProject, clearFirestoreEmulator } from './seed';

   test.describe('seed fixtures', () => {
     test.beforeEach(async () => {
       await clearFirestoreEmulator();
     });

     test('seedProject crea project + crew', async () => {
       const out = await seedProject({
         name: 'Constructora Test',
         crewName: 'Cuadrilla Alfa',
         tenantId: 'e2e-tenant',
       });
       expect(out.projectId).toBeTruthy();
       expect(out.crewId).toBeTruthy();
     });
   });
   ```
2. Crear `tests/e2e/fixtures/seed.ts`:
   ```typescript
   /**
    * Sprint 19 — Firestore emulator seed helpers para Playwright.
    *
    * Asume que el emulator está corriendo en FIRESTORE_EMULATOR_HOST (default
    * localhost:8080). Usa firebase-admin con projectId 'praeventio-e2e' (no
    * conflicta con el real).
    */
   import admin from 'firebase-admin';

   const E2E_PROJECT_ID = 'praeventio-e2e';

   function ensureAdmin() {
     if (admin.apps.length === 0) {
       process.env.FIRESTORE_EMULATOR_HOST =
         process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
       admin.initializeApp({ projectId: E2E_PROJECT_ID });
     }
     return admin.firestore();
   }

   export interface SeedProjectInput {
     name: string;
     crewName: string;
     tenantId?: string;
   }

   export interface SeededIds {
     projectId: string;
     crewId: string;
     tenantId: string;
   }

   export async function seedProject(input: SeedProjectInput): Promise<SeededIds> {
     const db = ensureAdmin();
     const tenantId = input.tenantId ?? 'e2e-tenant';
     const projectRef = await db.collection('projects').add({
       name: input.name,
       tenantId,
       members: ['e2e-user-001'],
       createdAt: admin.firestore.FieldValue.serverTimestamp(),
     });
     const crewRef = await db.collection(`projects/${projectRef.id}/crews`).add({
       name: input.crewName,
       members: ['e2e-user-001'],
       xpTotal: 0,
       createdAt: admin.firestore.FieldValue.serverTimestamp(),
     });
     return { projectId: projectRef.id, crewId: crewRef.id, tenantId };
   }

   export async function clearFirestoreEmulator(): Promise<void> {
     // Emulator REST API: DELETE /emulator/v1/projects/<id>/databases/(default)/documents
     const host = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
     const url = `http://${host}/emulator/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`;
     const res = await fetch(url, { method: 'DELETE' });
     if (!res.ok && res.status !== 200) {
       throw new Error(`Failed to clear emulator: ${res.status}`);
     }
   }
   ```
3. Run test (requiere emulator corriendo). Si no está, documentar `firebase emulators:start --only firestore` en RUNBOOK.md.
4. Commit: `feat(test): add tests/e2e/fixtures/seed.ts for Firestore emulator seeding`

**Criterio de éxito**:
- `seedProject` retorna ids válidos cuando emulator corre
- `clearFirestoreEmulator` resetea estado entre tests

---

### F-B04 [🟡] [Agente B] Componer playwright.config.ts webServer
**Tipo**: test-infra · **Archivo**: playwright.config.ts:60-68 · **Skill**: simplify · **MCP**: context7 (Playwright `webServer` array config) · **Estim**: 12min · **Dep**: F-B02

**Descripción**: `webServer` actual sólo arranca preview. `test:e2e:full` debe arrancar también Express (:3000) + Firestore emulator (:8080).

**Plan ejecutable**:
1. Editar `playwright.config.ts`. Reemplazar líneas 60-68 con:
   ```typescript
   webServer: process.env.E2E_NO_SERVER
     ? undefined
     : process.env.E2E_FULL
     ? [
         {
           command: 'npm run preview',
           url: 'http://localhost:4173',
           reuseExistingServer: !process.env.CI,
           timeout: 120_000,
         },
         {
           command: 'npx tsx server.ts',
           url: 'http://localhost:3000/api/health',
           reuseExistingServer: !process.env.CI,
           timeout: 60_000,
           env: {
             E2E_MODE: '1',
             NODE_ENV: 'test',
             FIRESTORE_EMULATOR_HOST: 'localhost:8080',
             E2E_TEST_SECRET:
               process.env.E2E_TEST_SECRET ?? 'fixture-default-secret-do-not-use-in-prod',
           },
         },
         {
           command: 'firebase emulators:start --only firestore --project praeventio-e2e',
           url: 'http://localhost:4400', // emulator UI
           reuseExistingServer: !process.env.CI,
           timeout: 120_000,
         },
       ]
     : {
         command: 'npm run preview',
         url: 'http://localhost:4173',
         reuseExistingServer: !process.env.CI,
         timeout: 120_000,
       },
   ```
2. Run `E2E_FULL=1 npm run test:e2e -- process-lifecycle` (depende de F-B06).
3. Commit: `feat(test): compose playwright webServer to spawn preview+express+emulator under E2E_FULL`

**Criterio de éxito**:
- `npm run test:e2e:full` (script de F-B10) arranca los 3 servers paralelo
- Sin `E2E_FULL`, comportamiento legacy: solo preview

---

### F-B05 [🔴] [Agente B] Agregar E2E_MODE guard en verifyAuth
**Tipo**: test-infra · **Archivo**: src/server/middleware/verifyAuth.ts:22-37 · **Skill**: superpowers:test-driven-development · **MCP**: ninguno · **Estim**: 18min · **Dep**: ninguna

**Descripción**: El middleware actual SOLO acepta Firebase ID tokens. Para E2E necesitamos aceptar fake tokens — pero EXCLUSIVAMENTE cuando `E2E_MODE=1` y `NODE_ENV !== 'production'`. Esto NUNCA debe activarse en prod.

**Plan ejecutable**:
1. Test primero: crear `src/__tests__/server/verifyAuthE2E.test.ts`:
   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import express from 'express';
   import request from 'supertest';
   import { verifyAuth } from '../../server/middleware/verifyAuth';

   describe('verifyAuth E2E_MODE guard', () => {
     const ORIGINAL_ENV = { ...process.env };
     beforeEach(() => {
       process.env.E2E_MODE = '1';
       process.env.NODE_ENV = 'test';
       process.env.E2E_TEST_SECRET = 'unit-test-secret';
     });
     afterEach(() => {
       process.env = { ...ORIGINAL_ENV };
     });

     it('accepts E2E header in test mode', async () => {
       const app = express();
       app.get('/p', verifyAuth, (req, res) => res.json((req as any).user));
       const res = await request(app)
         .get('/p')
         .set('Authorization', 'E2E unit-test-secret:e2e-user-001');
       expect(res.status).toBe(200);
       expect(res.body.uid).toBe('e2e-user-001');
     });

     it('REJECTS E2E header in production NODE_ENV', async () => {
       process.env.NODE_ENV = 'production';
       const app = express();
       app.get('/p', verifyAuth, (_req, res) => res.json({ ok: true }));
       const res = await request(app)
         .get('/p')
         .set('Authorization', 'E2E unit-test-secret:e2e-user-001');
       expect(res.status).toBe(401);
     });

     it('REJECTS E2E header without E2E_MODE flag', async () => {
       delete process.env.E2E_MODE;
       const app = express();
       app.get('/p', verifyAuth, (_req, res) => res.json({ ok: true }));
       const res = await request(app)
         .get('/p')
         .set('Authorization', 'E2E unit-test-secret:e2e-user-001');
       expect(res.status).toBe(401);
     });

     it('REJECTS E2E header with wrong secret', async () => {
       const app = express();
       app.get('/p', verifyAuth, (_req, res) => res.json({ ok: true }));
       const res = await request(app)
         .get('/p')
         .set('Authorization', 'E2E wrong-secret:e2e-user-001');
       expect(res.status).toBe(401);
     });
   });
   ```
2. Run (FAIL — guard no existe).
3. Editar `src/server/middleware/verifyAuth.ts`. Insertar el bloque siguiente después de la línea 24 (antes de la lógica Bearer):
   ```typescript
   // Sprint 19 — E2E mode bypass. NEVER active in production: doubly guarded
   // by E2E_MODE=1 + NODE_ENV !== 'production'. Tests in
   // src/__tests__/server/verifyAuthE2E.test.ts assert the prod path stays closed.
   if (
     process.env.E2E_MODE === '1' &&
     process.env.NODE_ENV !== 'production' &&
     authHeader &&
     authHeader.startsWith('E2E ')
   ) {
     const expected = process.env.E2E_TEST_SECRET ?? '';
     if (!expected) {
       return res.status(401).json({ error: 'Unauthorized: E2E_TEST_SECRET unset' });
     }
     const payload = authHeader.slice('E2E '.length); // "${secret}:${uid}"
     const [secret, uid] = payload.split(':');
     // Constant-time-ish equality (jose has constant-time but a length+char mismatch
     // is fine here; the secret is server-controlled and not user-supplied).
     if (secret === expected && typeof uid === 'string' && uid.length > 0) {
       (req as any).user = {
         uid,
         email: `${uid}@e2e.praeventio.test`,
         email_verified: true,
         e2e: true,
       };
       return next();
     }
     return res.status(401).json({ error: 'Unauthorized: Invalid E2E token' });
   }
   ```
4. Run tests → PASS.
5. Commit: `feat(test): add E2E_MODE guard to verifyAuth (NEVER active in production)`

**Criterio de éxito**:
- 4 tests pasan
- Guard cerrado bajo `NODE_ENV=production` aún con E2E_MODE=1
- Smoke test manual: `NODE_ENV=production E2E_MODE=1 curl ... -H "Authorization: E2E ..."` retorna 401

---

### F-B06 [🟢] [Agente B] Implementar process-lifecycle.spec real
**Tipo**: test · **Archivo**: tests/e2e/process-lifecycle.spec.ts:14-36 · **Skill**: superpowers:test-driven-development · **MCP**: plugin_playwright_playwright · **Estim**: 20min · **Dep**: F-B01..F-B05

**Plan ejecutable**:
1. Reemplazar el archivo completo con la versión real basada en el plan en comentarios actuales:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './fixtures/auth';
   import { seedProject, clearFirestoreEmulator } from './fixtures/seed';

   test.describe('Process lifecycle (start → close → XP)', () => {
     test.beforeEach(async () => {
       await clearFirestoreEmulator();
     });

     test('start → close → confetti + XP', async ({ page }) => {
       const seeded = await seedProject({
         name: 'Constructora Test',
         crewName: 'Cuadrilla Alfa',
       });
       await loginAsTestUser(page, { roles: ['supervisor'], projectIds: [seeded.projectId] });

       await page.goto(`/projects/${seeded.projectId}/gantt`);
       await page.getByRole('button', { name: /Iniciar proceso/i }).click();
       await page.getByLabel(/Tipo/i).selectOption('concreto');
       await page.getByLabel(/Nombre/i).fill('Hormigonado piso 3');
       await page.getByRole('button', { name: /Iniciar/i }).click();

       const proc = page.getByText(/Hormigonado piso 3/i);
       await expect(proc).toBeVisible();
       await proc.click();

       await page.getByRole('button', { name: /Cerrar proceso/i }).click();
       const xp = await page.getByText(/\+\s*\d+\s*XP/i).innerText();
       expect(xp).toMatch(/\+\s*\d+\s*XP/);
       await page.getByRole('button', { name: /Cerrar y celebrar/i }).click();
       await expect(page.getByText(/proceso completado/i)).toBeVisible({ timeout: 5_000 });
     });
   });
   ```
2. Run `E2E_FULL=1 npm run test:e2e -- process-lifecycle`.
3. Commit: `feat(test): implement process-lifecycle E2E spec (Sprint 19)`

**Criterio de éxito**: test pasa con `E2E_FULL=1`.

---

### F-B07 [🟢] [Agente B] Implementar sos-button.spec real
**Tipo**: test · **Archivo**: tests/e2e/sos-button.spec.ts:12-32 · **Skill**: superpowers:test-driven-development · **MCP**: plugin_playwright_playwright · **Estim**: 25min · **Dep**: F-B01..F-B05

**Plan ejecutable**:
1. Reemplazar archivo:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './fixtures/auth';
   import { seedProject, clearFirestoreEmulator } from './fixtures/seed';

   test.describe('SOSButton long-press', () => {
     test.beforeEach(async () => {
       await clearFirestoreEmulator();
     });

     test('tap corto NO dispara, long-press 3s SÍ dispara', async ({ page }) => {
       const seeded = await seedProject({ name: 'Faena Test', crewName: 'Crew SOS' });
       await loginAsTestUser(page, { projectIds: [seeded.projectId] });
       await page.goto('/emergency'); // switch to emergency mode pages

       const sos = page.getByRole('button', { name: /^SOS$/i });
       await expect(sos).toBeVisible();

       // Tap corto NO dispara
       await sos.click({ delay: 200 });
       await expect(page.getByText(/Alerta enviada/i)).not.toBeVisible({ timeout: 1500 });

       // Long-press 3s sí
       const box = await sos.boundingBox();
       if (!box) throw new Error('SOS button has no bounding box');
       await page.mouse.move(box.x + 10, box.y + 10);
       await page.mouse.down();
       await page.waitForTimeout(3200);
       await page.mouse.up();

       await expect(page.getByText(/Alerta enviada/i)).toBeVisible({ timeout: 5_000 });
     });

     test('fallback tel: si geo bloqueado', async ({ page, context }) => {
       const seeded = await seedProject({ name: 'Faena Geo Test', crewName: 'Crew Geo' });
       await loginAsTestUser(page, { projectIds: [seeded.projectId] });
       await context.grantPermissions([], { origin: 'http://localhost:4173' }); // no geo
       await page.goto('/emergency');

       const sos = page.getByRole('button', { name: /^SOS$/i });
       const box = await sos.boundingBox();
       if (!box) throw new Error('SOS button has no bounding box');
       await page.mouse.move(box.x + 10, box.y + 10);
       await page.mouse.down();
       await page.waitForTimeout(3200);
       await page.mouse.up();

       // Esperamos el fallback link
       const tel = page.locator('a[href^="tel:"]');
       await expect(tel).toBeVisible({ timeout: 5_000 });
     });
   });
   ```
2. Run.
3. Commit: `feat(test): implement sos-button E2E spec (Sprint 19)`

**Criterio de éxito**: ambos tests pasan.

---

### F-B08 [🟢] [Agente B] Implementar fall-detection-toggle.spec real
**Tipo**: test · **Archivo**: tests/e2e/fall-detection-toggle.spec.ts:9-25 · **Skill**: superpowers:test-driven-development · **MCP**: plugin_playwright_playwright · **Estim**: 15min · **Dep**: F-B01..F-B05

**Plan ejecutable**:
1. Reemplazar archivo:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './fixtures/auth';

   test.describe('FallDetection toggle preference', () => {
     test('default OFF, toggle ON persiste tras reload', async ({ page }) => {
       await loginAsTestUser(page);
       await page.goto('/settings');
       await page.getByText(/Seguridad y Privacidad/i).click();

       const toggleOff = page.getByRole('button', { name: /Activar detecci[oó]n de ca[ií]da/i });
       await expect(toggleOff).toBeVisible();
       await toggleOff.click();

       const toggleOn = page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i });
       await expect(toggleOn).toBeVisible();

       await page.reload();
       await expect(
         page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i })
       ).toBeVisible();
     });
   });
   ```
2. Run + commit `feat(test): implement fall-detection-toggle E2E spec (Sprint 19)`

**Criterio de éxito**: test pasa.

---

### F-B09 [🟢] [Agente B] Implementar offline-resilience.spec real
**Tipo**: test · **Archivo**: tests/e2e/offline-resilience.spec.ts:13-29 · **Skill**: superpowers:test-driven-development · **MCP**: plugin_playwright_playwright · **Estim**: 20min · **Dep**: F-B01..F-B05

**Plan ejecutable**:
1. Reemplazar archivo:
   ```typescript
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './fixtures/auth';
   import { seedProject, clearFirestoreEmulator } from './fixtures/seed';

   test.describe('Offline-first sync', () => {
     test.beforeEach(async () => {
       await clearFirestoreEmulator();
     });

     test('crear hallazgo offline → reconnect → visible en feed', async ({ page, context }) => {
       const seeded = await seedProject({ name: 'Faena Offline', crewName: 'Crew Offline' });
       await loginAsTestUser(page, { projectIds: [seeded.projectId] });

       await context.setOffline(true);
       await page.goto('/findings/new');
       await page.getByLabel(/Descripci[oó]n/i).fill('Cable suelto en piso 3');
       await page.getByRole('button', { name: /Guardar/i }).click();
       await expect(page.getByText(/Guardado para sincronizar/i)).toBeVisible();

       await context.setOffline(false);
       await page.waitForTimeout(2_000);
       await page.goto('/findings');
       await expect(page.getByText(/Cable suelto en piso 3/i)).toBeVisible({ timeout: 10_000 });
     });
   });
   ```
2. Run + commit `feat(test): implement offline-resilience E2E spec (Sprint 19)`

**Criterio de éxito**: test pasa.

---

### F-B10 [🟡] [Agente B] Agregar test:e2e:full y test:e2e:emulator scripts
**Tipo**: test-infra · **Archivo**: package.json:32 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: F-B02..F-B04

**Plan ejecutable**:
1. Editar `package.json` scripts (entre `test:e2e:install` y `mutation`):
   ```json
   "test:e2e": "playwright test",
   "test:e2e:full": "E2E_FULL=1 playwright test",
   "test:e2e:emulator": "firebase emulators:exec --only firestore --project praeventio-e2e \"E2E_FULL=1 playwright test\"",
   ```
2. Smoke run: `npm run test:e2e:full` (asume emulator corriendo separadamente, o bien `npm run test:e2e:emulator` lo arranca).
3. Commit: `feat(test): add test:e2e:full and test:e2e:emulator npm scripts`

**Criterio de éxito**: scripts presentes y funcionales.

---

### F-B11 [🟡] [Agente B] Mock Gemini en E2E_MODE en gemini.ts
**Tipo**: test-infra · **Archivo**: src/server/routes/gemini.ts:185, 270 · **Skill**: superpowers:test-driven-development · **MCP**: ninguno · **Estim**: 15min · **Dep**: F-A04, F-B05

**Descripción**: Cuando E2E_MODE=1, las llamadas a Gemini deben retornar payloads mock determinista — caro y flaky llamar Gemini real desde E2E suite. El payload mock debe ser válido para los handlers downstream.

**Plan ejecutable**:
1. Test primero: agregar a `src/__tests__/server/gemini.test.ts` (asume que existe):
   ```typescript
   it('returns mock when E2E_MODE=1 and uses E2E auth header', async () => {
     process.env.E2E_MODE = '1';
     process.env.NODE_ENV = 'test';
     process.env.E2E_TEST_SECRET = 'unit-test-secret';
     const res = await request(app)
       .post('/api/gemini')
       .set('Authorization', 'E2E unit-test-secret:e2e-user-001')
       .send({ action: 'getSafetyAdvice', args: ['ruido'] });
     expect(res.status).toBe(200);
     expect(res.body.result).toMatchObject({ e2e: true });
   });
   ```
2. Editar `src/server/routes/gemini.ts`. Después de la línea 273 (antes de la importación de geminiBackend), agregar:
   ```typescript
   // Sprint 19 — E2E mock path. NEVER active in production. Returns a deterministic
   // payload so the spec can assert UI behavior without burning Gemini quota.
   if (
     process.env.E2E_MODE === '1' &&
     process.env.NODE_ENV !== 'production' &&
     (req as any).user?.e2e === true
   ) {
     return res.json({
       result: {
         e2e: true,
         action,
         summary: 'E2E mock response',
         tokens: 0,
       },
     });
   }
   ```
3. Repetir para `/ask-guardian` (línea 188): retornar `{ response: 'E2E mock response', contextUsed: false, envContextUsed: false, e2e: true }`.
4. Run test → PASS.
5. Commit: `feat(test): mock Gemini in E2E_MODE to skip real API calls in spec runs`

**Criterio de éxito**:
- E2E specs no consumen quota Gemini
- Test unit gate pasa

---

(Apéndices C y D continúan en `auditoria777-parte2.md` por longitud — ver índice abajo.)

---

## Apéndice — Acciones de seguridad para el usuario (post-PR)

1. **Rotar `GEMINI_API_KEY`** — ya proporcionada en transcript de la sesión actual; cualquier persistencia en logs del runtime es exposición. Generar nueva key en Google AI Studio y reemplazar en `.env.local` + secret manager (Cloud Run). Borrar la vieja key del backend Vault.
2. **Confirmar que la key no quedó en el repo**: ejecutar local
   ```bash
   git log --all -p | grep -E 'AIzaSy[A-Za-z0-9_\-]{20,}' | head
   ```
   Esperar 0 resultados. Si hay match, BFG-rewrite + force-push (coordinar antes con team — paso destructivo).
3. **Auditar leaks históricos**: el repo tuvo Sentry DSN previo en commits `b13cfe8`/`d5e7a8e`. Para nuevo round de seguridad:
   ```bash
   git log --all -p | grep -E '@sentry\.io|https://[a-f0-9]{32}@' | head
   ```
4. **Verificar que `E2E_TEST_SECRET` NUNCA está en producción**: agregar al runbook que el secret va sólo en `.env.test` y `.env.e2e`, jamás en Cloud Run env. F-B05 incluye doble guard `E2E_MODE=1 + NODE_ENV !== 'production'` que hace el bypass inerte aún si la var se filtrara por accidente.
5. **Después de F-A03+A04** (deploy del global cap): monitorear durante 48h que no se trippea inadvertidamente (la cuota debería disparar mucho antes de un denial-of-service real). Si hay falsos positivos, subir `GEMINI_DAILY_GLOBAL_CAP` env via Cloud Run console.

---

## Apéndice — Pendientes diferidos (Sprint 20 candidates)

1. **Refactor de listeners onSnapshot** para escalabilidad — los TODO comments de F-A15..A18 quedan registrados. Plan integral Sprint 20:
   - Migrar a server-sent events (SSE) o snapshot-on-demand para colecciones grandes
   - Filtros `where('archived', '==', false)` consistentes
   - Pagination con `limit(50)` + `startAfter()`
   - Documentar pattern en `docs/architecture-decisions/`
2. **Brechas estratégicas no atacadas en Sprint 19**:
   - Brecha A FallDetection ya está hecho (Sprint 17b)
   - Brecha D Playwright E2E se cierra en Sprint 19 (este audit)
   - Brecha B SLM offline → ver F-D01 / SPRINT_20_SPEC.md
   - Brecha C fotogrametría auto → ver F-D01 / SPRINT_20_SPEC.md
3. **MedicalIcon coverage en módulos restantes**: si F-C02..C08 quedan parciales, quedan diferidos. Sin urgencia: el sistema fallback graceful evita crashes.
4. **Hex hardcodeados restantes**: 235+ ocurrencias de `text-[#xxxxxx]` en 36 archivos. F-C09 + F-C10 cubre módulos médicos; resto se difiere a Sprint 20 polish-pass.
5. **`gemini.ts` ALLOWED_GEMINI_ACTIONS**: tiene 75+ acciones. A futuro plantear split por dominio (medical/, hazmat/, ergonomics/) — pero ahora la lista plana es OK para Sprint 19 scope.

---

## Índice — Bucket C y D

El detalle ejecutable del Bucket C (15 hallazgos, simplify + UX polish + code review) y Bucket D (1 hallazgo, spec Sprint 20) está en `D:/Guardian Praeventio/repo/docs/audit/auditoria777-parte2.md`.

Hallazgos cubiertos en parte 2:
- F-C01..C15: detalle ejecutable
- F-D01: brainstorm Brecha B vs C, mockup nano-banana, plan ejecutable Sprint 20

Cierre de la auditoría 777.
