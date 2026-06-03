# DEEP-EX-36 — Pasada exhaustiva línea-por-línea (Lote #36)

**Bloque:** B18-Analitica · **Categoría:** FEAT* · **Deriva:** `ledger.json` →
`category` startsWith `"FEAT"` && `block === "B18-Analitica"`, orden por `path`,
slice `[110:125]` (15 archivos, índices 110–124 — el bloque tiene exactamente
125 entradas FEAT, este lote cierra la cola).

**Método:** lectura completa línea-por-línea de cada archivo. Verificación
cruzada de: whitelist Gemini (`src/server/routes/gemini.ts`), existencia de
archivos referenciados, manejo de errores en el dispatcher de Gemini. No se
repiten hallazgos ya documentados en `DEEP-B18-Analitica.md`, `DEEP-EX-34.md`
ni `DEEP-EX-35.md`.

## Atestación 15/15

| # | Archivo | Estado |
|---|---------|--------|
| 110 | `src/services/multiProject/projectComparator.ts` | Limpio |
| 111 | `src/services/orgMetrics/organizationalMetrics.ts` | Limpio |
| 112 | `src/services/predictionBackend.ts` | 🔵 (2 obs menores) |
| 113 | `src/services/predictiveAlerts/alertScheduler.ts` | Limpio |
| 114 | `src/services/predictiveAlerts/calendarPreWarn.ts` | Limpio |
| 115 | `src/services/predictiveAlerts/windowedTrigger.ts` | Limpio |
| 116 | `src/services/projectComparator/projectComparator.ts` | Limpio |
| 117 | `src/services/reportsAutomation/reportsAutomation.ts` | 🟡 (1 obs) |
| 118 | `src/services/reputationalAlerts/reputationalAlertEngine.ts` | Limpio |
| 119 | `src/services/roiScenario/roiScenarioSimulator.ts` | Limpio |
| 120 | `src/services/safetyMetrics/osha.ts` | Limpio |
| 121 | `src/services/safetyPerformance/safetyPerformanceIndex.ts` | Limpio |
| 122 | `src/services/workerHistory/portableHistoryExporter.ts` | Limpio |
| 123 | `src/services/zettelkasten/climateRiskCoupling.ts` | Limpio |
| 124 | `src/services/zettelkasten/families/aiAnalyticsNodeRegistry.ts` | 🔵 (1 obs) |

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `reportsAutomation/reportsAutomation.ts:46,88-110` | 🟡 | Feature de integridad declarada-pero-no-implementada. El header dice "Versiones publicadas inmutables" y `PublishedReport.contentHash?` se documenta como "Hash SHA-256 del contenido para integridad", pero `renderReport()` jamás lo computa ni lo setea — el campo queda siempre `undefined`. Un reporte "inmutable" sin hash de integridad no es verificable. No es stub-disfrazado clásico (no retorna mock), pero es una promesa de no-repudio incumplida en un módulo regulatorio. | L46 `contentHash?: string;` con comentario "para integridad"; L100-109 el objeto de retorno de `renderReport` omite `contentHash`. Contrasta con `portableHistoryExporter.ts` (#122) que SÍ computa checksum SHA-256 vía `@noble/hashes`. |
| `predictionBackend.ts:75,124` | 🔵 | `JSON.parse(response.text)` sin try/catch ni fallback tipado (CLAUDE.md #5). Si Gemini devuelve JSON malformado pese al `responseSchema`, el throw burbujea hasta el dispatcher en `gemini.ts:451-461`, que lo captura y responde 500 leak-safe — no 502 con fallback como pide la directiva. Mitigado por el catch del dispatcher (no rompe ni filtra internals), por eso 🔵 y no 🟡. Ambas acciones (`generatePredictiveForecast`, `analyzeRiskCorrelations`) están correctamente whitelisteadas (`gemini.ts:157,199`). | L75/L124 `return JSON.parse(response.text);` directo; catch genérico en `gemini.ts:451`. |
| `predictionBackend.ts:43,104` | 🔵 | Doc-drift de modelo: usa `model: "gemini-3.1-pro-preview"` mientras el accounting del dispatcher asume Flash por defecto (`gemini.ts` "Most RPCs use Flash internally; Pro is reserved for the ask-guardian path" → `estimateGeminiCostUsd('gemini-2.0-flash', …)`). Estas 2 acciones predictivas usan Pro-preview pero se facturan a precio Flash → sub-metering de costo. No afecta seguridad; impacto financiero menor por subestimación. | L43/L104 `"gemini-3.1-pro-preview"` vs comentario de pricing en el dispatcher. |
| `families/aiAnalyticsNodeRegistry.ts:26-44` | 🔵 | Doc-drift en `producerHint`: varios nodos apuntan a rutas inexistentes — `src/services/auditLog.ts` (real: `compliance/normativeAuditLog.ts` o `aiQuality/aiAuditLog.ts`), `src/services/rag.ts` (real: `ragService.ts`), `src/services/visionAnalyzer.ts` (no existe ningún `visionAnalyzer*`). Son strings descriptivos de metadata de grafo (no imports), por eso no rompen compilación, pero el catálogo "estático" miente sobre los productores reales. | L26-30 `'src/services/auditLog.ts'`; L31-33 `'src/services/rag.ts'`; L39-44 `'src/services/visionAnalyzer.ts'`. `find` confirma ausencia de los 3. |

## Verificaciones que resultaron limpias (no son hallazgos)

- **Cross-tenant / colecciones sin regla / PII en analítica:** todos los
  módulos del lote son funciones PURAS (sin Firestore, sin red, sin
  `Date.now()` salvo defaults inyectables). El caller pre-agrega y persiste;
  estos servicios no leen ni escriben Firestore → fuera del alcance de #3/#4/#6.
- **`Math.random()` (#15):** ausente en todo el lote. IDs derivados de keys
  determinísticas (`repalert_${idx}_${key}` en `reputationalAlertEngine.ts:281`;
  `prewarn_${projectId}_${taskId}_${hazard}` en `calendarPreWarn.ts:226`) — no
  hay generación aleatoria.
- **ADR 0012 / no-diagnóstico (#10):** `climateRiskCoupling.ts:128` exporta
  `assessClimateRisk` — nombre fonéticamente cercano al baneado
  `assessClinicalRisk`, pero es riesgo CLIMÁTICO, no clínico, y vive fuera de
  rutas médicas; el guard pre-commit no aplica. `portableHistoryExporter.ts`
  (#122) maneja PII médica con redacción por defecto (`medicalContext` =
  `'REDACTED'` salvo `includeMedical && level==='medical'`), hash de RUT
  obligatorio y disclaimer ADR-0012 siempre presente (L177-183, L277) —
  ejemplar, no es hallazgo.
- **Datos hardcodeados mostrados como reales:** los benchmarks en `osha.ts`
  (BLS 2023 / SUSESO 2023 / ICMM 2022, L175-193) y los multiplicadores EONET en
  `climateRiskCoupling.ts:452-457` están claramente etiquetados como constantes
  de referencia con fuente citada — no se presentan como mediciones del tenant.
- **Stubs disfrazados (#13):** ninguno. Toda la lógica es real y completa
  (salvo el `contentHash` no-computado de #117, registrado arriba como 🟡).

## Resumen

Lote #36 (15 archivos, cola de B18-Analitica FEAT-services) revisado
línea-por-línea. Son motores de analítica/predicción PUROS y determinísticos
(comparadores de proyectos, métricas OSHA/ICMM, SPI, ROI multi-escenario,
alertas reputacionales, pre-warning calendario, exportador de historial
portátil) — sin Firestore, sin red, sin `Math.random()`, sin riesgo
cross-tenant ni colecciones nuevas. **Sin hallazgos 🔴.** Un solo 🟡:
`reportsAutomation.ts` declara reportes "inmutables" con `contentHash`
SHA-256 que `renderReport()` nunca computa — promesa de no-repudio incumplida
en módulo regulatorio (contrasta con `portableHistoryExporter.ts`, que sí
hashea correctamente). Tres 🔵 de doc-drift/menores: `predictionBackend.ts`
hace `JSON.parse` sin fallback tipado (CLAUDE.md #5, mitigado por el catch del
dispatcher) y usa `gemini-3.1-pro-preview` facturado a precio Flash
(sub-metering); `aiAnalyticsNodeRegistry.ts` tiene `producerHint` apuntando a
3 archivos inexistentes (`auditLog.ts`, `rag.ts`, `visionAnalyzer.ts`). Ambas
acciones Gemini de `predictionBackend.ts` están correctamente whitelisteadas.
Doc-only, sin commit.
