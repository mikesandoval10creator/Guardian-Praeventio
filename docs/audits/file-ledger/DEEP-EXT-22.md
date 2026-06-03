# DEEP-EXT-22 — Auditoría exhaustiva de tests (Lote #22)

**Alcance:** `ledger.json` filtrado por `category === "I-TEST"`, ordenado por `path`,
slice `[1155:1210]` → 55 archivos (índices 1155–1209).
**Método:** lectura línea por línea de cada test; verificación cruzada contra la
implementación cuando una aserción olía a falso-verde.
**Veredicto global:** salud **alta**. La gran mayoría son tests deterministas de
funciones puras con fixtures honestas, fakes in-memory que respetan el contrato y
aserciones específicas. Se detectó **1 falso-verde real** (🟡), varios casos de
baja-cobertura/título-engañoso (🔵) y un par de notas menores.

Leyenda: 🔴 crítico (falso-verde que oculta bug) · 🟡 medio (aserción
débil/engañosa, riesgo de pasar con impl incorrecta) · 🔵 bajo (cobertura fina,
tautología inocua, nota de higiene).

---

## Hallazgos

### 🟡 `src/services/zettelkasten/bernoulli/mistingDustSuppression.test.ts:15-24`
**Módulo:** zettelkasten/bernoulli (supresión de polvo, DS 594 Art. 65).
**Tipo:** título engañoso + aserción tautológica / weakened-assert.
El test se titula `returns null with adequate air supply and ΔP=0` pero el propio
comentario del cuerpo (líneas 21-22) admite que con `deltaPPa: 0` el nodo **NO** es
null: `Q=0 → throatVelocity=0 → dropletSizeM=Infinity → dropletOk=false → node
emitted`. La aserción se debilitó a
`expect(node === null || node?.metadata.requiredAirFlowM3S === 0).toBe(true)`.
Verificado contra `mistingDustSuppression.ts:44-62`: cuando `deltaPPa === 0`,
`venturiFlowRate(...) → requiredAirFlow = 0` **siempre**, por lo que la segunda
rama del `||` es **incondicionalmente verdadera** y la primera nunca se evalúa de
forma significativa. El test pasaría aunque la lógica de `airOk`/`dropletOk`
estuviera completamente rota. Es el único caso "null" de este engine, así que la
rama de no-emisión queda **sin cobertura efectiva**. Arreglo: construir un caso con
`deltaPPa > 0`, `availableFlowM3S` holgado y velocidad de garganta suficiente para
`dropletOk === true`, y aseverar `expect(node).toBeNull()` sin disyunción.

### 🔵 `src/services/systemEngine/__tests__/eventTypes.test.ts:42-53`
**Módulo:** systemEngine/eventTypes (zod discriminated schema).
**Tipo:** test que puede pasar por la razón equivocada.
El caso "rejects events with payload that does not match the discriminator" arma un
evento que además omite `tenantId` (campo de envelope requerido). El `safeParse`
fallaría por el envelope incompleto aunque el discriminador de payload no validara
nada. Para aislar la intención, el fixture debería incluir un envelope completo y
mutar únicamente el payload.

### 🔵 `src/services/telemetry/eventCollector.test.ts:226-238`
**Módulo:** telemetry/eventCollector.
**Tipo:** título no respaldado por el cuerpo (self-admitted).
Titulado "silently skips a source whose collection query throws", pero el comentario
inline reconoce que el stub in-memory **nunca lanza** y la aserción solo confirma
`events === []` con DB vacía. No prueba el path de catch/skip-on-throw. Sustituir por
un stub cuyo `.get()` rechace para una colección concreta y verificar que las demás
fuentes sí se proyectan.

### 🔵 `src/services/zettelkasten/bernoulli/*` (12 archivos) — cobertura mínima 2-casos
**Archivos:** confinedSpaceHVAC, dikeHydrostaticMonitor, gasDispersionCloud,
gasLeakDetection, hazmatPipePressure, hidranteFireNetwork, microWindEnergy,
miningVenturi, pulmonaryAltitude, respiratorFatigue, scaffoldWindSuction,
slopeStabilityAfterRain, structuralWindLoad.
**Tipo:** baja cobertura (no falso-verde).
Cada uno se limita al patrón "1 caso emite nodo + 1 caso null", con inputs muy
alejados del umbral. Las físicas son reales y los inputs distinguen ambos caminos,
pero **no se prueban fronteras** (justo por encima/debajo del umbral), severidad
intermedia, ni validación de inputs inválidos. Un bug de off-by-one en el umbral o
en el cálculo de severidad pasaría desapercibido. Recomendado: añadir 1-2 casos de
borde por engine.

