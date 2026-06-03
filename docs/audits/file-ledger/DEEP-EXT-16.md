# DEEP-EXT-16 — Auditoría exhaustiva de tests (Lote #16)

**Scope:** `ledger.json` filtro `category==="I-TEST"`, orden por `path`, slice `[825:880]` (55 archivos).
**Universo:** `src/services/**` — engines de función pura (REBA/RULA ergonomía, euler/* matemática, DTE, escalation SLA, eventos/event-sourcing, emergencia/SOS, etl/excel importers) + adapters Firestore con fake in-memory + 2 clientes HTTP con `vi.stubGlobal('fetch')`.
**Método:** lectura línea por línea de cada test; cruce contra `src/test/fakeFirestore.ts` (helper DI in-memory) y el patrón `now`/clock-inyectado usado por cada servicio.
**Fecha:** 2026-06-03. Doc-only, sin commit.
**Atestación:** 55/55 archivos leídos íntegros (no muestreo).

Leyenda severidad: 🔴 falso-verde grave (un bug real pasaría) · 🟡 cobertura ilusoria / tautológica · 🔵 menor / nota.

---

## Veredicto general

Lote **de los más sanos** auditados hasta ahora. Cero rules-tests / cero Admin SDK / cero `if(!testEnv) return` silent-pass / cero skip·todo·fixme / cero `it()` vacío / cero snapshot-only / cero "wire-up contract" (no hay supertest aquí). El 100% son **engines puros y deterministas** o **adapters contra `createFakeFirestore()`** (reimplementación legítima in-memory de `where/orderBy/limit/subcollections`, NO el SDK; NO silent-pass). Los dos clientes HTTP (`environmentBackend*`) usan `vi.stubGlobal('fetch')` con payloads sintéticos pero aseveran la **transformación** real (m/s→km/h, flip 180° del viento, agregación 3h→día worst-case) — no son over-mocking tautológico.

**Sin falsos-verdes graves (🔴).** Solo 4 hallazgos menores: un test "K" del clasificador de RUT que es tautológico, tres tests de timing/performance que son frágiles pero no falsos-verdes.

Notas positivas dignas de mención (anti-tautológico, anti-disfrazado):

- **REBA/RULA** (`reba.test.ts` 1014 LOC, `rula.test.ts` 903 LOC): snapshot **paramétrico** verbatim de las 3 lookup tables canónicas (Hignett 2000) vía `it.each` cubriendo cada celda 5×3×4 / 6×2×3 / 12×12, más worked-examples con cálculo a mano comentado paso a paso. Cualquier mutación de una celda mata ≥1 test. Esto es exactamente lo que pide la regla #9 (mutation-tested).
- **euler/*** (criticalLoad, inviscidFlow, fftAnalyzer, odeIntegrator): pins contra **valores cerrados de libro de texto** (P_cr Euler ≈493.48 kN, sonido aire 343 m/s, FFT impulse→espectro plano, Euler ODE error O(h)). No se prueban contra sí mismos.
- **erpAdapter.test.ts** (anti-stub-disfrazado, regla #13): verifica explícitamente que los adapters reales tiran `ErpMissingCredentialsError`/`ErpNotImplementedError` y NO simulan éxito; el `MockErpAdapter` debe declararse `mode:'mock'` y marcar `/MOCK/` + `/NO se conectó/`.
- **custodyChainService.test.ts:130-156** verifica integridad real: hash recomputado coincide (`valid:true`) y bytes alterados → `valid:false`.
- **eventReplayAuditTool.test.ts:382-389** aseveran defense-in-depth PII: el export de compliance NO contiene `reconstructedState` (`secretSSN` ausente del markdown).
- **dteAutoIssueOrchestrator/dteIssueQueue**: idempotency key estable + backoff exponencial verificado contra `BACKOFF_SCHEDULE_MS[i]` real, permanent_failure tras MAX_ATTEMPTS.
- **sosOutbox.test.ts**: idempotencia por `clientEventId`, backoff, hard-cap 50 con descarte del más viejo, throw-as-failure sin romper la cola.
- **emergencyNumbers.test.ts:84-93** anti tel-injection: `toTelUri("131; rm -rf /")` → `tel:131`.

---

## Hallazgos individuales

### 🟡 `dte/dteAutoIssueOrchestrator.test.ts:48-62` — test "acepta DV K" tautológico / no prueba K

El test se titula `'acepta DV "K" (modulo 11 → 10)'` y su comentario de 12 líneas intenta (y falla en) construir a mano un RUT con DV K, terminando por probar `classifyChileanTaxId('1-9')` con el assert débil `expect(out.kind).not.toBe('invalid')`. Resultado: **el caso K nunca se ejercita** (no hay ningún input cuyo DV sea K), y el assert `not.toBe('invalid')` deja pasar `'company'` o `'individual'` indistintamente. Una impl que calcule mal el residuo 10→'K' (el caso especial de RUT chileno) pasa en verde. El nombre del test promete cobertura que no existe — cobertura ilusoria sobre la rama más propensa a bug del algoritmo módulo-11. Fix: usar un RUT con K conocido (p. ej. `'12345670-K'`, validado en `excelImporter.test.ts:17-20` y `recordValidator.test.ts:14`) y aseverar `kind !== 'invalid'` + el normalized correcto.

### 🔵 `euler/eulerLagrange.test.ts:193-200` — performance test frágil + `Math.random()`

`'performance: 50 nodes completes within 200ms'` siembra coordenadas con `Math.random()` (input no determinista) y solo aseveran `elapsed < 200ms`. No es falso-verde (sí ejecuta el algoritmo y lo demás del archivo lo valida), pero el umbral de wall-clock es frágil en CI cargado y el input aleatorio no pinea ningún comportamiento. Mismo patrón en `eulerianPath.test.ts:186-199` (100-edge cycle <50ms), `graphConnectivity.test.ts:170-180` (1000-node <100ms), `fftAnalyzer.test.ts:196-205` (N=4096 <100ms con `Math.random()`), `odeIntegrator.test.ts:143-157` (10000-step <50ms). `Math.random()` en archivos de test está permitido por la regla #15, así que es solo nota de fragilidad, no violación.

### 🔵 `euler/eulerLagrange.test.ts:150-167` — 2-opt assert auto-debilitado

`'2-opt improves a deliberately bad seed'` comenta explícitamente que el greedy puede ganarle al perímetro y por eso solo aseveran `totalAction <= 50` (cota laxa). El test documenta su propia debilidad: no verifica que 2-opt *mejore* nada, solo que el resultado esté bajo una cota. Una impl de 2-opt no-op pasaría mientras el seed greedy ya cumpla. Menor; el resto de `optimizeInspectionRoute` (start preservado, todos visitados, legs suman al total, priority bias) sí está bien pineado.

### 🔵 `emergency/autoTrigger.test.ts:107-127` / `:129-158` — guards de entorno con assert mínimo

Los tests 7 y 8 (DeviceMotion ausente / iOS requestPermission rechazado) solo aseveran `checkSismo()` resuelve `false` sin lanzar. Es el comportamiento correcto (graceful no-throw), pero el assert `resolves.toBe(false)` también pasaría si el detector estuviera completamente roto y siempre devolviera false. El valor del test está en el `not throw`, que sí se ejercita vía `await expect(...).resolves`. Nota, no hallazgo: la cobertura "positiva" del trigger vive en los otros 6 tests del mismo archivo + `autoTrigger.usgs.test.ts`.

---

## Tabla resumen

| # | Archivo | LOC | Veredicto | Nota |
|---|---|---|---|---|
| 0 | documents/legalDocTemplates.test.ts | 135 | ✅ sólido | token-render + missing-token + refs normativas |
| 1 | domainEvents/domainEventStore.test.ts | 156 | ✅ sólido | append-only, dup reject, replay+snapshot |
| 2 | drillsManager/drillsManager.test.ts | 182 | ✅ sólido | `insufficient_baseline` (Codex #316 P2) bien pineado |
| 3 | driving/commuteSession.test.ts | 111 | ✅ sólido | cap, type-guard, decorator; helpers puros |
| 4 | driving/speedTrigger.test.ts | 163 | ✅ sólido | haversine + jitter-gating + brake con umbrales reales |
| 5 | drivingSafety/drivingSafetyService.test.ts | 126 | ✅ sólido | licencia vencida → score 0, asignación bloqueada |
| 6 | dte/dteAutoIssueOrchestrator.test.ts | 196 | 🟡 | test "K" tautológico (:48-62); resto sólido |
| 7 | dte/dteIssueQueue.test.ts | 167 | ✅ sólido | backoff exponencial verbatim, permanent_failure |
| 8 | efficacyVerification/efficacyVerifier.test.ts | 251 | ✅ sólido | window_incomplete + Codex #127 P2 anti-ratify |
| 9 | email/resendService.test.ts | 252 | ✅ sólido | payload shape + error envelope + templates HTML |
| 10 | emergency/autoTrigger.test.ts | 160 | 🔵 | env-guards mínimos (:107-158); resto sólido |
| 11 | emergency/autoTrigger.usgs.test.ts | 106 | ✅ sólido | USGS confirm/no/timeout; blockOperation always false |
| 12 | emergency/emergencyNumbers.test.ts | 95 | ✅ sólido | anti tel-injection (:84-93) |
| 13 | emergency/gpsBreadcrumbTracker.test.ts | 128 | ✅ sólido | ventana, orden asc, cap maxPoints |
| 14 | emergency/sosOrchestrator.test.ts | 195 | ✅ sólido | idempotency end-to-end, fallback coords, disclaimer |
| 15 | emergency/sosOutbox.test.ts | 122 | ✅ sólido | idempotente, backoff, hard-cap 50, throw=fallo |
| 16 | emergencyBrigade/emergencyBrigadeService.test.ts | 124 | ✅ sólido | cobertura mínima, capacitación vencida no cuenta |
| 17 | engineering/scratchCalculations.test.ts | 121 | ✅ sólido | IDs determinísticos, namespacing por user (fake-idb) |
| 18 | engineeringControls/engineeringControlsInventory.test.ts | 151 | ✅ sólido | jerarquía de control, EPP issues |
| 19 | environment/chileClimatology.test.ts | 116 | ✅ sólido | zonas, determinismo, Tmax>Tmin invariante |
| 20 | environmentBackend.client.test.ts | 140 | ✅ sólido | m/s→km/h + flip 180°; degradación a unavailable |
| 21 | environmentBackend.test.ts | 399 | ✅ sólido | agregación 3h→día worst-case, weather-code mapping |
| 22 | environmental/environmentalCompliance.test.ts | 154 | ✅ sólido | footprint CO2, manifest validation, alert action |
| 23 | environmental/wasteFirestoreAdapter.test.ts | 118 | ✅ sólido | fakeFirestore; in-stock excluye manifestId |
| 24 | equipment/equipmentFirestoreAdapter.test.ts | 94 | ✅ sólido | fakeFirestore; subcollection aislada |
| 25 | equipment/equipmentQrService.test.ts | 159 | ✅ sólido | checklist incompleto throw, derive status por criticidad |
| 26 | ergonomics/landmarksToScore.test.ts | 221 | ✅ sólido | math helpers + integración real REBA/RULA |
| 27 | ergonomics/poseEdgeFilter.test.ts | 129 | ✅ sólido | fase1/skip/fase2 con transport fake + timers fake |
| 28 | ergonomics/reba.test.ts | 1014 | ✅ excelente | snapshot paramétrico tablas A/B/C + worked examples |
| 29 | ergonomics/rula.test.ts | 903 | ✅ excelente | mismo patrón paramétrico mutation-grade |
| 30 | erp/erpAdapter.test.ts | 172 | ✅ excelente | anti-stub: reales tiran, mock se autodeclara |
| 31 | escalation/escalationSlaEngine.test.ts | 231 | ✅ sólido | SLA states, fallback chain, audit history inmutable |
| 32 | etl/csvAdapter.test.ts | 159 | ✅ sólido | quoting/escaping, aliases es, round-trip |
| 33 | etl/schemas.test.ts | 138 | ✅ sólido | un schema por entidad + rechazo de inválidos |
| 34 | euler/criticalLoad.test.ts | 175 | ✅ excelente | Pcr Euler vs valor cerrado, K factors |
| 35 | euler/eulerLagrange.test.ts | 214 | 🔵 | perf frágil (:193) + 2-opt laxo (:150); resto sólido |
| 36 | euler/eulerianPath.test.ts | 200 | ✅ sólido | Hierholzer, Königsberg, verifica todas las aristas |
| 37 | euler/fftAnalyzer.test.ts | 206 | ✅ sólido | round-trip, impulse, DC, leakage; perf nota |
| 38 | euler/graphConnectivity.test.ts | 181 | ✅ sólido | componentes, Euler theorem, self-loops |
| 39 | euler/inviscidFlow.test.ts | 217 | ✅ excelente | sonido/Mach/choked vs valores de libro |
| 40 | euler/odeIntegrator.test.ts | 273 | ✅ sólido | convergencia O(h), fire-spread phases |
| 41 | euler/polyhedronAchievements.test.ts | 186 | ✅ sólido | χ=V-E+F, platonic solids, quiz→progress capped |
| 42 | euler/zettelkastenTopology.test.ts | 261 | ✅ sólido | clustering/degree/betweenness vs grafos conocidos |
| 43 | evacuation/evacuationFirestoreAdapter.test.ts | 91 | ✅ sólido | fakeFirestore; addScan idempotente |
| 44 | evacuation/evacuationHeadcount.test.ts | 150 | ✅ sólido | coverage%, postmortem averageTime |
| 45 | eventBus/eventBus.test.ts | 351 | ✅ sólido | throttle/debounce con ts/timers; integraciones |
| 46 | eventReplay/eventReplayAuditTool.test.ts | 448 | ✅ excelente | replay multi-tenant, diff, export sin PII |
| 47 | eventStore/inMemoryEventStore.test.ts | 200 | ✅ sólido | optimistic concurrency, idempotency por eventId |
| 48 | evidenceChain/custodyChainFirestoreAdapter.test.ts | 90 | ✅ sólido | fakeFirestore; subcollections aisladas por hash |
| 49 | evidenceChain/custodyChainService.test.ts | 190 | ✅ sólido | hash integridad real, doble-replace reject |
| 50 | excelImport/excelImporter.test.ts | 94 | ✅ sólido | RUT DV, dedupe por rut normalizado |
| 51 | excelImporter/deduplicator.test.ts | 92 | ✅ sólido | existingKeys, keyFor custom, case-insensitive |
| 52 | excelImporter/recordValidator.test.ts | 134 | ✅ sólido | RUT/ISO/email, issues por columna |
| 53 | excelImporter/xlsxReader.test.ts | 134 | ✅ sólido | adapter fake DI, canonicalize, too_large/invalid |
| 54 | exceptions/exceptionEngine.test.ts | 162 | ✅ sólido | validUntil, roles, deriveStatus, no doble-revoke |

---

## Conteo sólidos

- **Sólidos (✅):** 51 / 55 (de los cuales 6 destacan como **excelentes**: reba, rula, erpAdapter, criticalLoad, inviscidFlow, eventReplayAuditTool).
- **🟡 cobertura ilusoria / tautológica:** 1 (dteAutoIssueOrchestrator test "K").
- **🔵 menores / notas:** 2 (eulerLagrange perf+2-opt agrupados; autoTrigger env-guards).
- **🔴 falsos-verdes graves:** 0.

Tasa de falsos-verdes graves del lote: **0/55**. Único accionable real: corregir `dte/dteAutoIssueOrchestrator.test.ts:48-62` para que ejercite un RUT con DV K verdadero.
