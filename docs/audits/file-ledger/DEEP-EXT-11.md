# DEEP-EXT-11 — Auditoría EXHAUSTIVA de TESTS (Lote #11)

**Atestación: 55/55 tests leídos línea por línea.**

Deriva: `ledger.json` filtrado `category === "I-TEST"`, ordenado por `path`,
slice `[550:605]` (`culturePulse.test.ts` … `multiRoleSummary.test.ts`).
Total I-TEST en ledger: 1247.

Foco: falsos-verdes y tests débiles — rules-tests con Admin SDK / `if(!testEnv)
return` silent-pass, datos sintéticos que setean el campo del gate, asserts
sobre campo/valor equivocado, over-mocking, "ID crypto contract" tautológico,
reimplementación-disfrazada (`buildApp` re-implementa el handler), "wire-up
contract" (solo refleja el `.stack` sin ejercitar el handler), `validate→next`
sin 400, asserts triviales/vacíos, skip/todo/fixme/`it()` vacío, snapshot-only,
y tests que pasarían con una impl incorrecta.

Severidades: 🔴 grave (falso-verde / cobertura engañosa de invariante de
seguridad) · 🟡 débil (cobertura parcial o tautológica que infla la señal) ·
🔵 nota menor.

---

## Hallazgo sistémico #1 — "wire-up contract" tests (38 de 55) 🟡

La gran mayoría del lote son tests de "router wire-up": importan el `Router`
de Express, leen su `.stack` por reflexión, y **solo** afirman que (a) el
export es una función y (b) cada `(path, method)` esperado está registrado.
**Nunca** ejercitan el handler, ni `verifyAuth`, `assertProjectMember`,
validación Zod / 400, tier-gating, ni el cuerpo de la respuesta.

Por qué es débil: el test pasa aunque el handler omita `verifyAuth`, fugue
datos cross-tenant, no escriba `audit_logs`, devuelva 500 o produzca el
resultado equivocado. Es una aserción tautológica sobre la tabla de rutas
(reflexión del propio objeto bajo prueba), equivalente a "el archivo importa
sin tirar + tiene los nombres correctos". Se rotulan honestamente como
"(wire-up contract)" → 🟡, no 🔴; el riesgo es inflar el conteo y dar falsa
confianza de cobertura.

## Hallazgo sistémico #2 — "reimplementación-disfrazada" (4 de 55) 🔴

`evacuationHeadcount`, `hazmatInventory`, `externalAuditPortal`, `iot` declaran
ser "behavioural contract" / "supertest harness", pero el handler completo
(`verifyAuth`, guard de membresía, resolución de tenant, 401/403/404/409,
forzado de identidad desde el token) está **re-escrito dentro del test**
(`buildApp` / `buildHazmatApp` / `buildIotApp`). El `*Router` real se importa
pero **nunca se invoca**; lo que se ejercita es la copia del test. El handler
de producción puede estar totalmente roto y estos tests pasan en verde. Esto
es peor que el wire-up: afirma cubrir comportamiento (incluyendo invariantes
de seguridad como tenant-isolation y anti-ghost-scan) que en realidad NO toca.

## Hallazgo sistémico #3 — proxy "≥4 middleware" como prueba de auth 🟡

`equipmentQr`, `horometro`, `industryRules`, `incidentFlow` afirman en el
nombre del test que la ruta "está protegida por verifyAuth → idempotencyKey →
validate" pero solo asertan `route.stack.length >= 4` (o `>=2`). Cuatro
funciones middleware cualesquiera satisfacen el assert; no se verifica la
**identidad** de los middleware. Contraste: `legalObligations` SÍ inspecciona
los nombres (`verifyAuth`, `idempotencyKeyMiddleware`) — patrón correcto para
este estilo.

---

## Tabla de hallazgos

