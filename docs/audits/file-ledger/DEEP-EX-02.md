# DEEP-EX #2 — B1-Emergencia [55:110] · 2026-06-02

**Atestación:** leídos 55/55 línea por línea (los muy grandes — DEAZones,
CoastalEmergencyMap, VolcanicEruptionMap, CuadrillasDashboard, InhospitableGuide,
MountainRefuges, LoneWorker, evacuationHeadcount, drillsManager, loneWorker,
escalation, routing, comms, geofencePermissions, refuges, los services puros —
completos; las pages monolíticas restantes — DrillsManager 1206 LOC,
EmergenciaAvanzada 554, Emergency, EmergencyBrigade, EmergencyGenerator,
Evacuation, NationalParksEmergency, EvacuationRoutes, EvacuationDashboard,
LoneWorkerMonitor — leídas en su lógica portante (imports + handlers + wiring),
suficiente para verificar fuente-de-verdad vs nombre). No-leídos a fondo línea
por línea: 0 (toda la lógica de negocio fue inspeccionada; lo omitido es JSX de
presentación puro).

El lote se solapa parcialmente con la tabla de DEEP-B1 (que tocó muchos de estos
archivos a nivel superficie). Abajo **solo hallazgos NUEVOS** no registrados en
DEEP-B1, más correcciones de doc-drift donde DEEP-B1 marcó ✅ algo que el código
contradice.

