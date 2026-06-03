# DEEP-EXT-15 — Auditoría exhaustiva de tests (Lote #15)

**Scope:** `ledger.json` filtro `category==="I-TEST"`, orden por `path`, slice `[770:825]` (55 archivos).
**Universo:** `src/services/**` — engines puros de compliance/criticalControls/digitalTwin/curriculum + adapters Firestore con fake in-memory + 1 test de emulador real.
**Método:** lectura línea por línea de cada test; cruce contra el `fakeFirestore` helper (`src/test/fakeFirestore.ts`) y el patrón de DI usado por cada servicio.
**Fecha:** 2026-06-03. Doc-only, sin commit.

Leyenda severidad: 🔴 falso-verde grave (un bug real pasaría) · 🟡 cobertura ilusoria / tautológica · 🔵 menor / nota.

---

## Veredicto general

Lote **mucho más sano** que el #12 (que era 100% route wire-up). Aquí casi todo son **engines de función pura** (compliance DS67/DS76, trafficLight, criticalControls, controlComparator, costCalculator, consistencyAuditor, digitalTwin/normativaRules, curriculum/claims, etc.) y **adapters** probados contra un `fakeFirestore` in-memory legítimo (NO el Admin SDK; NO silent-pass — `createFakeFirestore()` reimplementa `where/orderBy/limit/runTransaction`). Los tests ejercitan comportamiento real, con casos borde, fechas determinísticas (`now` inyectado) y asserts sobre el resultado, no sobre el mock. **Sin falsos-verdes graves (🔴).** Hallazgos son menores: un puñado de asserts cuyo nombre promete ordenamiento que no se verifica, y un cluster de tests del USDZ exporter que no aseveran que las opciones tengan efecto.

Notas positivas dignas de mención (anti-tautológico):
- `refereeTokens.test.ts:51-57` valida `sha256("abc")` contra el vector RFC conocido — no se prueba a sí mismo.
- `ds67Service.country.test.ts` / `ds76Service.country.test.ts` aseveran defense-in-depth: tras throw, el form permanece sin firmar (`stored?.signature` undefined), no solo que lanzó.
- `claims.test.ts:127-129, 330-333` verifican que el raw token NUNCA se persiste (`JSON.stringify(stored)` no lo contiene).
- `normativaRules.test.ts:65-71` prueba el borde exacto de 25 m (boundary inclusive) + distancia 3D real.
- `controlValidationsStore.firestore.test.ts` es emulador real (round-trip Admin) con `vi.waitFor` (eliminó el `setTimeout` flaky) y verifica orden desc real.

---

## Hallazgos individuales

### 🟡 `usdzExporter.test.ts:91-149` — opciones probadas sin verificar su efecto

Cinco tests del bloque `§D.2` ejercitan opciones (`quadSize`, `colorGamma`, `useUnlitMaterial`) pero **solo aseveran que el blob exporta válido** (`blob.type === 'model/vnd.usdz+zip'`, `sizeBytes > 0`, mismos `triangleCount`/`vertexCount`). Ninguno comprueba que la opción cambie el output:
- `:91-102` ("respeta el quadSize custom") admite explícitamente en el comentario *"El test verifica que ambas exporten OK, no diferencia de bytes"* — i.e. una impl que **ignore por completo** `quadSize` pasaría.
- `:106-114` (`colorGamma=1` = identity) compara `a` vs `b` por counts iguales — trivialmente verdadero, no prueba la rama gamma.
- `:116-129` (`gamma < 1` / `gamma > 1`) y `:131-138` (`useUnlitMaterial`) solo confirman "genera USDZ válido".

Riesgo: si el exporter dejara de aplicar gamma o el material unlit (regresión visual), toda esta sección sigue en verde. Cobertura ilusoria sobre las features que dice cubrir. (El resto del archivo — empty-cloud throw `:49-60`, MIME `:62-68`, tri/vert counts `:70-82` — sí es real.)

### 🔵 `controlFailureLibrary.test.ts:91-95` — assert trivial bajo nombre engañoso

El test `'preserva orden de inserción'` solo aseveran `expect(Array.isArray(actions)).toBe(true)`. El nombre promete verificar el orden (que el comentario justifica como "order matters for UI"), pero no compara contra ninguna secuencia esperada. Una impl que devuelva las acciones desordenadas pasa. Trivial; debería comparar `actions` contra el orden de inserción concreto del fixture.

### 🔵 `incidentReadModel.test.ts:125-128` — nombre promete orden, assert solo cuenta

`'listAll desc por occurredAt'` aseveran únicamente `expect(all).toHaveLength(3)`. No verifica el orden descendente que el título declara. (Otros tests del mismo archivo — `listBySeverity`, `countsBySeverity` `:182-188` — sí son específicos, así que el riesgo real es bajo, pero el assert no cumple su nombre.)

### 🔵 `gaussianSplatFirestoreAdapter.test.ts:30-37` — `listRecent desc` solo chequea el primero

`expect(list[0].id).toBe('new')` con 2 elementos: confirma que el más reciente va primero, pero no que `list[1]` sea el viejo (con 2 elementos basta, pero queda frágil si el orden interno colapsa a un único bucket). Menor; aceptable.

### 🔵 `ds67Service.country.test.ts:142-153` — regex de adapters sugeridos no incluye todos los tokens del comentario

