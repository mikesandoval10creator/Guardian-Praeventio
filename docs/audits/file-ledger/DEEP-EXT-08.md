# DEEP-EXT-08 — Auditoría exhaustiva de tests (Lote #8)

**Atestación:** 55 / 55 archivos I-TEST leídos línea por línea.
**Deriva:** `ledger.json` filtrado `category==="I-TEST"`, ordenado por `path`, slice `[385:440]`.
**Rango:** `components/workers/TraceabilityModal.test.tsx` … `pages/CustodyChain.test.tsx`.
**Fecha:** 2026-06-03. Doc-only (sin commit).

## Veredicto general

Lote de calidad media-alta, fuertemente dominado por tres familias muy sólidas:

1. **HTTP API clients** (`useEquipmentQr`, `useEvacuation`, `useEvacuationHeadcount`,
   `useExternalAuditPortal`, `useHazmatInventory`, `useLegalObligations`,
   `useShiftHandover`): patrón uniforme y honesto — verifican path/method/body/
   headers exactos, `Idempotency-Key` condicional, y las 4 ramas de traducción de
   error (`message > error > code > http_<status>` + body no-parseable). Mockean
   solo `apiAuthHeaders` + `fetch`, que es lo correcto para un cliente HTTP.
2. **Engines puros vía runner inyectable** (`runArPlacementConfirm`,
   `runObjectLifecycle`, `runInvoicePoll`, `registerTokenToServer`,
   `buildZonesGeometryHash`, `getFeaturesForPlan`, `resolveInitialLanguage`,
   `useTwinAccess` con `fakers`): DI limpia, asserts numéricos/de-contrato exactos,
   ramas de error y abort cubiertas. `useInvoicePolling` es ejemplar (backoff,
   timeout con fake timers, hydration grace one-shot, abort).
3. **Page wrappers Sprint K / Fase F** (`AnnualReview`, `Apprenticeship`,
   `ConfidentialReports`, `CorrectiveActions`, `CphsDraftMinute`, `CulturePulse`,
   `CustodyChain`): empty/loading/error + render con datos + mutación con args
   verificados. Varios con asserts de seguridad/privacidad load-bearing
   (`ConfidentialReports` anónimo→`reporterUid undefined`; `CulturePulse`
   gate de anonimato suprime agregados; retaliation panel no de-anonimiza).

Mock omnipresente: `react-i18next` passthrough (cosmético, aceptable). **No hay
rules-tests en este slice** (todos component/hook/unit) → N/A el patrón "Admin
SDK bypassa reglas". **0 `.skip/.todo/.fixme` activos. 0 snapshot-only.**

Los stubs de `useShiftHandover` (4 funciones que retornan shells sin fetch) están
pinneados correctamente per CLAUDE.md #13 y el test asserta `fetch not called` —
no es stub-disfrazado, es cobertura de placeholder declarada.

## Hallazgos (Test:línea | Módulo | Tipo | Por qué)