| Test:línea | Módulo | Tipo | Por qué |
|---|---|---|---|
| evacuationHeadcount.test.ts:148-291,293-505 | evacuation headcount | 🔴 reimplementación-disfrazada | `buildApp` re-escribe verifyAuth+guard+tenant+404/409+`scannedByUid` forzado; el router real (import L24) nunca se invoca. La "behavioural contract" prueba la copia del test. |
| evacuationHeadcount.test.ts:362 | evacuation headcount | 🟡 soft-assert | `expect([400,403]).toContain(r.status)` acepta dos status para el caso project-sin-tenant; un handler con el orden de guards equivocado pasa igual. |
| hazmatInventory.test.ts:102-281,316-517 | hazmat inventory | 🔴 reimplementación-disfrazada | `buildHazmatApp` re-escribe todo el routing/auth/guard/409/404; monta `/api/sprint-k/...` (no la ruta real). Solo se ejercitan los engines puros (`auditStorageLocation`, `buildSpillPlan`); los handlers de `hazmatInventory.ts` nunca corren. |
| externalAuditPortal.test.ts:140-372,378-643 | external audit portal (SEGURIDAD) | 🔴 reimplementación-disfrazada | `buildApp` re-escribe los 5 handlers, incl. el endpoint público por token. La query `collectionGroup()` real se **emula** (L112-128) — el camino crítico de seguridad (lookup token + tenant-isolation) jamás se ejecuta contra el código de producción. |
| iot.test.ts:41-96,98-155 | iot device register | 🔴 reimplementación-disfrazada | `buildIotApp` re-escribe verifyAuth + role-gate + persistencia + audit. Solo importa `IOT_DEVICE_TYPES` y `isAdminRole/isSupervisorRole`; el role-gate "probado" es la copia del test, no el handler real. |
| equipmentQr.test.ts:42-69 | equipment QR | 🟡 proxy middleware | "protegidos por idempotencyKey (3 middleware)" solo asserta `stack.length >= 4`; no verifica identidad de middleware. |
| equipmentQr.test.ts:11-40,71-95 | equipment QR | 🟡 wire-up | resto del archivo: reflexión de `.stack`; sin ejercicio de handler. (first-match-wins L79 es lo único de valor real). |
| horometro.test.ts:50-74 | horómetro | 🟡 proxy middleware | "guarded by verifyAuth + idempotencyKey + validate" → solo `stack.length >= 4`; falso por construcción. |
| horometro.test.ts:13-48,76-110 | horómetro | 🟡 wire-up | resto: reflexión de `.stack`; sin handler. |
| industryRules.test.ts:93-103 | industry rules | 🟡 proxy middleware | "protected by verifyAuth → idempotencyKey → validate" → solo `stack.length >= 4`. |
| industryRules.test.ts:36-91 | industry rules | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| incidentFlow.test.ts:112-126 | incident flow (PDCA) | 🟡 proxy middleware falso | "uses verifyAuth on every endpoint" admite no poder introspectar identidad y asserta `stack.length >= 2`; pasaría aunque NINGÚN endpoint tuviera verifyAuth. |
| incidentFlow.test.ts:31-110 | incident flow | 🟡 wire-up | resto: reflexión de `.stack`; sin handler. |
| legalObligations.test.ts:98-108 | legal obligations | 🟡 snapshot-de-prosa | `readFileSync(legalObligations.ts)` + regex sobre comentarios ("NUNCA hace push automático", "SUSESO", "MINSAL"); prueba comentarios, no el invariante no-push. El código podría pushear y el comentario seguir presente. |
| legalObligations.test.ts:34-95 | legal obligations | 🔵 wire-up (decente) | inspecciona nombres de middleware (`verifyAuth`, `idempotencyKeyMiddleware`) — mejor que el resto, pero aún sin ejercitar handler (sin 200/400/403). |
| culturePulse.test.ts:6-26 | culture pulse | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| dataConfidence.test.ts:4-39 | data confidence | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| dataQuality.test.ts:6-22 | data quality | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| deduplication.test.ts:15-27 | deduplication | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| documentVersioning.test.ts:6-71 | document versioning | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| drillsManager.test.ts:6-26 | drills manager | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| driving.test.ts:15-31 | driving | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| drivingSafety.test.ts:6-28 | driving safety | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| efficacyVerification.test.ts:15-27 | efficacy verification | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| emergencyBrigade.test.ts:6-26 | emergency brigade (SOS) | 🟡 wire-up | módulo de emergencia; sin embargo solo reflexión de `.stack`, cero comportamiento. |
| engineeringControls.test.ts:6-25 | engineering controls | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| eppFlow.test.ts:21-67 | EPP flow | 🟡 wire-up | reflexión de `.stack` (+ conteo de paths); sin handler ni firma de orden. |
| equipment.test.ts:6-22 | equipment master | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| ergonomics.test.ts:15-27 | ergonomics | 🟡 wire-up | reflexión de `.stack`; calc engine REBA/RULA testeado en otro lado pero el handler no. |
| escalation.test.ts:15-33 | escalation | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| evacuation.test.ts:15-32 | evacuation | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| eventReplay.test.ts:15-31 | event replay (audit) | 🟡 wire-up | reflexión de `.stack`; export-trail / diff sin comportamiento probado. |
| exceptions.test.ts:15-34 | exceptions | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| expirations.test.ts:15-27 | expirations | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| explainability.test.ts:6-34 | explainability | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| expressBundle.test.ts:15-23 | express bundle | 🟡 wire-up | reflexión de `.stack`; un solo path, sin handler. |
| fatigue.test.ts:15-23 | fatigue | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| firstResponderMap.test.ts:15-27 | first responder map | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| fiveS.test.ts:15-31 | 5S | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| formBuilderAdvanced.test.ts:15-47 | form builder | 🟡 wire-up | reflexión de `.stack`; topo-sort/circular-deps sin comportamiento probado. |
| geofencePermissions.test.ts:15-23 | geofence permissions | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| hygiene.test.ts:15-27 | hygiene (BMR) | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| inbox.test.ts:6-21 | inbox prevencionista | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| incidentBundle.test.ts:6-22 | incident bundle | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| incidentTrends.test.ts:11-28 | incident trends | 🟡 wire-up | reflexión de `.stack`; el comentario L4-7 admite que el handler no se ejercita ("port pendiente"). CLAUDE.md #19 marca incidentTrends.ts para auditoría de runTransaction — no cubierto. |
| jsa.test.ts:15-31 | JSA | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| knowledgeBase.test.ts:6-26 | knowledge base | 🟡 wire-up | reflexión de `.stack`; CLAUDE.md #19 marca knowledgeBase.ts para runTransaction — no cubierto. |
| leadership.test.ts:6-25 | leadership | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| lessonsLearned.test.ts:6-28 | lessons learned | 🟡 wire-up | reflexión de `.stack` (GET+POST mismo path); sin handler. |
| loneWorker.test.ts:15-49 | lone worker (SOS) | 🟡 wire-up | módulo crítico de trabajador solitario / escalation; solo reflexión, cero comportamiento de check-in/escalación. |
| loto.test.ts:6-20 | LOTO | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| maturity.test.ts:6-21 | maturity index | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| medicalCatalogs.test.ts:15-30 | medical catalogs (ADR 0012) | 🟡 wire-up | reflexión de `.stack`; endpoints de búsqueda de diagnósticos/fármacos, pero ningún test del guard de no-diagnóstico ni `MedicalDisclaimer`. |
| meetingPack.test.ts:15-31 | meeting pack | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| mentalLoad.test.ts:15-27 | mental load | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| microtraining.test.ts:6-58 | microtraining | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| multiProject.test.ts:15-31 | multi-project | 🟡 wire-up | reflexión de `.stack`; sin handler. |
| multiRoleSummary.test.ts:6-47 | multi-role summary | 🟡 wire-up | reflexión de `.stack`; sin handler. |