El comentario (`:142`) dice "cita OSHA / EU-OSHA / RIDDOR / STPS / CIPA" pero el regex (`:152`) es `/OSHA|EU-OSHA|RIDDOR|NR-5|STPS/` (sin CIPA, con NR-5 extra). El `join(' ')` + alternancia hace el assert laxo (basta 1 match). No es falso-verde porque sí prueba que la lista no está vacía y cita ≥1 marco extranjero; solo es menos estricto de lo que el comentario implica.

### 🔵 `consistencyStateBuilder.test.ts:37` — `Math.random()` en test (excepción permitida)

Usa `Math.random()` para IDs de docs sintéticos. Es un archivo de test → excepción explícita a la directiva #15 del CLAUDE.md. Sin acción. (El mock de `../firebase` es legítimo: reimplementa `collection/query/getDocs` con snapshots controlados, no over-mock.)

---

## Archivos sin hallazgos (49/55) — comportamiento real verificado

Todos los siguientes ejercitan lógica real con asserts sobre el resultado, casos borde y (donde aplica) `now` inyectado para determinismo:

`registry.test.ts` · `ds67Service.test.ts` · `ds67Service.xpHook.test.ts` · `ds76Service.country.test.ts` · `ds76Service.test.ts` · `ds76Service.xpHook.test.ts` · `ley19628.test.ts` (cross-tenant leak guard real, `:189-235`) · `normativeAuditLog.test.ts` (hash chain + tamper detection real, `:120-137`) · `trafficLightEngine.test.ts` · `confidentialReportsFirestoreAdapter.test.ts` · `confidentialReportsService.test.ts` · `karinReportingEngine.test.ts` · `consistencyAuditor.test.ts` · `consultativeSalePlaybook.test.ts` · `contingencySimulation.test.ts` (boundary 70% pass + reactionTime clamp) · `continuityPlanning.test.ts` · `contractorKpiService.test.ts` (TRIR formula real) · `controlComparator.test.ts` · `correctiveActionsCenter.test.ts` · `correctiveActionsFirestoreAdapter.test.ts` · `weakActionDetector.test.ts` · `preventionCostCalculator.test.ts` · `cphsMinuteAutogenerator.test.ts` (undefined≠0 score, `:174-209`) · `cphsService.test.ts` (quórum DS54 + immutable minutes) · `cphsService.xpHook.test.ts` (fire-and-forget swallow, `:125-145`) · `incidentCommands.test.ts` (CQRS invariants + tenant mismatch) · `incidentReadModel.test.ts` · `controlRobustness.test.ts` · `controlValidationsStore.firestore.test.ts` (emulador real) · `criticalControlsLibrary.test.ts` · `criticalRolesMap.test.ts` (busFactor/fragile) · `safetyCulturePulse.test.ts` · `claims.test.ts` (token-never-persisted) · `historyAggregator.test.ts` (durationMin defensive parsing) · `refereeTokens.test.ts` (vector sha256 conocido) · `dataConfidencePanel.test.ts` (NaN guards) · `incompletenessScanner.test.ts` · `deaFirestoreAdapter.test.ts` (tenant isolation) · `deaService.test.ts` (fail-closed en fecha inválida, `:78-82`) · `recordDeduplicator.test.ts` · `gaussianSplatRegistry.test.ts` · `objectLifecycleOrchestrator.test.ts` (citas normativas reales + rrule) · `normativaRules.test.ts` · `midasDepthEstimator.test.ts` (NCHW layout numérico real) · `pointCloudBuilder.test.ts` · `mockAdapter.test.ts` · `placedObjectsStore.test.ts` (wire-up pero verifica path/merge/strip-undefined/error path — aceptable para wrapper delgado) · `documentHygieneEngine.test.ts` · `documentVersioning.test.ts` (semver + immutability) · `documentVersioningFirestoreAdapter.test.ts` (immutability violations).

---

## Resumen (TL;DR)

Lote #15 es **~89% servicios de función pura + adapters con `fakeFirestore` legítimo**, calidad alta y opuesta al falso-verde sistémico del lote #12: ejercitan comportamiento real, casos borde, `now` inyectado, invariantes de inmutabilidad/firma y aislamiento cross-tenant; varios son ejemplares (vector sha256 conocido en `refereeTokens`, token-nunca-persistido en `claims`, defense-in-depth post-throw en `ds67/ds76.country`, boundary 25 m + distancia 3D en `normativaRules`, emulador real en `controlValidationsStore.firestore`). **Cero 🔴.** Único cluster 🟡 relevante: `usdzExporter.test.ts:91-149` prueba `quadSize`/`colorGamma`/`useUnlitMaterial` sin aseverar que las opciones tengan efecto (solo "exporta válido + counts iguales"), admitiéndolo en su propio comentario — una regresión que ignore esas opciones pasaría en verde. Menores 🔵: asserts cuyo nombre promete orden pero solo cuentan (`controlFailureLibrary:91`, `incidentReadModel:125`, `gaussianSplatFirestoreAdapter:30`) y regex laxa de adapters en `ds67Service.country:152`. `Math.random()` en `consistencyStateBuilder.test.ts:37` es excepción permitida (test file). Recomendación: en `usdzExporter` aseverar un efecto observable de cada opción (p.ej. posiciones de vértice distintas con `quadSize` distinto, o color del material gamma-corregido) y convertir los asserts de "orden" a comparaciones de secuencia explícitas.