| Test:línea | Módulo-sujeto | Tipo | Por qué | Sev |
|---|---|---|---|---|
| `lib/e2eAuth.test.ts:199-218` | `lib/e2eAuth` (gate productivo §2.19) | Nombre/comentario vs assert opuesto — no-asserta-lo-que-afirma | `it('getE2EUser/hasE2EUserFixture chain is gated by isE2EMode')` se titula y comenta como verificación del gate de **producción**, pero el cuerpo admite en línea que no puede mockear el gate y termina aserrando lo **contrario**: `expect(_userIgnored?.uid).toBe('should-be-ignored')` (el fixture SÍ se lee bajo MODE=test). El gate productivo (MODE=production → null) nunca se ejercita; queda "verificable manualmente con build". El test pasa por construcción y no protege contra una regresión del gate. | 🟡 |
| `components/workers/TraceabilityModal.test.tsx:51-63` | `components/workers/TraceabilityModal` | Assert trivial/vacuo | "renders an empty-state when no related nodes exist" solo asserta `document.body.textContent).toBeTruthy()` — vacuo, pasa con cualquier render no vacío; no verifica que haya un empty-state ni su texto. Redimido parcialmente por los its hermanos (null→sin nombre; nodos→muestra nombre). | 🔵 |
| `hooks/useGeoAnchor.test.ts:24-26` | `hooks/useGeoAnchor` | Mock de React (`useMemo`) / reimpl-del-runtime | Mockea `react` entero a `{ useMemo: (fn)=>fn() }` para invocar el hook fuera de un componente. La matemática mesh↔geo testeada es real y los round-trips son fuertes, pero el test no ejercita el ciclo de hook real (memoización/deps); si el hook regresara por deps mal puestas, no se detecta. Pragmático y honesto en el comentario, pero deja un hueco. | 🔵 |
| `hooks/useInvoicePolling.test.ts:109-123` | `hooks/useInvoicePolling` | Nombre vs cuerpo levemente desalineado | Caso "1. invoiceId hook contract: engine does not run for empty" en realidad **aborta** el controller y verifica no-fetch; no prueba el camino de id vacío (que vive en el hook React, no en el engine). El comentario lo reconoce; cobertura real del gate de id vacío queda fuera de este archivo. | 🔵 |
| `hooks/useProjectFirestoreCollection.test.tsx:157-169` | `hooks/useProjectFirestoreCollection` | Assert estrecho + comentario admite hueco | "proyecto vacío — no llama subscribe" solo asserta `subscribe not called`; el propio comentario dice que no inspecciona `result.current` (loading/items) "acá basta con que subscribe no se invocó". Débil pero los its hermanos cubren loading=false/items=[] en otros caminos. | 🔵 |
| `contexts/SubscriptionContext.test.ts` (todo) | `contexts/SubscriptionContext` | Cobertura por diseño (UX-only) | Solo prueba `getFeaturesForPlan` (gating de frontend, que CLAUDE.md #11 declara UX-only). Los tests son sólidos para lo que cubren (matriz por plan, objeto fresco no compartido), pero el gating canónico server-side (`users/{uid}.subscription.planId` vs `RANK_*`) no se toca aquí — esperado, se cubre en server tests. Nota, no defecto. | 🔵 |

## Conteo de tests sólidos

- **Archivos sólidos (sin reservas materiales): 49 / 55.**
  Joyas: los 7 API clients HTTP (contrato path/method/body/header + 4 ramas de
  error, p.ej. `useExternalAuditPortal` que asserta que el path **público**
  NO adjunta `Authorization` — seguridad load-bearing); `useInvoicePolling`
  (state-machine completa con fake timers, backoff cap, hydration grace,
  abort); `useBiometricAuth` (fail-closed R6 downgrade — challenge inalcanzable
  ⇒ `credGet` nunca corre); `useManDownDetection` (escalada inactividad→
  countdown→alert con args exactos + guard sin project/user); `useRiskEngine`
  (merge/search/graph + cola offline + sync-conflict LWW); `useTwinAccess`
  (triple-gate ADR 0011 vía fakers); `EmergencyContext.meshFallback` (4 caminos
  online/offline/throw con payload verificado); `AccessibilityContext` (round-trip
  localStorage + clases html + evento). Page wrappers con privacidad verificada:
  `ConfidentialReports`, `CulturePulse`, `CustodyChain`.
- **Archivos con reservas: 6 / 55** — 0 🔴, 1 🟡, 5 🔵 (ver tabla).
- **`.skip/.todo/.fixme` activos: 0.** Snapshot-only: 0. Rules-tests con Admin
  SDK: N/A (no hay rules-tests en el slice). Stubs-disfrazados: 0 (los stubs de
  `useShiftHandover` están declarados+pinneados per #13).

## Resumen ejecutivo

Lote #8 (índices 385-439: components/contexts/data/hooks/i18n/lib + primeras
pages Sprint-K/Fase-F) es de calidad alta y muy consistente. La columna vertebral
son siete clientes HTTP con contrato idéntico y honesto (path/method/body/headers
exactos, `Idempotency-Key` condicional, y las cuatro ramas de traducción de error)
y un conjunto de engines puros testeados por runner inyectable o `fakers` —
patrón correcto, sin reimplementación-disfrazada ni asserts del propio mock.
**No hay ningún falso-verde 🔴.** El hallazgo más serio es 🟡:
`lib/e2eAuth.test.ts:199-218` se titula "production gate" pero su cuerpo admite que
no puede mockear el gate y asserta lo opuesto (el fixture SÍ se lee), dejando el
gate de producción sin protección de regresión real. Cinco 🔵 menores: un assert
vacuo (`document.body.textContent` en TraceabilityModal), un mock de React entero
para `useGeoAnchor` (mate correcta pero salta el lifecycle), y tres
nombre-vs-assert/estrechez redimidos por its hermanos. Sin skips, sin snapshot-only,
sin rules-tests con bypass, sin stubs-disfrazados. Prioridad de remediación: el 🟡
(renombrar el it o ejercitar el gate vía `vi.stubEnv('MODE','production')`+resetModules).
