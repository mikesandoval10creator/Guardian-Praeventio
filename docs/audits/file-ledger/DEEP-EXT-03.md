# DEEP-EXT-03 — Auditoría EXHAUSTIVA de TESTS (Lote #3)

**Alcance:** `ledger.json` filtrado `category==="I-TEST"`, ordenado por `path`, slice `[110:165]`.
**Total I-TEST en ledger:** 1247. **Archivos en este lote:** 55 (índices 110–164).
**Método:** lectura línea-por-línea de cada archivo. Caza de falsos-verdes, tests débiles, tautológicos, over-mocking, asserts triviales/skip, y "tests de una copia de la impl".

---

## Atestación

**He leído los 55 / 55 archivos del slice por completo, línea por línea.**

Veredicto global: el lote es de **calidad muy alta**. La inmensa mayoría son supertests de *router real* montados sobre el `fakeFirestore` compartido (`src/__tests__/helpers/fakeFirestore.ts`), que implementa de verdad `runTransaction`, `FieldValue.increment`, `arrayUnion/Remove` y `count()` (verificado). Cubren consistentemente: 401 sin token, 403 no-miembro (`assertProjectMember`/`ProjectMembershipError`), 404 tenant, 400 zod, 200/201 con asserts sobre valores computados, y — de forma destacable — **server-stamp anti-spoofing** (uid del token sobreescribe el del body) e **IDOR cross-project**. Matemática de dinero/scoring aseverada con valores exactos.

Hallazgos accionables: **3 archivos** con problemas reales (2 tautológicos 🟡 + 1 test-de-copia 🟡). El resto son ruido menor 🔵 dentro de archivos por lo demás sólidos.

---

## Tabla de hallazgos

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| `leadership.test.ts:16-27` | `src/server/routes/leadership.ts` (gen. de IDs `ld_<ts>_<uuid>`) | 🟡 Tautológico / self-referential | El test construye el ID **inline** con `randomUUID()` y asevera que matchea su propia regex. **No importa ni ejecuta** el código de producción. Pasaría idéntico aunque la ruta usara `Math.random()` o un contador. No verifica nada del sujeto. (El `.router.test.ts` hermano sí cubre la ruta real, pero este contrato de "ID crypto-seguro" no muerde ninguna mutación de prod.) |
| `projectClosure.test.ts:17-39` | `src/server/routes/projectClosure.ts` (IDs `cl_`/`cd_<ts>_<uuid>`) | 🟡 Tautológico / self-referential | Mismo anti-patrón exacto que `leadership.test.ts`: arma `cl_${Date.now()}_${randomUUID()}` y `cd_...` en el propio test y los compara con `CL_ID_RE`/`CD_ID_RE`. Cero acoplamiento al código de producción; el claim de "crypto-secure" es vacío — un downgrade a generador débil en la ruta no rompería este archivo. |
| `mercadoPagoIpn.test.ts:56-158` | `src/server/routes/billing.ts` (webhook MercadoPago IPN) | 🟡 Test de una COPIA de la impl (over-mock estructural) | El header admite "we cannot mount the real router here"; `buildApp()` **re-implementa a mano** todo el handler: `mapStatus`, precedencia OIDC>HMAC, gate de idempotencia (`processed_mp_ipn`), update de invoice a `paid`/`rejected`, audit row. Sólo las funciones de verificación de firma son reales. Un bug en la idempotencia o el mapeo de estado de `billing.ts` **NO** sería detectado: los tests validan la copia del test, no producción. (Las firmas HMAC/OIDC sí están bien probadas.) |
| `import.test.ts:67-133` | `src/server/routes/import.ts` | 🔵 Over-mock del servicio (aceptable) | Mockea el barrel completo `excelImporter` (`parseXlsx`/`validateRows`/`dedupe`) y un proxy recursivo de firebase-admin. Prueba sólo la fontanería de la ruta (status, audit, idempotencia); la lógica de parseo/dedup Excel queda sin cubrir aquí. Aceptable si hay tests unitarios del servicio aparte, pero el "happy path" no toca persistencia real. |
| `limiters.test.ts:142-155` | `src/server/middleware/limiters.ts` | 🔵 Assert sobre un espejo, no el sujeto | "falls back to a non-empty string…" reconstruye la cadena `uid \|\| ipKeyGenerator(ip) \|\| 'anonymous'` dentro del test y la asevera; no llama al keyGenerator real. (Mitigado: las pruebas de keyGenerator de prod sí existen en líneas 786-847 vía `prodUidOrIpKey`.) |
| `limiters.test.ts:656-702` | `src/server/middleware/limiters.ts` | 🔵 Asserts triviales documentales | `expect(15*60*1000).toBe(900_000)` y la tabla de `max` son tautologías aritméticas / espejos del `LIMITER_TABLE`. El propio comentario admite que sólo "documentan" valores. No muerden mutaciones del source (las del bloque de drenaje sí). |
| `leadership.test.ts:22-26` | (mismo) | 🔵 "two IDs differ" trivial | Genera dos UUIDs y verifica que difieren — propiedad de `randomUUID()` de Node, no del sujeto. |

