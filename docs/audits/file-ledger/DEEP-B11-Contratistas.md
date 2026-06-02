# DEEP — B11 Contratistas, Visitas & Acreditación · 2026-06-02

**Archivos revisados:** 35 (29 del ledger `block==="B11-Contratistas"` + 6 ampliados por grep: `vendorOnboarding.ts`/`.test.ts`, `vendorOnboardingFlow.ts`, `vendorAccreditationTracker.ts`, `geofencePermissions.ts`, `useVendorOnboarding.ts`/`useGeofencePermissions.ts`; revisados también como contexto colindante `ds76Service.ts` y `ds67ds76.ts`, fuera del bloque).

Método: code-first, `file:line` real. Verificados los 3 ejes pedidos (visitors check-in/out con transacción + hostUid del token; vendorOnboarding compute puro; `resolveObservation` API sin UI consumer; DS76).

---

## 1. Lo que YA HACE (implementado y real)

- **Control de Visitas (núcleo, vivo y ruteado).** `src/server/routes/visitors.ts` expone check-in / `:id/check-out` / `:id/acknowledge-induction` / list, montado en `server.ts:965` (`/api/visitors`). El `hostUid` SIEMPRE viene del token (`visitors.ts:116` `req.user!.uid`), nunca del body; el `tenantId` se resuelve de `projects/{id}.tenantId` (`visitors.ts:78-85`), nunca del body. check-out y acknowledge-induction usan `runTransaction` con `get()`+`update()` atómicos (`visitors.ts:202-216`, `:270-291`) cumpliendo CLAUDE.md #19. Los 3 mutadores `await auditServerEvent(...)` (`visitors.ts:158`, `:230`, `:305`) cumpliendo #3/#14. La página `src/pages/Visitors.tsx` (838 LOC) la consume vía `apiAuthHeader` (`:240`,`:441`) y está ruteada en `App.tsx:314` y `:500`. IDs `vis_<ts>_<uuid>` con `randomUUID()` (`visitors.ts:103`), contrato fijado en `__tests__/server/visitors.test.ts`.
- **Motor de registro de visitas puro.** `src/services/visitorControl/visitorRegistry.ts` es event-sourcing determinista sin I/O (`registerVisitor`/`acknowledgeInduction`/`checkOutVisitor`/`applyEvent`/`isActive`), con validación de RUT por forma (`:122`). Coherente con el comentario de cabecera del route.
- **Contractors KPI (compute puro, ruteado + guardado).** `src/server/routes/contractors.ts` 3 endpoints (`compute-kpi`, `rank-by-risk`, `acreditation-gap-report`) montados en `server.ts:1130` (`/api/sprint-k`), cada uno con `verifyAuth` + `guard()` → `assertProjectMember` (`contractors.ts:35-50`). Motor puro en `contractorKpiService.ts` (TRIR/LTIFR/severity 200k/1M, `buildAcreditationGapReport:160`).
- **Vendor Onboarding & Acreditación (compute puro, 5 endpoints, ruteado).** `src/server/routes/vendorOnboarding.ts` 5 endpoints montados en `server.ts:1052`, todos con `guard()`/`assertProjectMember`. Motores puros: `vendorOnboardingFlow.ts` (6 exports) y `vendorAccreditationTracker.ts` (`summarizeAccreditation:81`, `shouldEscalateObservation:125`, `resolveObservation:147`). Hook cliente completo `useVendorOnboarding.ts` cablea los 5.
- **Consultative Sale Playbook (compute puro).** `consultativeSale.ts` 1 endpoint (`/sales/build-playbook`, `server.ts:1055`) con `guard()`; motor `consultativeSalePlaybook.ts` (`buildSalePlaybook`).
- **Geofence Permissions UX (compute puro).** `geofencePermissions.ts` 1 endpoint (`/geofence-permissions/decide-ux`, `server.ts:1076`) con `guard()`; motor `services/geofence/permissionUXDecision.ts`. Respeta Directiva #2 (no bloquea maquinaria).
- **DS76 minero (PDF real).** `src/utils/ds76MiningContractor.ts` (438 LOC) genera el PDF DS76/2007 con jsPDF (`generateDs76Pdf:189`, `downloadDs76Pdf:431`). Consumido por `src/pages/MiningContractors.tsx` (ruteada `App.tsx:515`). Nota: coexiste con un sistema DS76 más completo fuera del bloque (`services/compliance/ds76/ds76Service.ts` + ruta `ds67ds76.ts` con folio/firma/versiones).
- **Tests verdes.** Corrí visitors/contractors/vendorOnboarding/vendorAccreditationTracker: 4 files, 34 tests passing.

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **`visitors.ts` NO llama `assertProjectMember` (viola CLAUDE.md #6).** check-in (`:110`), check-out (`:176`) y acknowledge-induction (`:243`) sólo resuelven `tenantIdFor(projectId)` pero **no verifican que el caller sea miembro del proyecto**. Cualquier usuario autenticado que conozca/adivine un `projectId` válido puede registrar/checkout/inducir visitas en proyectos ajenos (cross-project write). El resto de rutas del bloque sí usan `guard()`. El test `visitors.test.ts`/`router.test.ts` **no** cubre el caso 403-no-miembro. Es la deuda de seguridad #1 del bloque.
- 🔵 **`resolveObservation` (vendorAccreditationTracker.ts:147) exportada y testeada pero SIN consumer.** No la expone `vendorOnboarding.ts` (sólo `summarize` y `should-escalate`) ni la usa `useVendorOnboarding.ts` ni UI alguna. Es lógica de cierre de observación que no puede ejecutarse end-to-end. (Confirmado por grep: únicas referencias son su propio archivo y su test.)
- 🔵 **Sistema de visitas paralelo muerto.** `src/services/visitors/visitorAccessService.ts` (185 LOC, zonas/EPP/checklist) + `src/components/visitors/VisitorCheckInForm.tsx` (243 LOC) + `src/hooks/useActiveVisitors.ts` están huérfanos: `VisitorCheckInForm` no se importa en ninguna parte; `useActiveVisitors` no tiene consumers Y apunta a `/api/sprint-k/:projectId/visitors/active` que **no existe en el servidor** (verificado: ningún route lo registra). `visitorAccessService` sólo lo usan estos dos huérfanos. La página viva (`Visitors.tsx`) usa el otro stack (`visitorRegistry`).
- 🔵 **Hooks/componentes de contractors huérfanos.** `useContractors.ts` (3 mutadores remotos), `useConsultativeSale.ts`, `useGeofencePermissions.ts` y `ContractorRankingTable.tsx` no se importan fuera de su propia definición/test. `ContractorRankingTable` además llama `rankContractorsByRisk` puro client-side (no usa el endpoint remoto). Los endpoints existen y están testeados, pero sin UI que los consuma → backend listo, frontend sin cablear.
- 🟡 **`MiningContractors.tsx` no persiste.** Trabaja sobre estado local seedeado (`emptyContractor:33`, comentario `:7-10`); no escribe a `projects/{id}/miningContractors` ni consume la API de contractors KPI. Genera PDF real pero los datos no sobreviven recarga.
- 🟡 **`visitors.test.ts` (34 LOC) es test débil.** Reimplementa la forma del ID inline en vez de importar `newVisitorId` (que no se exporta); no ejerce el route. La cobertura real está en `router.test.ts`.
- ⚠️ **DS76 duplicado.** Dos implementaciones: `ds76MiningContractor.ts` (B11, PDF-only, local) y `ds76Service.ts` (folio+firma+versiones, Firestore, ruteado en `/api/compliance`). Riesgo de divergencia de plantilla legal.

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/visitors.ts | 347 | 🔴 | server.ts:965 `/api/visitors` | Check-in/out/ack/list. hostUid del token (:116), txn en out/ack (:202,:270), audit await (:158,:230,:305). **FALTA assertProjectMember** → cross-project write (#6). |
| src/services/visitorControl/visitorRegistry.ts | 254 | ✅ | usado por visitors.ts + Visitors.tsx | Event-sourcing puro determinista. RUT por forma (:122). |
| src/pages/Visitors.tsx | 838 | ✅ | App.tsx:314,:500 | UI viva de visitas + inducción QR. Llama API real (:240,:441). |
| src/__tests__/server/visitors.router.test.ts | 436 | ✅ | test | Cubre hostUid-from-token (:212), check-in/out/ack. |
| src/__tests__/server/visitors.test.ts | 34 | 🟡 | test | Contrato de ID inline, NO importa newVisitorId ni ejerce el route. |
| src/server/routes/visitors.test.ts | 417 | ✅ | test | Suite supertest del route (passing). No cubre 403-no-miembro. |
| src/services/visitors/visitorAccessService.ts | 185 | 🔵 | sólo huérfanos | Stack de acceso paralelo (zonas/EPP). Sólo consumido por VisitorCheckInForm + useActiveVisitors (ambos muertos). |
| src/services/visitors/visitorAccessService.test.ts | 155 | ✅ | test | Testea servicio huérfano. |
| src/services/visitors/visitorFirestoreAdapter.ts | 65 | 🔵 | sólo test | Adapter del stack paralelo; sin consumer productivo. |
| src/services/visitors/visitorFirestoreAdapter.test.ts | 66 | ✅ | test | — |
| src/components/visitors/VisitorCheckInForm.tsx | 243 | 🔵 | NINGUNO | Form de check-in del stack paralelo; no importado en ningún sitio. |
| src/components/visitors/VisitorCheckInForm.test.tsx | 70 | ✅ | test | Testea componente huérfano. |
| src/hooks/useActiveVisitors.ts | 89 | 🔵 | NINGUNO | Apunta a `/api/sprint-k/.../visitors/active` **inexistente**; sin consumers. |
| src/server/routes/contractors.ts | 172 | ✅ | server.ts:1130 | 3 endpoints KPI puros, guard()/assertProjectMember (:35). |
| src/services/contractors/contractorKpiService.ts | 179 | ✅ | route + ContractorRankingTable | TRIR/LTIFR/severity + buildAcreditationGapReport (:160). |
| src/services/contractors/contractorKpiService.test.ts | 136 | ✅ | test | — |
| src/server/routes/contractors.test.ts | 32 | ✅ | test | Cobertura base del route. |
| src/hooks/useContractors.ts | 96 | 🔵 | NINGUNO | 3 mutadores remotos sin UI consumer. |
| src/components/contractors/ContractorRankingTable.tsx | 109 | 🔵 | NINGUNO | Tabla por riesgo; llama rankContractorsByRisk client-side (:9), no importada por página alguna. |
| src/components/contractors/ContractorRankingTable.test.tsx | 58 | ✅ | test | — |
| src/pages/MiningContractors.tsx | 330 | 🟡 | App.tsx:515 | DS76 minero. Estado local seedeado, NO persiste (:7-10,:33); genera PDF real. |
| src/utils/ds76MiningContractor.ts | 438 | ✅ | MiningContractors.tsx | Generador PDF DS76 (jsPDF) real (:189,:431). Duplica ds76Service. |
| src/utils/ds76MiningContractor.test.ts | 127 | ✅ | test | — |
| src/server/routes/vendorOnboarding.ts | 300 | ✅ | server.ts:1052 | 5 endpoints compute puro, guard() en cada uno. NO expone resolveObservation. |
| src/services/vendorOnboarding/vendorOnboardingFlow.ts | — | ✅ | route + hook | Motor de etapas/bundle puro (6 exports). |
| src/services/vendorOnboarding/vendorAccreditationTracker.ts | 159 | 🔵 (parcial) | summarize/escalate cableados | summarizeAccreditation(:81)+shouldEscalate(:125) vivos; **resolveObservation(:147) sin consumer**. |
| src/services/vendorOnboarding/vendorOnboardingFlow.test.ts | — | ✅ | test | — |
| src/services/vendorOnboarding/vendorAccreditationTracker.test.ts | — | ✅ | test | Testea resolveObservation (:145) aunque no haya consumer. |
| src/__tests__/server/vendorOnboarding.test.ts | — | ✅ | test | Suite del route. |
| src/hooks/useVendorOnboarding.ts | 151 | 🔵 | NINGUNO | Cablea los 5 endpoints; sin UI consumer. |
| src/server/routes/consultativeSale.ts | 159 | ✅ | server.ts:1055 | build-playbook puro, guard(). |
| src/services/consultativeSale/consultativeSalePlaybook.ts | 285 | ✅ | route | buildSalePlaybook puro. |
| src/services/consultativeSale/consultativeSalePlaybook.test.ts | 201 | ✅ | test | — |
| src/server/routes/consultativeSale.test.ts | 24 | ✅ | test | — |
| src/hooks/useConsultativeSale.ts | 44 | 🔵 | NINGUNO | buildSalePlaybookForProspect sin UI consumer. |
| src/server/routes/geofencePermissions.ts | 99 | ✅ | server.ts:1076 | decide-ux puro, guard(). |
| src/hooks/useGeofencePermissions.ts | 53 | 🔵 | NINGUNO | decideGeofencePermissionUX sin UI consumer. |
| src/server/routes/geofencePermissions.test.ts | — | ✅ | test | — |

Estados: ✅ implementado+real · 🟡 parcial/deuda menor · 🏚️ stub/abandonado · 🔵 orphan (no cableado a UI/consumer) · 🔑 seguridad/permiso OK · 🔴 bug/violación directiva.

## 4. Para decisión del usuario (❓/⚠️)

- 🔴 **¿Parchar `visitors.ts` con `assertProjectMember` ya?** Es la única violación dura de CLAUDE.md #6 del bloque (cross-project write en check-in/out/ack). Recomiendo añadir `guard()` como las otras rutas + un test 403-no-miembro. **(Decisión de fix vs. aceptar riesgo documentado.)**
- ⚠️ **¿Dos stacks de visitas?** El stack `visitorAccessService`+`VisitorCheckInForm`+`useActiveVisitors` está muerto y `useActiveVisitors` llama un endpoint inexistente. ¿Borrar el stack paralelo o cablearlo? Mantenerlo confunde y arrastra tests verdes sobre código no usado.
- ⚠️ **Backend B11 listo, frontend sin cablear.** contractors/consultativeSale/geofence/vendorOnboarding tienen endpoints+hooks+tests pero ningún componente/página los consume (salvo ContractorRankingTable que tampoco está montada). ¿Falta sprint de UI o se decidió backend-first?
- ❓ **`resolveObservation`:** ¿exponer endpoint `vendors/:id/accreditation/resolve-observation` o eliminar la función? Hoy no hay forma de cerrar observaciones end-to-end.
- ⚠️ **DS76 duplicado** (`ds76MiningContractor.ts` local-PDF vs `ds76Service.ts` folio/firma/Firestore). ¿Consolidar plantilla legal? Y `MiningContractors.tsx` no persiste — riesgo de pérdida de datos del usuario.

_Doc-only. Sin git commit._