---

## Sólidos (tests reales, no falsos-verdes)

| Test | Módulo | Por qué cuenta como real |
|---|---|---|
| healthDeep.test.ts | health deep check | Importa el `runDeepHealth`/`withTimeout` reales (L17-22); prueba timeout cap 2s, ejecución paralela, propagación de error no-timeout, probe skipped, y ausencia de unhandledRejection. Comportamiento genuino. |
| healthVault.test.ts | health vault (PII médico) | Monta el `healthVaultRouter` real (L130-135); mockea solo firebase-admin/verifyAuth en el borde. Ejercita handlers reales: 201 share, 410 expired/revoked, 401 bad-secret, 404, y escritura de `audit_logs`. |
| medicalAptitude.test.ts | medical aptitude cert | Monta el `medicalAptitudeRouter` real (L36-42); mockea solo borde. Prueba 200 (cert+hash+pdf), role-gate worker→403, Zod→400, y la directiva fundador `pushedToMutual:false` en el handler real. |

**Sólidos: 3/55.**

---

## Conteo del lote

| Categoría | Conteo |
|---|---|
| Archivos totales auditados | 55 |
| 🔴 reimplementación-disfrazada (falso-verde de comportamiento/seguridad) | 4 (evacuationHeadcount, hazmatInventory, externalAuditPortal, iot) |
| 🟡 wire-up puro (reflexión `.stack`) | 38 |
| 🟡 proxy "≥N middleware" sin verificar identidad | 4 (equipmentQr, horometro, industryRules, incidentFlow) — solapan con wire-up |
| 🟡 snapshot-de-prosa (regex sobre comentarios del .ts) | 1 (legalObligations) |
| 🟡 soft-assert (`toContain([400,403])`) | 1 (evacuationHeadcount) |
| 🔵 wire-up decente (inspecciona nombres de middleware) | 1 (legalObligations base) |
| ✅ Sólidos (handler real ejercitado) | 3 (healthDeep, healthVault, medicalAptitude) |
| skip/todo/fixme/only/`it()` vacío | 0 |

Nota: los conteos se solapan (un archivo wire-up también puede tener un proxy
de middleware). Conteo único por archivo: **48 wire-up/proxy + 4
reimplementación + 3 sólidos = 55**.

---

## Recomendaciones priorizadas

1. 🔴 **Las 4 reimplementación-disfrazada** (`externalAuditPortal` primero —
   es portal público de auditor con tenant-isolation): reemplazar `buildApp`
   por montaje del router real con firebase-admin mockeado al borde (patrón
   `healthVault.test.ts`). Hoy el camino de seguridad de producción no se
   ejecuta.
2. 🟡 **Reemplazar el proxy `stack.length >= N`** por inspección de nombres de
   middleware (patrón `legalObligations`) en equipmentQr/horometro/
   industryRules/incidentFlow, o mejor: una prueba 401-sin-token contra el
   router montado.
3. 🟡 **legalObligations**: añadir una prueba de comportamiento que verifique
   que el endpoint NO emite ninguna llamada de red/push (espía sobre el
   cliente saliente), en vez de grep sobre el comentario.
4. 🟡 **medicalCatalogs / loneWorker / emergencyBrigade / eventReplay**:
   priorizar tests de comportamiento — son módulos de seguridad (ADR 0012,
   SOS, audit trail) cuyo wire-up no protege ningún invariante.
5. 🟡 Auditar `runTransaction` (CLAUDE.md #19) en incidentTrends.ts y
   knowledgeBase.ts — sus tests son wire-up y no cubren read-modify-write.