---

## Conteo de tests SÓLIDOS

De los 55 archivos del lote:

- **52 archivos sólidos / fuertes** — supertests de router real sobre fakeFirestore (o impl real montada), con gates de auth/membership/tenant, validación zod, asserts sobre valores computados y, donde aplica, anti-spoofing de identidad e IDOR. Destacan por seguridad genuina: `invitations.router`, `projects.router`, `portableHistory` (Ley 19.628), `pinSign` (PBKDF2/HMAC real), `operationalChange`, `offlineInspections` (idempotencia transaccional 3-way), `legalObligations` (IDOR cross-project), `privacyRetention`, `preventionCost` (matemática CLP exacta), `oauthGoogle` (CSRF/state real).
- **1 archivo de calidad mixta** — `mercadoPagoIpn.test.ts`: fuerte en firmas, débil estructuralmente (impl copiada). 🟡
- **2 archivos tautológicos** — `leadership.test.ts`, `projectClosure.test.ts`: contratos de forma de ID self-referential. 🟡

Notas de cobertura genuina (no falsos-verdes, sólo contexto):
- `maintenance.test.ts` mockea todos los jobs cron pero prueba de verdad la orquestación/fault-isolation del router real (legítimo).
- `onboarding.test.ts` usa un FakeFirestore hand-rolled (con `Math.random()` para IDs, permitido en test) pero **monta el router real** → handler genuinamente ejercido.

---

## Severidad

- 🔴 Crítico: **0**
- 🟡 Medio (falso-verde o tautológico real): **3** (`leadership.test.ts`, `projectClosure.test.ts`, `mercadoPagoIpn.test.ts`)
- 🔵 Menor (asserts triviales/espejo dentro de archivos sólidos): **4 ocurrencias** (en `import.test.ts`, `limiters.test.ts` ×3)

## Recomendaciones

1. **`leadership.test.ts` + `projectClosure.test.ts`**: reemplazar el assert self-referential por uno que extraiga el ID de una respuesta del **router real** (ej. `POST .../decisions` → `res.body.decision.id` ya está disponible en `leadership.router.test.ts:311`) y validar su regex ahí. Así el contrato "crypto-secure" muerde una mutación real del generador.
2. **`mercadoPagoIpn.test.ts`**: migrar a montar `billingApiRouter` real (patrón `fakeFirestore` + mock de firebase-admin singleton como hace `import.test.ts`/`onboarding.test.ts`) para que la idempotencia y el mapeo de estado de `billing.ts` queden bajo prueba; conservar las pruebas OIDC/HMAC existentes.
3. **`limiters.test.ts:656-702` y `:142-155`**: eliminar los asserts-espejo (ya cubiertos por el bloque de drenaje conductual y por `prodUidOrIpKey`), o dejarlos sólo como comentario — actualmente inflan el conteo sin valor de detección.
