# DEEP-EX #1 — B1-Emergencia [0:55] · 2026-06-02

**Derivación del lote:** `ledger.json` filtrado por `category` startsWith "FEAT" &&
`block === "B1-Emergencia"` → 130 entradas; ordenadas por `path` asc; slice `[0:55]`.

**Atestación de cobertura:** leídos **55/55** línea por línea (no inferidos por nombre).
Ningún archivo quedó sin leer completo. Se cruzó cada hallazgo contra `DEEP-B1-Emergencia.md`
para no duplicar (H1–H6 ya documentados ahí NO se repiten salvo confirmación breve).

Severidad: 🔴 crítico · 🟡 medio · 🔵 menor/limpieza.

---

## Hallazgos NUEVOS (no en DEEP-B1)

| Archivo:línea | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| `firestore.rules:177-194` + `components/emergency/EmergencyCheckIn.tsx:110-141` | 🔴 | **"Declarar/Finalizar Emergencia" del EmergencyCheckIn está roto a nivel de reglas y falla en silencio.** `toggleEmergency` hace `setDoc(projectRef, {isEmergencyActive}, {merge:true})`, pero `isValidProject()` (gate del update de `projects/{id}`) usa `hasOnly([...])` y **`isEmergencyActive` NO está en la allowlist** (tampoco `activeEmergencyProtocol`/`emergencyStartTime` que `EmergencyDashboard` lee en `:50-54`). ⇒ el write es **rechazado para TODOS, incluido admin**, y el error solo va a `handleFirestoreError` (sin feedback visible al usuario). El botón gigante "Declarar Emergencia" parece funcionar pero no persiste nada. 🛟 | `firestore.rules:178-194` (allowlist sin `isEmergencyActive`); `EmergencyCheckIn.tsx:115` setDoc merge; `:138-140` error swallow |
| `components/emergency/EmergencySquadManager.tsx:28-33,102,250-254` | 🔴 | **Stub disfrazado en componente vida-crítico.** El escuadrón de emergencia entero es **mock hardcoded** (Carlos Mendoza, Ana Silva, "María Gómez — Soporte Vital — No Responde — 120m"). Se renderiza dentro de `EmergencyDashboard` sin etiqueta de "demo". Un supervisor en emergencia real puede creer que "Soporte Vital No Responde" es dato real. Botones "Reasignar Rol", "Ver Ubicación", "Llamado General" son no-ops. Viola Directiva #13 (sin flag, sin TODO, sin registro en stubs-inventory). | `:28-33` array literal; `:102` "Llamado General" sin handler; `:250-254` botones sin onClick |
| `components/emergency/EmergencyDashboard.tsx:273-281,357` | 🟡 | **LOTO "Desconexión remota de maquinaria" es 100% cosmético + contradice Directiva #2.** El `ConfirmDialog` dice "Esto desconectará remotamente toda la maquinaria crítica"; `onConfirm` solo hace `setLotoActivated(true)` (estado local). No persiste ni comanda nada. Además promete una acción (detener maquinaria) que la Directiva 2 prohíbe. Stub disfrazado de acción de seguridad. | `:279` `onConfirm={() => { setLotoActivated(true); ... }}`; `:276` copy "desconectará remotamente" |
| `components/emergency/EmergencyDashboard.tsx:211-216` | 🔵 | "Zonas Críticas: 2 áreas con incidentes activos" + "Sector B"/"Planta 2" son **hardcoded**, no derivan de datos. Se muestran junto a stats reales (`stats.safe/total`) → parecen live. | `:212` "2 áreas con incidentes activos"; `:215-216` Sector B/Planta 2 literales |
| `hooks/useAccelerometer.ts:27-47,90-106` + `components/emergency/FallDetectionMonitor.tsx:95` | 🟡 | **Listener leak en el detector de caídas (vida-crítico).** `handleMotion` es `useCallback([threshold, onFallDetected])`. FallDetectionMonitor pasa `onFallDetected: handleFallDetected` **sin memoizar** ⇒ `handleMotion` cambia de identidad cada render ⇒ `start`/`stop` cambian ⇒ el effect re-suscribe en loop. En web, `stop()` hace `removeEventListener(handleMotion)` con una identidad distinta a la usada en `addEventListener` ⇒ **listeners 'devicemotion' fugados** y posibles disparos múltiples. | `useAccelerometer.ts:47` deps; `:90` add / `:103` remove con identidad cambiante; `FallDetectionMonitor.tsx:95` callback no memo |
| `components/emergency/SurvivalMode.tsx:152-164` | 🟡 | **`setInterval` interno del torch nunca se limpia (modo supervivencia offline).** `startTorch()` crea un `setInterval` en `:158` que NO se guarda ni se limpia. El cleanup en `:166-173` solo limpia el `interval` externo (`:149`) y para el stream, pero el intervalo del torch sigue vivo llamando `applyConstraints` sobre un track ya detenido. Leak por cada activación de faro. | `:158` `setInterval(... torch ...)` sin ref; `:166-173` cleanup no lo borra |
| `hooks/useAcousticSOS.ts:23-38` | 🟡 | **SOS acústico falsea positivos con ruido sostenido (entorno minero/construcción).** El efecto cuenta un "golpe" cada vez que `noiseLevel >= threshold` con cooldown de 400ms. Ruido fuerte **continuo** (maquinaria, perforación) registra un golpe cada 400ms ⇒ 3 dentro de la ventana ⇒ dispara SOS/faro sin que nadie golpee. En faena ruidosa el gatillo es casi permanente. (Impacto acotado: solo activa strobe, no fan-out.) | `:27` `noiseLevel >= threshold`; cooldown `:21`; trigger `:33-35` |
| `components/shared/EmergencyOverlay.tsx:357` | 🔵 | El overlay de emergencia instruye "Asegure el área y **detenga la maquinaria cercana**" (protocolo iot_critical), contradiciendo la Directiva #2 (no detenemos maquinaria) que el resto del bloque respeta (`autoTrigger blockOperation:false`, disclaimer en `sosOrchestrator`). Inconsistencia de copy/directiva. | `:357` `<p>...detenga la maquinaria cercana.</p>` |
| `components/shared/EmergencyOverlay.tsx:457-462` | 🔵 | Botón "(Admin) Desactivar Alarma" llama `resolveEmergency()` **sin ninguna verificación de rol admin**; cualquier usuario que vea el overlay puede apagar la alarma. El label "(Admin)" es decorativo. | `:457-462` onClick={resolveEmergency} sin gate |
| `components/dashboard/ManDownSupervisorWidget.tsx:49-80` | 🔵 | El `acknowledge` de un evento Man Down (vida) no tiene manejo de error: si `updateDoc` lanza, el `catch` implícito no existe (solo hay `finally` que resetea `acking`) ⇒ **el ACK puede fallar en silencio** y el supervisor cree que respondió. El `try` envuelve solo el analytics. | `:53` `await updateDoc(...)` sin try/catch propio; `:67-76` try solo cubre analytics |
| `components/emergency/Asesor.tsx:25-32` | 🟡 | **Superficie de prompt-injection en asesor de emergencia.** El prompt embebe `[... - IGNORAR OTRAS INSTRUCCIONES]` y concatena la entrada cruda del usuario tras "SITUACIÓN REPORTADA: ${query}" sin sanitizar. El usuario (o un payload pegado) puede inyectar instrucciones; el propio framing "IGNORAR OTRAS INSTRUCCIONES" modela el ataque. En modo offline (SLM) no hay capa server que filtre. | `:25` header "IGNORAR OTRAS INSTRUCCIONES"; `:32` `${query}` sin sanitizar |
| `components/emergency/TriageBeacon.tsx:14,35-43,93-100` | 🔵 | El payload QR fullscreen embebe **tipo de sangre + alergias (PII médica) en texto plano** legible por cualquiera que escanee. El comentario `:14` dice que el dismiss "requires supervisor biometric auth" pero `onDismiss` es solo un prop-callback sin gate biométrico real en el componente. (By-design para rescate, pero PII médica sin cifrar + claim de auth no implementado.) 🔐 | `:35-43` `JSON.stringify({blood, allergies, ...})`; `:14` claim biométrico; `:93` botón sin auth |
| `components/layout/EmergencyAlertBanner.tsx:27` | 🔵 | `triggerEmergency('sismo_critico', ...)` se invoca dentro de un `useEffect` **sin `.catch`**; si la promesa rechaza queda como unhandled rejection (contraste: `EmergencyAutoBridge:102` y `FallDetectionMonitor:60-64` sí la envuelven). | `:27` llamada sin await/catch |
| `components/WeatherBulletin.tsx:48-52,264` | 🔵 | Las coordenadas de Open-Meteo están **hardcoded a Santiago** (`lat=-33.45&lng=-70.67`) y el header muestra "Santiago, Chile" fijo, aunque el componente recibe `altitudeM` por prop (faena puede estar a 4000m en el norte). El clima mostrado no corresponde a la ubicación real del proyecto. | `:50` URL fija; `:264` "Santiago, Chile" |
| `hooks/useGeofence.ts:206-222` | 🔵 | El handler de error de `watchPosition` maneja code 1 (denied) y 2 (unavailable) pero **NO code 3 (TIMEOUT)**. Con `timeout:5000` un GPS lento (mina profunda/indoor) deja `permissionState` pegado en `'pending'` y el trabajador no recibe el aviso "geocerca inactiva" que DEEP-B1 elogió para el caso denied. | `:212-221` solo code 1/2; `:223` timeout 5000 |
| `hooks/useBluetoothMesh.ts:44,48,94-97` | 🔵 | (a) Fallback a `{lat:0,lng:0}` cuando no hay last-known GPS (`:44,:48`) — puede persistir breadcrumbs en "null island" (contraste con `meshFallback` que DEEP-B1 elogió por evitarlo). (b) El scan nativo programa `setTimeout(stopLEScan, 10000)` (`:94`) sin cleanup en unmount ⇒ scan sigue si el componente desmonta antes. | `:44/:48` `{lat:0,lng:0}`; `:94-97` setTimeout sin clear |
| `components/emergency/EmergencyDashboard.tsx:145-147` | 🔵 | Botón "Solicitar Apoyo Externo" sin `onClick` (no-op) en banner de emergencia activa. | `:145` `<button ...>Solicitar Apoyo Externo</button>` sin handler |
| `components/emergency/IncidentInvestigation.tsx:65,197,208,221` | 🔵 | `handleSave`/render iteran `analysis.correctiveActions`/`immediateCauses`/`rootCauses` con `.map` sin null-guards; si el JSON de IA omite un array, `.map` lanza (mitigado por try/catch en save, pero el render `:197/:208/:221` sí puede romper la UI tras un análisis malformado). | `:65` for-of sin guard; `:197` `.map` directo |