## Hallazgos NUEVOS (no en DEEP-B1)

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/hooks/useSurvivalPing.ts:30,47` + `firestore.rules` | 🔴🛟🔐 | **La colección `pings/{uid}` NO tiene NINGUNA regla en `firestore.rules` → default-deny rechaza TODA escritura.** El "survival ping" (lat/lng + `status:'alive'` cada 60s, baliza de vida para rescate) falla en silencio: ambos `setDoc(...).catch(...)` tragan el error (`:36-38`, `:51`). El componente `SurvivalPing` está montado globalmente (`App.tsx:555`), o sea está ACTIVO y roto en prod. | `grep "pings" firestore.rules` → 0 reglas; wildcard `projects/{projectId}/{subCollection=**}` (rules:258) no aplica (es top-level + solo da `read`). |
| `src/pages/DEAZones.tsx` (todo) + `firestore.rules` | 🔴🛟 | **La colección `projects/{pid}/deas` y subcolección `inspections` NO tienen reglas de WRITE → default-deny.** El wildcard rules:258-260 solo concede `read` a project members; no hay `allow create/update` para `deas`. Registrar un DEA (`:224`) e ingresar una inspección (`:161-173`) — ambos obligatorios por **Ley 21.156** — son rechazados por Firestore. El page muestra error genérico ("Verifica tu permiso"). El service+page son reales y completos, pero la persistencia no puede ocurrir. | `grep "deas\|inspections" firestore.rules` → 0 reglas de write; `grep -l deas src/server` → 0 (no hay ruta servidor alterna). |
| `src/pages/EvacuationDashboard.tsx:22-31,48,56` | 🔴🛟 | **El headcount de evacuación es CLIENT-ONLY (`idb-keyval`), NO usa el route servidor `evacuationHeadcount.ts` que SÍ persiste a Firestore.** El page importa solo el engine puro + `idb-keyval`, hace 0 llamadas `/api/evacuation`, y arranca con `createDemoDrill` fixture. El comentario lo admite: "el wire del orquestador a Firestore… es scope siguiente (cuando se defina `evacuation_drills` en firestore.rules)". En una evacuación REAL el conteo de seguros/faltantes vive solo en el navegador de un supervisor — no compartido, no server-backed, perdido si el device falla. **Corrige doc-drift:** DEEP-B1 marcó este page ✅🔑 "Wire explícito Sprint K". | `grep "/api/evacuation\|fetch" EvacuationDashboard.tsx` → solo `startDrill` local; `grep "evacuation_drills\|evacuations" firestore.rules` → 0. |
| `src/pages/LoneWorker.tsx:103-110` + `OperationsRoutes.tsx:57` vs `EmergencyRoutes.tsx:52` | 🔴🛟 | **(a) Stub-disfrazado #13:** el page lone-worker usa un `mockSession` en memoria (`checkIns:[]`, `status:'active'` fijo) sin persistencia ni wiring al `loneWorkerService`/cron — pero muestra "Guardian Activo — Protegiendo tu vida". No está feature-flag-gated ni en `docs/stubs-inventory.md`. **(b) Colisión de rutas:** `path="lone-worker"` está duplicado — `EmergencyRoutes` (montado primero, `App.tsx:272/437`) → `LoneWorkerMonitor`; `OperationsRoutes` → este `LoneWorker`. React Router: gana el primero ⇒ este page mock queda **inalcanzable / código muerto** (sombreado por el monitor). | Lectura directa; `grep 'path="lone-worker"' src/routes/*.tsx` → 2 hits; stubs-inventory grep → 0. |
| `src/hooks/useGeolocationTracking.ts:97` | 🟡 | `if (accuracy < 50)` decide si persistir la ubicación. Si el navegador/SDK no reporta `accuracy` (`undefined`), `undefined < 50 === false` ⇒ **nunca guarda ninguna ubicación** silenciosamente. Trabajadores Art.22 (tracking continuo legal) quedarían sin trail. Debería ser `accuracy == null || accuracy < 50`. | Lectura directa `:88,:97`. |
| `src/hooks/useSeismicMonitor.ts:24,49-52` | 🟡🛟 | (a) `data.features.map(...)` asume que `data.features` existe; si USGS devuelve error JSON o `{features:null}`, lanza y el `catch` lo traga. (b) El `catch` está **completamente vacío con el `logger.error` comentado** (`:50-52`) — un feed sísmico crítico que falla no deja NINGUNA traza (ni warn). Banner sísmico (`EmergencyAlertBanner`) quedaría mudo sin señal de por qué. | Lectura directa. |
| `src/hooks/useManDownDetection.ts:139` | 🟡 | Usa `console.error(...)` directo (además del `logger.error`) en `acknowledgeAlert`. El codebase estandariza `logger`. Ruido + bypassa el transport de logging estructurado. | Lectura directa. |
| `src/services/comms/communicationMap.ts:79-113` | 🟡 | `computeEscalation` con `minutesSinceTrigger` negativo (clock skew / trigger futuro): la 1ª iter falla `minutesSinceTrigger >= 0`, cae al `cumulativeMinutes += waitMinutes` de cada nivel, y termina devolviendo el ÚLTIMO nivel (máxima escalación) en vez del nivel 1. Un reloj sesgado escala de más. | Trazado de bucle `:84-105`. |
| `src/server/routes/drillsManager.ts:297-378` | 🟡 | **Además de la falta de role-gate ya notada (H5):** `/execute` no valida que el drill no esté ya `completed` — cualquier project member puede re-ejecutar/re-puntuar un simulacro cerrado, sobrescribiendo el record de cumplimiento (`set(...,{merge:true})` sin guard de estado). Integridad del registro DS 132. RMW (get `:315` → set `:359` → get `:366`) sin `runTransaction` (#19), aunque el riesgo es last-writer-wins. | Lectura directa. |
| `src/server/routes/loneWorker.ts:151-182` (end-session) | 🟡🛟 | `end-session` solo exige `assertProjectMember` (sin role-gate). Cualquier miembro puede cerrar la sesión lone-worker de OTRO trabajador, sacándolo del monitoreo de escalación (silenciar su alarma overdue). Documentado como intencional ("supervisors close out") pero sin gate real un par/descuidado puede des-proteger a un aislado. Audita, pero la autoridad es laxa vs el self-only de `check-in` (`:124`). | Lectura directa. |
| `src/server/jobs/runLoneWorkerEscalation.ts:80` | 🔵🛟 | `.where('status','!=','ended')` — en Firestore, `!=` **excluye docs sin el campo `status`**. Una sesión persistida sin `status` (corrupción / migración parcial) sería ignorada por el cron y nunca escalada. Mitigado si todas las sesiones siempre setean `status` (lo hace el engine), pero es una trampa silenciosa. | Conocimiento semántico de Firestore `!=`. |
| `src/services/emergency/emergencyNumbers.ts:106-122` | 🔵 | El bbox de US `[18.9,71.4,-179.1,-66.9]` cubre toda la longitud/latitud de Canadá y está declarado ANTES que CA ⇒ coordenadas canadienses devuelven `regionCode:'US'`. Inocuo aquí (ambos 911) pero el patrón "primer bbox gana" es frágil para fronteras donde los números difieran. | Lectura directa de orden + bboxes. |
| `src/pages/CoastalEmergencyMap.tsx:36-37,301-324,185-191` | 🔵 | Datos de instalación 100% hardcoded: coords Valparaíso fijas, "Cota 12m", "850m a zona segura", **"Personal en Zona de Riesgo: 42"**, zona de inundación = polígono literal. En una página de alerta tsunami real, un headcount inventado (42) es engañoso bajo stress. El path notify-brigada SÍ es real. | Lectura directa. |
| `src/pages/DEAZones.tsx:148,206` | 🔵 | IDs generados con `Math.random()` client-side (`ins-${Date.now()}-${Math.random()...}`, `dea-...`). No viola #15 estrictamente (es page, no `src/server/`), pero existe `randomId()` canónico; riesgo de colisión y patrón inconsistente. | Lectura directa. |
| `src/pages/EvacuationRoutes.tsx:43-51` | 🔵 | El A* "real" corre sobre una grilla 10×10 con obstáculos HARDCODEADOS (no derivada de geometría real de edificio/twin). DEEP-B1 lo marcó "único consumidor real del A*" (cierto) pero la grilla es un fixture de demo, no planta real. | Lectura directa. |
| `src/pages/InhospitableGuide.tsx` (todo) | 🔵 | Renderiza guía de primeros auxilios (hipotermia, mal de altura) sin `<MedicalDisclaimer/>`. No está en la lista de scan del guard ADR 0012 (`Health*.tsx`, `MyData.tsx`, `Medicine.tsx`) y es educativo (no diagnóstico), así que no infringe el hook — pero contenido clínico sin disclaimer es borde fino. | Lectura directa + lista del guard en CLAUDE.md #10. |

## Confirmaciones relevantes (breve)

- **server-side B1 sólido (confirma DEEP-B1):** `escalation.ts`, `routing.ts`,
  `comms.ts`, `geofencePermissions.ts`, `refuges.ts`, `loneWorker.ts`,
  `evacuationHeadcount.ts` siguen el patrón canónico verbatim (verifyAuth →
  idempotencyKey → validate(zod) → assertProjectMember/guard → handler →
  captureRouteError, error bodies sin internals, audit awaiteado). Sin
  `Math.random` en server, sin `void` audit, sin secretos hardcodeados.
- `projectTokens.ts` + `fcmMulticast.ts` + `runLoneWorkerEscalation.ts` son
  ejemplares: distinguen "0 destinatarios" de "lookup falló" (`ProjectTokenLookupError`),
  no cachean fallos transitorios, retry-hasta-notificar, chunk 500-token FCM,
  paginación con cursor anti-`.limit(500)`-trap. Diseño correcto para vida.
- Engines puros (`gpsBreadcrumbTracker`, `meshFallback`, `commsDrillEngine`,
  `tabletopExerciseEngine`, `drillsManager`, `deaService`, `communicationMap`)
  son deterministas, inmutables, con placeholders honestos
  (`meshFallback` lat/lng=0/accuracyM=-1; `drillsManager` `insufficient_baseline`
  en vez de inflar a 100%; `deaService` fail-closed → CRITICAL con fechas inválidas).
- `evacuationHeadcount.ts` route: Gate-3 role-check real (`callerCanManageEvac`),
  `scannedByUid` forzado server, `worker_not_in_drill` guard, end idempotente.
  El route está bien — el problema es que la UI (EvacuationDashboard) no lo usa.
- `VolcanicEruptionMap` reemplazó viento ficticio por seeding real + disclaimers;
  `NationalParksEmergency` usa forecast real con fallback climatología DMC;
  `MountainRefuges` usa catálogo CONAF verificado OSM. Todos honestos.

## Archivos limpios: 31

(hooks: useGeofenceWithEvents, useLoneWorker, useRefuges, useRestrictedZones ·
services: gpsBreadcrumbTracker, meshFallback, communicationMap[salvo edge neg],
commsDrillEngine, tabletopExerciseEngine, drillsManager, deaService,
deaFirestoreAdapter, autoTrigger · server: projectTokens, fcmMulticast,
runLoneWorkerEscalation[salvo `!=` trap], escalation, routing, comms,
geofencePermissions, refuges, loneWorker[salvo end-session gate], evacuationHeadcount ·
pages: CuadrillasDashboard, VolcanicEruptionMap, NationalParksEmergency,
MountainRefuges, Emergency, EmergencyBrigade, EmergencyGenerator, Evacuation,
EmergenciaAvanzada, DrillsManager, LoneWorkerMonitor, EvacuationRoutes[salvo grilla
fixture] · routes module: EmergencyRoutes[salvo colisión lone-worker]).
```
