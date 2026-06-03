# DEEP-EXT-09 — Auditoría exhaustiva de tests (Lote #9)

**Deriva:** `ledger.json` → `category === "I-TEST"`, orden por `path`, slice `[440:495]`.
**Total I-TEST en ledger:** 1247. **Slice leído:** 55 archivos (índices 440–494).
**Modo:** lectura línea por línea, caza de falsos-verdes / tests débiles.

## Atestación 55/55

Los 55 archivos del slice fueron leídos completos. Composición del lote:

- **38 page-wrapper tests** (`@vitest-environment jsdom`): patrón dominante y
  sano — mockean `react-i18next` (fallback) + `ProjectContext`/`useOnlineStatus`
  + el hook de datos, y verifican empty/loading/error/render/interacción vía
  `data-testid`. Muchos consumen el **servicio/motor de dominio real** por
  fixtures tipados y aseveran cómputos reales (scores LeadershipDecisions 25/30,
  agregación IncidentTrends 14/7/3, ROI determinístico PricingCalculator,
  redacción RUT/consent en WorkerPortableHistory).
- **5 tests de helpers puros** (`LightPollutionAudit`, `PoolGame`, `SunTracker`,
  `RiskNetwork`, parte de `webauthnAssertion`): boundary tests reales con
  clamping y casos límite. Modelo a seguir.
- **4 rules-tests** (`@firebase/rules-unit-testing` contra emulador).
- **11 server jobs** (DI con fake-Firestore tipado, sin tocar Admin SDK real).

**Patrón anti-fake destacado:** `MountainRefuges.test.tsx` valida contra el
catálogo canónico real (`MOUNTAIN_REFUGES_CHILE`), prueba orden Haversine y
región por coordenadas, y verifica explícitamente que NO existan los IDs
ficticios "alfa/beta/gamma" del audit previo. `WorkPermits`/`EngineeringControls`
asertan **propiedades negativas** (`not.toHaveProperty('verifierUid')`,
`not.toHaveProperty('approverUid'|'preconditions')`) — pinean que el cliente NO
filtra identidad/autoridad que el server debe derivar.

**Rules-tests — seedeo correcto, sin Admin-SDK-bypass del SUT.** Los 4 usan
`withSecurityRulesDisabled` **solo para sembrar** datos y `authenticatedContext`
para las aserciones reales (patrón correcto). `dirtyDozen`, `firestore.rules` y
`tenantScoped` **fallan/skip explícitamente** si el emulador no arranca
(`maybeSkip` lanza o `ctx.skip()`), por lo que no pueden pasar como falso-verde
cuando el emulador está caído.

No se hallaron: "ID crypto contract" tautológico, reimplementación-disfrazada de
handlers, `validate` mockeado a `next()` sin 400, snapshot-only, `it()` vacío,
skip/todo/fixme ocultos, ni falsos-verdes graves (🔴 = 0).

## Hallazgos (débiles / falsos-verdes parciales)

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| 🟡 `projectScopedStores.rules.test.ts:127-243` (todo el suite) | firestore.rules (14 stores Sprint-K) | Silent-pass en emulador caído | A diferencia de los otros 3 rules-suites (que LANZAN en `maybeSkip`), este usa `if (!testEnv) return;` en CADA test. Con el emulador inalcanzable, las ~50 aserciones retornan temprano sin ejecutar nada y el suite pasa **verde sin cobertura**. El test "skips when the emulator is unavailable" (l.127) solo `console.warn`, nunca asserta. Cuando el emulador SÍ está, las aserciones son correctas; el riesgo es enmascarar pérdida de cobertura en hosts CI sin emulador. |
| 🟡 `runConsistencyAudit.test.ts:149-157` (`respeta maxProjects cap`) | runConsistencyAuditCron | Assert no-verificante (mislabel) | El comentario admite que `FakeCollection.limit` no es enforcing; la única aserción es `expect(r.projectsScanned).toBeGreaterThan(0)`. El nombre promete verificar el cap=2 pero el cuerpo no puede — escanearía los 5 proyectos y pasaría igual. El cap nunca se prueba. |
| 🟡 `PublicDemo.test.tsx:46-57` (`gas...recomputes when wind input changes`) | PublicDemo | Assert trivial (mislabel) | Tras `change(wind,'40')` solo asserta `wind.value==='40'` (input wired) y `card.textContent` truthy. NO verifica recomputación alguna; el comentario lo admite ("did not throw"). Pasaría aunque el cálculo de dispersión estuviera roto. (El test de country-selector del mismo archivo sí es firme.) |
| 🔵 `OfflineInspection.test.tsx:482` (`rekeyObservation`) | OfflineInspection | Tautología por mock constante | `randomId` está mockeado a `'rid_fixed'` constante, así que `rekeyObservationSpy` se asevera con `('rid_fixed','rid_fixed')` — old==new key tautológicamente; no puede distinguir re-key real. Esperable dado el mock determinista; el resto del flujo 409→retry sí es firme. |
| 🔵 `DrivingSafety.test.tsx:281-284` (`license vencida`) | DrivingSafety | Acoplamiento a fecha del entorno | El assert `vencida` para `licenseExpiresAt:'2025-01-01'` depende de la fecha actual del runner (currentDate 2026). Es real pero frágil si se congelara el reloj a <2025. |
| 🔵 `tenantScoped.test.ts:169-185` (nombre del `it`) | firestore.rules tenants | Nombre engañoso | El título dice "reads tenants/B" pero el cuerpo asevera que la **sub-ruta `supervisor_only` FALLA** (y la lectura base pasa). El cuerpo es correcto; solo el nombre confunde. |

## Notas que NO son hallazgos (aclaraciones)

- `webauthnAssertion.test.ts` — solo cubre Layer-0 (shape/malformed) con
  aserciones de `reason` exactas; la verificación crypto end-to-end se delega
  (documentado) a `__tests__/server/webauthnVerify.test.ts`. División legítima,
  no stub-disfrazado.
- `consolidateZettelkasten.test.ts` — el **default dry-run** que no escribe nada
  (l.49-58) es un buen safety-default pineado, no un test vacío.
- `runResilienceHealthAlert.test.ts:232` vs `runLoneWorkerEscalation`/
  `runLegalCalendarReminders` — políticas OPUESTAS de "notify-fail" pineadas
  correctamente cada una: alertas ops marcan idempotency aun si falla el FCM;
  jobs life-critical/regulatorios NO marcan (permiten retry). Intencional.
- `RiskNetwork.test.ts` — extracción funcional-core (`resolveSelectedNodeIdFromSearch`)
  con justificación documentada (sin jsdom/RTL en ese entorno node); casos límite
  exhaustivos (whitespace, empty-set, case-sensitive, extra params). Modelo.

## Conteo

- **Sólidos:** 49 / 55
- **Débiles (🟡, silent-pass / assert no-verificante / trivial-mislabel):** 3
- **Observaciones menores (🔵, tautología-por-mock, acoplamiento, nombre):** 3
- **Falsos-verdes graves (🔴):** 0
- **Skip/todo/empty/snapshot-only/reimplementación/Admin-SDK-bypass del SUT:** 0
