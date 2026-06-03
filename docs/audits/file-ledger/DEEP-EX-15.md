# DEEP-EX-15 — Pasada exhaustiva línea-por-línea (Lote #15, B2-RiesgoIPER)

**Ledger slice**: `category` empieza con `FEAT` && `block === "B2-RiesgoIPER"`, ordenado por `path`,
`[55:79]` → 24 archivos.
**Método**: lectura completa línea-por-línea de cada archivo. Hallazgos NUEVOS respecto a
`DEEP-B2-RiesgoIPER.md` (que cubrió wiring de consumidores / dead-code) y al lote previo. Esta pasada
se enfoca en correctitud de motores IPER/matriz, reglas Firestore faltantes, auth/audit, stubs
disfrazados (#13), `Math.random` IDs (#15), fuga de internals (#8), `JSON.parse` sin try/catch (#5),
promesas sin await, y doc-drift.

## Atestación — 24/24 archivos leídos íntegros

| # | Archivo | LOC | Veredicto |
|---|---------|-----|-----------|
| 1 | src/server/routes/residualRisk.ts | 440 | 🟡 |
| 2 | src/server/routes/riskRadar.ts | 286 | 🔵 |
| 3 | src/server/routes/riskRanking.ts | 212 | 🔵 |
| 4 | src/server/routes/shiftRiskPanel.ts | 127 | 🔵 |
| 5 | src/server/routes/vulnerability.ts | 77 | 🔵 |
| 6 | src/services/bowtie/bowtieAnalysisBuilder.ts | 246 | 🔵 |
| 7 | src/services/controlComparator/controlComparator.ts | 314 | 🟡 |
| 8 | src/services/controlComparator/controlFailureLibrary.ts | 670 | 🔵 |
| 9 | src/services/criticalControls/controlRobustness.ts | 292 | 🔵 |
| 10 | src/services/criticalControls/controlValidationsStore.ts | 78 | 🔴 |
| 11 | src/services/criticalControls/criticalControlsLibrary.ts | 132 | 🔵 |
| 12 | src/services/engineering/scratchCalculations.ts | 181 | 🔵 |
| 13 | src/services/heatmap/findingsHeatmapBuilder.ts | 190 | 🔵 |
| 14 | src/services/jsa/jobSafetyAnalysis.ts | 382 | 🔵 |
| 15 | src/services/lineOfFire/lineOfFireChecker.ts | 189 | 🟡 |
| 16 | src/services/maturity/preventionMaturityIndex.ts | 395 | 🔵 |
| 17 | src/services/protocols/iper.ts | 136 | 🔵 |
| 18 | src/services/residualRisk/residualRiskEngine.ts | 228 | 🔵 |
| 19 | src/services/riskRadar/repeatingRiskRadar.ts | 417 | 🔵 |
| 20 | src/services/riskRanking/riskRankingEngine.ts | 167 | 🔵 |
| 21 | src/services/safety/iperAssessments.ts | 178 | 🔵 |
| 22 | src/services/safetyEngineBackend.ts | 131 | 🔴 |
| 23 | src/services/vulnerability/operationalVulnerabilityMap.ts | 275 | 🔵 |
| 24 | src/services/vulnerability/vulnerabilityFirestoreAdapter.ts | 58 | 🔵 |

🔴 2 · 🟡 3 · 🔵 19

---

## 🔴 Hallazgos críticos

### 🔴 H1 — `control_validations` cliente: colección sin regla → writes default-denegados en prod (#4)
`controlValidationsStore.ts:31-44` (`saveControlValidation`) escribe vía **client SDK**
(`setDoc`) en `projects/{projectId}/control_validations/{controlId__taskId}`. En `firestore.rules`
**NO existe** ningún `match /control_validations/{...}`:

```
$ grep control_validations firestore.rules → (sin coincidencias)
```

El único matcher aplicable es el master-gate `match /{subCollection=**}/{docId}` (firestore.rules:258)
que **solo concede `read`**. Por tanto, todo `saveControlValidation()` es default-denegado en producción
(`PERMISSION_DENIED`). Es exactamente el patrón que el comentario de `firestore.rules:365-382` advierte
("had NO write rule, so the master-gate granted read-only and every client save() was default-denied in
production… masked by the open `firestore.test.rules`"), pero esta colección quedó **fuera** del bloque
Sprint-K de 14 colecciones que sí se corrigió (líneas 388-477). La validación de controles críticos en
terreno (vidas críticas) se pierde silenciosamente.

**Enmascaramiento confirmado**: el test `controlValidationsStore.firestore.test.ts:10` usa
`getEmulatorAdminFirestore` (Admin SDK → **bypassa** las security rules), así que no detecta el deny.
No hay test en `rules-tests/` que ejercite esta colección con un cliente autenticado.

**Acción**: añadir `match /control_validations/{vid}` al bloque Sprint-K (create/update member-gated;
anti-spoof sobre `validatedByUid`; append-only si firmado) + ≥5 rules-tests (directiva #4) + entrada
Dirty Dozen en `security_spec.md`.

### 🔴 H2 — `JSON.parse(response.text)` sin try/catch en `predictGlobalIncidents` (#5)
`safetyEngineBackend.ts:128-129`:
```ts
if (!response.text) throw new Error('gemini_empty_response');
return JSON.parse(response.text);
```
`predictGlobalIncidents` **es** una acción whitelisteada (`src/server/routes/gemini.ts:124`), expuesta
vía `/api/gemini`. El `JSON.parse` no está envuelto en try/catch ni tiene fallback tipado / 502
(directiva #5). Aunque hay `responseSchema`, Gemini puede devolver texto truncado/markdown-fenced →
el `SyntaxError` propaga sin tipar. Contraste: `autoValidateTelemetry` (mismo archivo, :86-91) **sí**
envuelve su `JSON.parse` en try/catch devolviendo `null` — la inconsistencia confirma el descuido.
**Acción**: envolver en try/catch con fallback tipado o lanzar error que el handler mapee a 502.

---

## 🟡 Hallazgos medios

### 🟡 H3 — `lineOfFireChecker`: matching de mitigaciones por primera-palabra → falsos negativos/positivos
`lineOfFireChecker.ts:123-125`:
```ts
const missingMitigations = expectedMitigations.filter(
  (em) => !normalizedDeclared.some((dm) => dm.includes(em.toLowerCase().split(' ')[0])),
);
```
La comparación reduce cada mitigación esperada a **su primera palabra** (`.split(' ')[0]`). Para
`suspended_load` las esperadas son `'zona de exclusión bajo carga'`, `'tag-line para guiar carga'`,
`'señalero entrenado'` → primeras palabras `zona` / `tag-line` / `señalero`. Una mitigación declarada
genérica como `"zona de descanso"` contiene `"zona"` y **satisface falsamente** la barrera crítica
"zona de exclusión bajo carga". En un control que dispara **BLOQUEO duro** de tarea con personas en
trayectoria (`blockTask`, :128), un falso-positivo de cobertura puede **desbloquear** una tarea de
línea de fuego sin la barrera real. Severidad de seguridad alta pese a ser lógica determinística menor.
**Acción**: matchear por substring de la frase completa normalizada (o por `controlId` declarado), no
por primera palabra.

### 🟡 H4 — `residualRisk.ts`: `safeRead` traga errores Firestore y devuelve listas vacías
`residualRisk.ts:241-266` y `:285-306` envuelven las lecturas en `safeRead` que ante cualquier
excepción hace `logger.warn` y **retorna `[]`**. Un fallo de índice o de permisos en
`/residual-risk` o `/residual-risk/suspicious` se presenta al usuario como "sin riesgos residuales /
sin sospechosos" en vez de error. En un panel de **riesgo residual sospechoso** (drift de criticidad
bajado sin evidencia, §300), ocultar la lista por un fallo de lectura degrada silenciosamente un
control de cumplimiento. No es fuga de internals (#8 OK: cuerpo `internal_error`), pero el
fail-silent enmascara incidentes operativos. **Acción**: distinguir "vacío legítimo" de "error de
backend" (al menos propagar 500 en el path no-degradable, o exponer un flag `degraded:true`).

### 🟡 H5 — `controlComparator`: heurísticas de "reducción" mezclan unidades / signos engañosos
`controlComparator.ts`:
- `calcNearMissReduction` (:133-136) hace `100 - avg(nearMissCount)`. Si un control tiene en promedio
  >100 near-miss/mes, `Math.max(0, …)` lo clampa a 0; dos controles muy distintos (avg 150 vs avg 400)
  empatan en 0 → la métrica pierde poder discriminante justo en los peores casos.
- `calcCostReduction` (:151-156) mapea costo a 0..100 con techo arbitrario `TEN_MM` (10MM CLP);
  cualquier control ≥10MM/mes colapsa a 0 — mismo problema de saturación.
- `calcComplianceImprovement` (:138-145) con `monthlyData.length < 2` devuelve el **promedio
  absoluto** del compliance (un nivel), mientras que con ≥2 devuelve el **delta** (last−first). La
  misma métrica devuelve magnitudes semánticamente distintas según el largo de la serie, y luego se
  comparan A vs B con `favors`/`deltaPct` como si fueran homogéneas.

Es un comparador "recomendación, no decisión" (directiva #2 respetada: `recommendation` es texto),
pero las heurísticas pueden producir un `overallFavors` arbitrario. No bloqueante, pero el
`confidenceScore=NN/100` da una falsa sensación de rigor estadístico (no hay test de significancia).
**Acción**: documentar los límites de saturación en el copy de la recomendación, o normalizar por
baseline en vez de techos absolutos.

---

## 🔵 Limpios / sin hallazgo nuevo

- **`iper.ts` (17)** — Matriz IPER 5×5 correcta y consistente con SUSESO DS 44/2024 / AS-NZS 4360.
  `assertInRange` valida P,S ∈ [1,5]. `reduceLevel` clampa a 0. Sin gamificación que altere la matriz.
  Motor puro, determinístico. ✅
- **`residualRiskEngine.ts` (18)** — `scoreToLevel`/`requiresFormalAcceptance` coherentes;
  `detectCriticalityDrift` y `classifyRiskKinds` puros. Sin Math.random, sin side-effects.
- **`riskRankingEngine.ts` (20)** — pesos fijos, orden estable, `slice(topN)`. Puro.
- **`riskRadar/repeatingRiskRadar.ts` (19)** — sólidos fixes previos (Codex P2 PR#100/#312):
  filtra timestamps futuros, compara por epoch no lexicográfico, IDs estables por bucket de 14d
  (no `Math.random`), filtra kind/zoneId vacíos para no inflar patrones. Determinístico.
- **`routes/riskRadar.ts` (2)** — `verifyAuth` + `assertProjectMember` + `resolveTenantId`; fallback
  de índice faltante; degradación a reporte vacío **documentada inline** (:13-15) — aceptable para
  dashboard no-crítico. Cuerpo de error `internal_error` (#8 OK).
- **`routes/riskRanking.ts` (3) / `shiftRiskPanel.ts` (4) / `vulnerability.ts` (5)** — todos con
  `verifyAuth` + guard de membresía, Zod validate, error bodies sin internals. Rutas stateless de
  compute puro; vulnerability lee snapshots (server Admin SDK, no aplica rule-gap). ✅
- **`routes/residualRisk.ts` (1)** — auth + membresía + `assertProjectMember`; gate de rol para
  `/accept` (admin/gerente, :402); audit `await`-eado (#14 OK) en create/accept; cuerpo de error sin
  internals. (Salvo H4 fail-silent arriba.)
- **`bowtieAnalysisBuilder.ts` (6)** — validación de IDs duplicados, effectiveness ∈ [0,1],
  `scoreResidualRisk` determinístico. Puro.
- **`controlFailureLibrary.ts` (8)** — 35 entries de datos estáticos + lookups puros. Sin lógica de
  riesgo. ✅
- **`controlRobustness.ts` (9) / `criticalControlsLibrary.ts` (11)** — jerarquía ISO 45001 / HCA
  correcta (elimination=100 … epp=10); `validatePreTask` detecta abuso de EPP (no balanceado). Puros.
- **`jobSafetyAnalysis.ts` (14)** — multiplicadores ISO 45001, residual clamp [1,25], separación de
  funciones (approver≠author, :364). Puro; firma vía hash hex precomputado por el caller.
- **`preventionMaturityIndex.ts` (16)** — Bradley Curve, pesos suman 1.0, `clamp01`, recomendaciones
  determinísticas. Puro.
- **`heatmap/findingsHeatmapBuilder.ts` (13)** — binning geo determinístico, orden estable. Puro.
- **`scratchCalculations.ts` (12)** — IDs **determinísticos** vía SHA-256 (`crypto.subtle`, no
  `Math.random` #15 OK) con fallback hash documentado; IndexedDB cliente, sin Firestore directo.
  `canonicalJsonStringify` correcto. ✅
- **`iperAssessments.ts` (21)** — usa `randomId()` (no Math.random, #15 OK); envelope append-after-sign;
  audit `await`-eado; doble-firma bloqueada (:160). La colección `iper_assessments` **sí** tiene rule
  (firestore.rules:720). ✅
- **`operationalVulnerabilityMap.ts` (23) / `vulnerabilityFirestoreAdapter.ts` (24)** — engine puro +
  adapter Admin SDK (server-side, snapshots, no rule-gap cliente). ✅
- **Sin diagnóstico médico (ADR 0012)** en ningún archivo del lote. **Sin gamificación que altere la
  matriz IPER/riesgo** (los engines no leen puntos/medallas). **Sin stubs disfrazados (#13)** ni
  `NotImplementedError`. **Sin `Math.random` (#15)** en server/ID-gen.

---

## Resumen (6-10 líneas)

Lote #15 (24 archivos B2-RiesgoIPER) leídos íntegros. Los motores de riesgo (IPER 5×5, residual, JSA,
bowtie, ranking, radar, madurez, vulnerabilidad) son puros, determinísticos y correctos; sin
gamificación que toque la matriz ni diagnóstico médico. **2 hallazgos 🔴**: (H1) la colección cliente
`projects/{pid}/control_validations` (`controlValidationsStore.ts`) **no tiene regla Firestore** → el
master-gate la deja read-only y los `setDoc` de validación de controles críticos quedan
default-denegados en producción —exactamente el patrón que el comentario de `firestore.rules:365` dice
haber corregido para otras 14 colecciones, pero ésta se omitió; el test `.firestore.test.ts` usa Admin
SDK y enmascara el deny; y (H2) `predictGlobalIncidents` (acción whitelisteada `/api/gemini`) hace
`JSON.parse(response.text)` sin try/catch (viola #5), mientras el `autoValidateTelemetry` del mismo
archivo sí lo envuelve. **3 hallazgos 🟡**: (H3) `lineOfFireChecker` matchea mitigaciones por
primera-palabra (`split(' ')[0]`), pudiendo desbloquear falsamente tareas de línea de fuego con
personas en trayectoria; (H4) `residualRisk.ts` traga errores Firestore (`safeRead` → `[]`),
ocultando fallos como "sin riesgos sospechosos"; (H5) las heurísticas de `controlComparator` saturan
en techos absolutos y `calcComplianceImprovement` cambia de semántica según el largo de serie,
inflando un `confidenceScore` sin rigor estadístico. Error-bodies no filtran internals (#8 OK) y los
audit-logs relevantes están `await`-eados (#14 OK). Doc-only; sin cambios de código ni commit.