### 🔵 `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.test.ts:11`
**Módulo:** zettelkasten/bernoulli (SLAM/fotogrametría).
**Tipo:** stub-disfrazado pinneado.
`expect(node?.metadata.placeholder).toBe(true)` confirma que la implementación es un
**placeholder**. El test pin de la forma del stub es la conducta correcta según la
directiva #13 (anti-stub-disfrazado), pero conviene verificar que esta feature esté
gateada/registrada en `docs/stubs-inventory.md` y oculta al usuario final. Solo nota
de trazabilidad, no defecto de test.

### 🔵 `src/services/zettelkasten/contextualActions.test.ts:112-118`
**Módulo:** zettelkasten/contextualActions.
**Tipo:** aserción potencialmente vacua.
`filterActionsByCategory(..., ['create']).every(a => a.category === 'create')` pasa
vacuamente si el filtrado devuelve `[]`. Añadir `expect(filtered.length).
toBeGreaterThan(0)` para evitar el verde por lista vacía.

### 🔵 `src/services/visitors/visitorAccessService.test.ts:35`
**Módulo:** visitors/visitorAccessService.
**Tipo:** aserción frágil (no falso-verde).
`expect(new Date(p.expiresAt).getUTCMinutes()).toBe(30)` pasa solo porque la base es
`08:00:00Z` (0 min) + TTL 30. Si la base tuviera minutos ≠ 0 el cálculo correcto
fallaría el assert. Mejor aseverar el delta `expiresAt - base === 30*60_000`.

---

## Archivos revisados sin observaciones (sólidos)

syncStatus/syncQueueTracker · systemEngine/decisionEngine · systemEngine/executor ·
systemEngine/policies-registry · policies/geofenceToSos ·
policies/tierChangeReactivity · systemEngine/zettelkasten-healthEvent ·
telemetry/aggregator · upsell/painBasedUpsellSuggester · uxModes/uxModeAdapter ·
vendorOnboarding/vendorAccreditationTracker · vendorOnboarding/vendorOnboardingFlow ·
visitorControl/visitorRegistry · visitors/visitorFirestoreAdapter ·
vulnerability/operationalVulnerabilityMap · vulnerability/vulnerabilityFirestoreAdapter ·
workPermits/criticalPermitValidators · workPermits/excavationPermitExtension ·
workPermits/liftingPermitExtension · workPermits/permitLifecycleAdvisor ·
workPermits/workPermitEngine · workPermits/workPermitFirestoreAdapter ·
workerHistory/portableHistoryExporter · workerReadiness/readinessScore ·
zettelkasten/backlinks · zettelkasten/canonical/materializer ·
zettelkasten/centrality · zettelkasten/climateRiskCoupling.eonet ·
zettelkasten/climateRiskCoupling · zettelkasten/edges · families/registries ·
flows/eppInventoryPurchaseFlow · flows/horometroMaintenanceFlow ·
flows/incidentLessonTrainingFlow · zettelkasten/incidentPostmortem ·
persistence/writeNode.

**Notas positivas destacables:**
- `portableHistoryExporter` y `incidentLessonTrainingFlow` cubren explícitamente
  ADR 0012 (medical redaction, severidad `info` no-punitiva) con aserciones reales.
- `eppInventoryPurchaseFlow` / `horometroMaintenanceFlow` verifican conteos exactos
  de nodos/aristas, idempotencia y paths offline (queued) — fakes que respetan el
  contrato, sin over-mocking del SUT.
- `incidentPostmortem` y `writeNode` ejercitan rutas de error (embedding falla,
  rag throws, store falla, offline) con aserciones de `reason`/`captureError`.
- `edges`/`centrality`/`backlinks` usan stores in-memory que reimplementan el
  *contrato* (no la lógica del SUT), con aislamiento de tenant y bidireccionalidad
  comprobados.

---

## Resumen

De 55 tests del lote #22, la salud es alta: **1 falso-verde real** (🟡
`mistingDustSuppression` — caso "returns null" mal etiquetado con assert tautológico
que pasa aunque el engine esté roto; única rama de no-emisión sin cobertura efectiva)
y **6 hallazgos 🔵 menores**: dos tests con título no respaldado por el cuerpo
(`eventTypes` discriminador que también falla por envelope; `eventCollector`
"skips on throw" que nunca lanza), una aserción potencialmente vacua
(`contextualActions` filter), una frágil (`visitorAccessService` minutos), y la nota
de cobertura mínima 2-casos en los **13 engines bernoulli** (físicas reales pero sin
pruebas de frontera/severidad). El stub pinneado de `slamPhotogrammetryNode` es
conducta correcta (directiva #13) pero requiere verificar su registro en
`stubs-inventory.md`. No se encontraron rules-tests con Admin SDK, IDs cripto
tautológicos, reimplementación-disfrazada, wire-up-only, validate→next sin 400,
ni skip/todo/it()-vacío en este lote.
