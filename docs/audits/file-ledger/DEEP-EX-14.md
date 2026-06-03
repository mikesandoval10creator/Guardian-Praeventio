# DEEP-EX #14 — B2-RiesgoIPER [0:55] · 2026-06-03

**Atestación:** leídos 55/55 archivos línea por línea (riesgo/IPER — columna
preventiva). Lote derivado de `ledger.json`: `category` empieza con "FEAT" &&
`block==="B2-RiesgoIPER"`, ordenado por `path`, slice `[0:55]` (de 79 que
matchean). El doc previo `DEEP-B2-RiesgoIPER.md` cubrió el inventario de
orfandad/cableado (engines puros, rutas montadas, components huérfanos, idle
stubs B2-D1/D2). Aquí solo van hallazgos **NUEVOS** de la lectura exhaustiva —
no repito orfandad ya documentada.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/pages/Matrix.tsx:134,193-194,228-229,776-792` | 🔴 | **Clasificación de riesgo INCONSISTENTE con el motor IPER canónico — viola la regla de "matriz P×S determinística como único clasificador legal".** `Matrix.tsx` clasifica criticidad con un banding lineal ad-hoc `score=P×S; >=16 Crítica, >=9 Alta, >=4 Media, else Baja` en 4 sitios (edit `:134`, sugerencia IA `:193`, manual save `:228`, preview UI `:776`) en vez de llamar `calculateIper()`. La matriz canónica (`iper.ts:53 IPER_MATRIX`) NO es un banding lineal: p.ej. **P=3,S=3** → canónico `moderado`(=media) pero `Matrix.tsx` da `Alta` (score 9); **P=5,S=2** → canónico `moderado` pero da `Alta` (score 10); **P=4,S=4** → canónico `importante`(=alta) pero da `Crítica` (score 16). El nodo se PERSISTE con esta criticidad errónea (`addNode` → `nodes/{id}.metadata.criticidad`) y alimenta dashboards/KPIs (`:511-512`) y modo presentación. Mismatch regulatorio directo con DS 44/2024 que `IPERCMatrix.tsx:56-59` declara como "único clasificador legal". | thresholds inline vs `IPER_MATRIX` 5×5 en `iper.ts:52-62`. `IPERCAnalysis.tsx` sí usa `calculateIper` correctamente; `Matrix.tsx` (page hermana, mismo feature) no. |
| `src/components/riskMatrix/RiskMatrix5x5.tsx:51-55` | 🟡 | **TERCER esquema de clasificación divergente** (cuarto contando el residual). `severityForCell(prob,impact)` usa `score=P×I; <=4 low, <=9 medium, <=15 high, else extreme` — distinto del canónico `IPER_MATRIX` Y distinto del banding de `Matrix.tsx` (que corta en 16 no en 15). Tres bandas de corte incompatibles para "el mismo" riesgo 5×5 coexisten en el bloque. Atenuante: el component está huérfano (0 consumidores, ya en doc previo), pero si se adopta propaga una 3ª verdad. | `Matrix.tsx` corta Crítica en `>=16`; `RiskMatrix5x5` corta extreme en `>15` (i.e. solo P=4×S=4=16 y P=5×S≥4); celda 15 (3×5/5×3) cae en `high` aquí pero el canónico la marca `importante`. |
| `src/hooks/useRiskRanking.ts:106-111,137,145,157-179` ↔ `docs/stubs-inventory.md` | 🟡 | **Doc-drift de directiva #13.** Los 3 hooks idle (`useRiskTimeseries`/`useTopRisks`/`useWeakControls` → `idleResult()`) declaran en comentario "Tracked TODO §13 + docs/stubs-inventory.md", pero **NO están registrados en `docs/stubs-inventory.md`** (grep vacío). Solo aparecen en `TODO.md:1965`. Directiva #13(d) exige registro explícito en stubs-inventory. El doc previo repitió la afirmación del comentario sin verificarla. | `grep -i riskRanking\|timeseries docs/stubs-inventory.md` → 0 hits. |
| `src/components/risks/IPERCAnalysis.tsx:191`, `src/pages/Matrix.tsx:250,298` | 🔵 | **Semántica engañosa: `hash: crypto.randomUUID()` en el audit-trail del nodo.** El campo se llama `hash` (sugiere integridad/encadenamiento del registro IPER) pero es un UUID aleatorio sin relación con el contenido — no detecta tampering. No viola #15 (`crypto.randomUUID` es el reemplazo aprobado), pero el nombre miente sobre la garantía. Estos auditTrail viven en `metadata` de `nodes` client-side, fuera de `audit_logs` server-stamped (#3). | `hash: crypto.randomUUID()` (cliente) en 3 sitios. |
| `src/pages/Risks.tsx:25,29-31` | 🔵 | **Fetch sin filtro de proyecto a nivel query.** `useFirestoreCollection<RiskNode>('nodes')` lee la colección global `nodes` y filtra `projectId` **client-side** (`:29`), mientras la hermana `useRiskEngine.ts:43-47` filtra con `where('projectId','==',...)` server-side. Risks.tsx trae todos los nodos que las reglas permitan y descarta en cliente (ineficiente + depende 100% de `firestore.rules:480 match /nodes`). Funcional pero inconsistente con el patrón canónico del propio bloque. | `Risks.tsx:25` vs `useRiskEngine.ts:43`. |
| `src/services/controlComparator/controlComparator.ts:138-145,217-219` | 🔵 | **Escalas de métrica heterogéneas mezcladas en `deltaPct`/confidence sin normalizar.** `calcComplianceImprovement` devuelve un delta firmado en `[-100,100]` (`last-first`) mientras `calcNearMissReduction`/`calcCostReduction` devuelven `[0,100]` absolutos; todas se promedian por `|deltaPct|/10` (`compareControls:287`) hacia un solo `confidenceScore`. Una métrica con escala distinta puede dominar artificialmente el veredicto A-vs-B. Es heurística declarada (no clasificación legal), engine puro y testeado — impacto bajo, pero el "score=N/100" se presenta al usuario como objetivo. | `calcComplianceImprovement` (signed Δ) vs otras (abs 0..100) → mismo pool de pesos. |

## Notas de verificación (limpios confirmados)

- **Rutas server (6 del lote):** `bowtie.ts`, `controlComparator.ts`,
  `criticalControls.ts`, `jsa.ts`, `maturity.ts`, `preShiftRisk.ts` — todas con
  `verifyAuth` + `guard()`/`assertProjectMember` antes de cualquier lectura,
  error bodies `{error:'internal_error'}` sin internals (#8 OK), engines en
  try/catch, `BowtieValidationError`/`JsaFinalizationError` → 400 tipado. `jsa`
  fuerza `approverUid=callerUid` (`:152`), `criticalControls` fuerza
  `validatedByUid=callerUid` (`:151`). Compute-only stateless → sin invariante
  audit/transacción aplicable (#3/#19 no aplican). Todas montadas en `server.ts`
  (`controlComparator:1051`, `jsa:1057`, `bowtie:1058`, `efficacy:1063`,
  `maturity:1006`, `preShiftRisk:1014`, `criticalControls:1135`, `sif:1032`).
- **`maturity.ts` + `preShiftRisk.ts`:** lecturas multi-colección con `safeRead`
  (degrada a `[]`, no 500), `coerceToDate` robusto, clamps correctos
  (`Math.min(1, recentMeetings/6)`, `workerEmpowerment` cap 0.7/1.0),
  gate de honestidad `insufficientData` correcto. Sin escrituras → sin audit.
- **Hooks fetch (`useSif`/`useBowtie`/`useControlComparator`/`useEfficacyVerification`/
  `useResidualRisk`/`useMaturityIndex`/`usePreShiftRisk`/`useRepeatingRisks`):**
  `apiAuthHeader(s)` unificado, `res.json().catch(()=>({}))` en error-path (#5 —
  ningún `JSON.parse` crudo en el lote), AbortController correcto. Sin
  promesas sueltas sin await problemáticas.
- **`useRiskEngine.ts`:** IDs con `crypto.randomUUID()` (#15 OK), cascade-delete
  de edges, LWW con detección de conflicto, embeddings fire-and-forget con
  `.catch()`. Auto-healer gated `healerRanRef` (1×/sesión, cap 5 nodos).
- **`IPERCAnalysis.tsx` + `IPERCMatrix.tsx`:** USAN `calculateIper()` correctamente,
  descartan el `criticidad` del LLM (solo sugiere controles), persisten vía
  `recordIperAssessment` + nodo espejo. Este es el flujo correcto — `Matrix.tsx`
  es el que diverge.
- **`Diagnostico.tsx`:** Round 16 R1 correcto — el LLM ya no emite `criticidad`,
  el nodo se crea "Pendiente clasificación" para que el prevencionista lo
  clasifique en `/risks` con la matriz. JSON del prompt parseado vía
  `analyzeRiskWithAI` (server-side whitelisted).
- **Gamificación:** ningún component/page del lote altera la matriz IPER con
  puntos/badges/streaks (`risks.iperc.badge` en `Risks.tsx:112` es solo el rótulo
  "Inteligencia Artificial", no gamificación). Regla "gamificación no toca IPER"
  no violada.
- **Components/pages restantes** (ChurnRiskPanel, BarrierAnalysisCard,
  RiskNodeMarkers, FindingsHeatmapPreview, LineOfFireValidationCard,
  MaturityIndexCard, PymeMaturityWizard, ResidualRiskCard, RiskNetworkExplorer,
  RiskNetworkManager, RepeatingRiskRadarCard, riskRanking/*, PresentationMode,
  PreShiftRiskCard, SIFAlert, VulnerabilityHeatmap, ChurnCohortHeatmap):
  sin `Math.random`, sin `JSON.parse` crudo, sin clasificación divergente
  (PresentationMode solo lee `metadata.criticidad` ya persistida). Estado de
  orfandad sin cambios vs doc previo.

## Para decisión del usuario (⚠️)

- ⚠️ **Hallazgo 🔴 (Matrix.tsx):** unificar TODAS las clasificaciones P×S a
  `calculateIper()` (+ mapeo `LEVEL_TO_CRITICIDAD` que ya existe en
  `IPERCMatrix.tsx:13`). Hoy hay 3 esquemas de corte incompatibles
  (`iper.ts` matriz / `Matrix.tsx` ≥16 / `RiskMatrix5x5` >15). Riesgo de
  registro IPER mal clasificado persistido y reportado a fiscalización.
- ⚠️ Registrar los 3 idle stubs de `useRiskRanking.ts` en
  `docs/stubs-inventory.md` (el comentario ya lo afirma falsamente) o corregir
  el comentario.