---

## Confirmaciones relevantes (no nuevas — ya en DEEP-B1)
- `EmergencyOverlay.tsx:285,294`: "Estoy a salvo" + triage NO persisten (H2). Confirmado leyendo
  `handleSafeClick`/`handleTriage` — solo estado local + `setTimeout(resolveEmergency)`.
- `VectorialEvacuationMap.tsx:47-48`: rutas verdes son `<motion.path d="...">` hardcoded (H3).
  El dead-reckoning sí es real (`useDeadReckoning` correcto, bien limpiado).
- `DynamicEvacuationMap.tsx:18,49`: usa Gemini, no el A\* real (H3).
- Huérfanos confirmados sin importer externo: `EmergencyBrigadePanel`, `FirstResponderDispatchPanel`,
  `LoneWorkerAdminPanel`, `LoneWorkerCheckInWidget`, `RestrictedZonesMapOverlay`, `DrillResultReviewCard`;
  hooks `useComms`, `useCommsDrill`, `useContingencySimulation`, `useFirstResponderMap`,
  `useGeofencePermissions` (H4). Todos son código real y completo, solo sin punto de entrada.

## Notas de verificación cruzada
- `.Magnitud`/`.RefGeografica` en `EmergencyPlanGenerator.tsx:42` NO es bug: es la forma canónica
  del API sísmico usada en ≥6 archivos (SafetyForecast, PredictiveAnalysis, Telemetry, etc.).
