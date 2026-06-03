# DEEP-EX #3 — B1-Emergencia [110:130] · 2026-06-02

**Atestación:** leídos 20/20 línea por línea.

Lote derivado de `ledger.json` (filtro `category` empieza con "FEAT" && `block==="B1-Emergencia"`,
ordenado por `path`, slice `[110:130]` — los últimos 20 de 130). Hallazgos NUEVOS solamente;
no se repiten H1–H3 ni la tabla por archivo de `DEEP-B1-Emergencia.md`.

Archivos del lote:
`sosOrchestrator.ts`, `sosOutbox.ts`, `emergencyBrigadeService.ts`, `escalationSlaEngine.ts`,
`evacuationFirestoreAdapter.ts`, `evacuationHeadcount.ts`, `firstResponderMap.ts`,
`gemini/emergency.ts`, `permissionUXDecision.ts`, `polygonUtils.ts`, `loneWorkerService.ts`,
`loneWorkerStore.ts`, `manDownTimer.ts`, `mountainRefuges.ts`, `gridAStar.ts`,
`routeClimateAssessment.ts`, `routingBackend.ts`, `emergencyContextAdapter.ts`,
`geofenceToSos.ts`, `restrictedZonesEngine.ts`.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/services/emergency/sosOutbox.ts:160-167` | 🔴 🛟 | **SOS que agota reintentos se PIERDE en silencio.** En `flush()`, cuando `newRetry > MAX_RETRY` se hace `gaveUp += 1` y `continue` SIN empujar la entry a `next` y SIN persistir a quarantine. El comentario admite "se podría persistir… fuera de scope". El tipo `OutboxStatus` declara `'gave_up'` pero nunca se materializa. ⇒ Un SOS offline que falla 6 envíos (≈63 s de ventana) desaparece de IndexedDB sin rastro recuperable ni telemetría persistente. Para el botón cuya premisa es "NO PUEDE depender de red" (`:2-6`), perder el evento tras backoff es el peor modo de falla. | `gave_up` solo se cuenta, nunca se guarda; `next` no lo incluye; `save(next)` lo borra. |
| `src/services/routingBackend.ts:39-78` | 🔴 🛟 | **`calculateDeterministicSafeRoute` "evita peligros" de forma insegura y es la ruta real de evacuación.** Consumida en producción por `geminiBackend.ts:641` (`generateDynamicEvacuationRoute`) como la ruta matemática que luego Gemini narra al personal. Defectos: (a) solo evita UN hazard por waypoint (`break` en `:70`); (b) el punto re-ubicado puede caer dentro de OTRO hazard sin re-chequeo; (c) los **segmentos entre waypoints nunca se chequean** — la recta entre dos puntos "seguros" puede atravesar de lleno una zona crítica. El `gridAStar.ts` (que el doc llama el reemplazo "REAL" de los fakes) NO alimenta esta ruta. | `geminiBackend.ts:641` la usa; lazo `:56-72` con `break` mono-hazard; interpolación lineal `:50-53` sin colisión de segmento. |
| `src/services/loneWorker/manDownTimer.ts:143-180` | 🟡 🛟 | **`tickManDownEvent` avanza máximo UN stage por llamada → escalamiento se rezaga si el tick llega tarde.** Cada rama (`pre_alert→level_1`, `level_1→level_2`, …) compara `event.stage` y solo promueve al siguiente. Si el dispositivo/cron estuvo dormido y `elapsedSec` ya supera el umbral de level_3 mientras el evento sigue en `pre_alert`, un solo tick lo deja en `level_1` (no notifica SAMU/brigada). Usado en producción (`evacuationHeadcount`/server cron). Debería resolver el stage por `elapsedSec` absoluto, no incrementalmente. | Ramas `else if` por stage `:143,:154,:165`; ninguna salta a level_3 directo. |
| `src/services/evacuation/evacuationHeadcount.ts:131-158` | 🟡 | **`buildPostmortem` cuenta scans no-esperados → coverage puede pasar de 100 %.** `totalSafe = drill.scans.length` (`:135`) y `finalCoveragePercent = round(safeCount/expectedCount*100)` (`:156-157`) NO intersectan con `expectedWorkers` (a diferencia de `computeStatus`, que sí lo hace en `:60-66`). Un scan de un uid fuera del roster infla `totalSafe` y produce >100 %. Materializado en prod: `evacuation.ts:191`, `evacuationHeadcount.ts:420,427`. | Contraste `computeStatus` (intersecta) vs `buildPostmortem` (no). |
| `src/services/gemini/emergency.ts:185` | 🟡 | **`JSON.parse(response.text \|\| '{}')` sin try/catch (viola convención #5).** Las otras dos funciones del módulo usan `parseGeminiJson(response)` (`:114`); `generateEmergencyPlanJSON` parsea crudo. Si Gemini devuelve JSON malformado, lanza excepción no tipada en lugar de fallback/502. | `:114` usa helper; `:185` no. |
| `src/services/emergencyBrigade/emergencyBrigadeService.ts:79-84` | 🟡 | **Capacitación con fecha inválida cuenta como VIGENTE (cobertura falsa).** `expiresMs = Date.parse(m.trainedAt) + …`; si `trainedAt` no parsea, `expiresMs = NaN`, y `NaN < nowMs` es `false`, así que el miembro NO va a `expiredTrainings` y SÍ suma en `byRole` (`:83`). ⇒ un dato corrupto puede hacer que `meetsMinimum=true` con brigada en realidad sin cobertura. Mismo patrón NaN no defendido en `restrictedZonesEngine.ts:63-66`. | `:79-84`; sin validación de `Date.parse`. |
| `src/services/systemEngine/adapters/emergencyContextAdapter.ts:32,37` | 🟡 🛟 | **`void emit('sos_triggered')` con solo `.catch(logger.warn)` + idempotencyKey con `Date.now()`.** El evento que arranca la cascada SOS del SystemEngine se dispara fire-and-forget; si `emit` falla, se loguea warn y la cascada NO ocurre (espíritu de la directiva #14 sobre eventos de compliance/SOS awaiteados). Además `idempotencyKey: sos:${uid}:${type}:${Date.now()}` (`:37`) usa reloj → no es idempotente entre reintentos (mitigado por `wasActiveRef`, pero la clave miente sobre su propósito). | `:32` void; `:37` Date.now en idempotencyKey. |
| `src/services/loneWorker/loneWorkerService.ts:49` | 🔵 | **Flag `help_requested` nunca se limpia.** `deriveLoneWorkerStatus` retorna `help_requested` si CUALQUIER check-in histórico tuvo `status:'help'`, aunque el worker después haya hecho check-in `ok`. La sesión queda pegada en escalamiento a `emergency_services` (`decideEscalation:84-89`) indefinidamente — ruido operativo / falso positivo persistente. | `.some((c)=>c.status==='help')` sin considerar el último estado. |
| `src/services/loneWorker/loneWorkerStore.ts:18-19` | 🔵 | **Doc-drift en comentario:** dice "not-in es soportado nativo por Firestore where()" pero el filtro usa `op: 'in'` con la lista de status vivos. El comentario describe una implementación distinta a la real. Trivial pero confunde al lector. | `:18` comentario `not-in` vs `:20` `op: 'in'`. |
| `src/services/evacuation/evacuationFirestoreAdapter.ts:36-52` | 🔵 | **`getDrill` carga TODA la subcollection `scans` sin límite.** `scansSnap` hace `.get()` sin `limit()` ni paginación. En una evacuación real grande (cientos/miles de trabajadores) esto es una lectura ilimitada de Firestore por cada `getDrill`. Lecturas idempotentes vía docId=workerUid son correctas, pero la lectura completa es un riesgo de costo/latencia en el peor momento. | `:45-50`. |

## Archivos limpios: 9

`sosOrchestrator.ts` (engine puro, disclaimer Directiva 2 `:114`, fallback Chile siempre,
GPS placeholder honesto `:192`), `escalationSlaEngine.ts` (determinístico, NaN-age acotado por
`Math.max(0,…)` `:161`, cadena se agota honestamente), `permissionUXDecision.ts` (puro, sin I/O,
Directiva #2 explícita, iOS sin "deny forever" modelado bien), `polygonUtils.ts` (ray-casting
correcto; única nota menor: `closestPointOnSegment` proyecta lat/lng como cartesiano sin
corrección de coseno de longitud — error sub-métrico a escala de faena, aceptable),
`firstResponderMap.ts` (dispatch determinístico, sin-posición → `available:false` honesto `:175-186`,
recomendación SAMU 131 si no hay nadie), `mountainRefuges.ts` (catálogo real verificado OSM,
reemplazó refugios ficticios, haversine correcto), `gridAStar.ts` (A* correcto; lazy-deletion sin
decrease-key pero gScore protege la relajación → correctitud preservada, solo sub-óptimo en
re-expansión), `routeClimateAssessment.ts` (distingue "sin riesgo" de "no sabemos" vía
`failedSources` `:94,:251,:267` — patrón honesto ejemplar), `geofenceToSos.ts` (política P0
correcta; short-circuit si emergencia activa `:25`, HAZMAT/RESTRICTED→trigger+notify, DANGER→soft).

---

### Resumen ejecutivo (6-10 líneas)

Leídos los 20 archivos del slice `[110:130]` línea por línea. El bloque sigue siendo
mayoritariamente sólido y honesto, pero aparecen **2 hallazgos 🔴 de vida nuevos** no
listados en `DEEP-B1-Emergencia.md`:

1. **`sosOutbox.flush` pierde el SOS en silencio** tras 6 reintentos — `gave_up` solo se cuenta,
   nunca se persiste ni se mueve a quarantine, contradiciendo la premisa "el SOS no puede
   depender de red". Es el peor modo de falla para el botón offline-first.
2. **`calculateDeterministicSafeRoute` (routingBackend) es la ruta real de evacuación** (vía
   `geminiBackend.ts:641`) y "evita" peligros de forma insegura: mono-hazard por waypoint, sin
   re-chequeo del punto re-ubicado, y sin verificar los segmentos entre waypoints. El A* real
   (`gridAStar.ts`) NO alimenta esta ruta.

Hallazgos 🟡 relevantes: el `tickManDownEvent` solo avanza un stage por tick (rezaga SAMU si el
tick llega tarde), `buildPostmortem` puede reportar cobertura >100 % al contar scans fuera del
roster, capacitación con fecha NaN cuenta como vigente en la brigada, `gemini/emergency.ts:185`
parsea JSON sin try/catch (viola #5), y `emergencyContextAdapter` dispara el `sos_triggered` con
`void emit` + idempotencyKey basada en `Date.now()`. 9 archivos limpios (engines puros y catálogos
verificados). Doc-only; sin git commit.