- `mandown_events`/`emergency_messages`/`emergency_checkins`/`zone_violations` SÍ tienen reglas
  default-deny correctas con `incoming().workerId/senderId == request.auth.uid` (`firestore.rules:262-305`).
  El gate de propietario es sólido; el problema está solo en el field-allowlist de `projects` (hallazgo 🔴 #1).
- Imports muertos de `auth` (sin uso) en `useDrillsManager.ts:6`, `useEmergencyBrigade.ts:6` — 🔵 limpieza.
- Posible doc-vs-code: `useEvacuationHeadcount.subscribeToDrill:139-147` suscribe a
  `tenants/{tid}/projects/{pid}/evacuations/{id}` — verificar que coincide con el path que escribe
  `evacuationFirestoreAdapter.ts` (fuera de este lote); si difiere, la suscripción devuelve `null` sin error.

## Archivos limpios (sin hallazgos nuevos): 30/55
GeolocationTracker, SurvivalPing, WeatherSafetyRecommendations, EmergencyPlanGenerator,
EmergencySimulator, DrillResultReviewCard, DrillsCompliancePanel, CrisisChat, EmergencyAutoBridge,
FallDetectionMonitor (componente OK; bug está en el hook), FirstAidCards, GeofenceAlert, SOSButton,
SkillTree, TacticalSimulation3D (training, hardcoded aceptable), EvacuationDashboard,
EvacuationQRScanner, EvacuationStatusBoard, CalmRecommendationCard, ExternalEventsPanel,
FirstResponderDispatchPanel, LoneWorkerCard, LoneWorkerCheckInWidget, LoneWorkerAdminPanel,
RestrictedZonesMapOverlay, BunkerManager, useComms, useCommsDrill, useContingencySimulation,
useDeadReckoning, useDrillsManager, useEmergencyBrigade, useEvacuation, useEvacuationHeadcount,
useFallDetectionPreference, useFirstResponderMap, useGeofencePermissions.

---

## Resumen
Leídos **55/55** archivos línea por línea. **18 hallazgos NUEVOS**: **2 🔴**, **6 🟡**, **10 🔵**.
El bloque server-side sigue siendo sólido (confirmado por DEEP-B1); los hallazgos nuevos se concentran
en **componentes UI de emergencia** que parecen funcionales pero no persisten/no actúan, y en **fugas
de listeners/intervalos** en sensores vida-críticos.

Top 3:
1. 🔴 `firestore.rules:178-194` + `EmergencyCheckIn.tsx:115` — "Declarar Emergencia" del check-in
   **falla en silencio** porque `isEmergencyActive` no está en el allowlist `hasOnly` de `isValidProject`;
   ni siquiera un admin puede activar la emergencia por esa ruta, y el error se traga.
2. 🔴 `EmergencySquadManager.tsx:28-33` — escuadrón de emergencia entero es **mock hardcoded**
   ("Soporte Vital — No Responde") presentado como real dentro del dashboard de emergencia activa.
3. 🟡 `useAccelerometer.ts:47,90-103` + `FallDetectionMonitor.tsx:95` — **leak de listeners** en el
   detector de caídas por callback no memoizado; `removeEventListener` no matchea al añadido.
