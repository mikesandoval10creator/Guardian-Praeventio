# DEEP — B16 Offline/PWA/Capacitor/Mesh/Sensores · 2026-06-02

**Archivos revisados:** 56 (ledger `block=="B16-Offline"`) + ~10 vecinos por grep
(`MeshProvider.tsx`, `meshFallback.ts`, `conflictResolver.ts`, `syncStateMachine.ts`,
`AppProviders.tsx`, `firestore.rules`, `vite.config.ts`, `main.tsx`).

> 🛟🔐 Este bloque sostiene el SOS sin red (mesh BLE store-carry-forward) y el
> cifrado de datos en reposo on-device (SQLCipher). Dos hallazgos de seguridad
> de alta señal: (1) el "cifrado" del payload en IndexedDB/SQLite es base64, no
> cripto (defensa en profundidad ausente en web); (2) `conflict_queue` no tiene
> reglas Firestore ni consumidor — viola CLAUDE.md #4 (default-deny) si llega a
> usarse, hoy es código muerto. La SQLCipher real sí está bien implementada.

---

## 1. Lo que YA HACE (implementado y real)

- **Cifrado SQLite real (Regla #16)** — `sqliteEncryption.ts:64-76` usa el secure
  store NATIVO del plugin (`isSecretStored()` → `setEncryptionSecret()`),
  pasphrase de 256-bit vía `crypto.getRandomValues` (`:40-46`), NO via
  `@capacitor/preferences`. `offlineStorage.ts:77-90` y `pwa-offline.ts:66-78`
  abren la conexión con `createConnection(name, true, mode, 1, false)` — 2º arg
  `encrypted=true`, modo `'secret'`/`'encryption'`. Cumple Regla #16. Comentarios
  documentan dos fixes Codex (P1 3308579631/636 = plaintext silencioso; P1
  3308579640 = preferences-as-keychain). `capacitor.config.ts:87,93`
  `iosIsEncryption/androidIsEncryption: true` ahora SÍ coincide con runtime.
- **Plugin mesh nativo REAL, no stub** — `MeshPlugin.kt` (552 LOC) es BLE GATT
  Android completo: advertiser (`:267`), scanner+ScanFilter+dedupe (`:325`),
  GattServer char `mesh-data` WRITE_NO_RESPONSE chunks 512B (`:432`), GATT
  clients por peer (`:476`), reassembly por llaves JSON balanceadas (`:414`),
  permission gating API31+/≤30 (`:238`), watchdog peer-lost 30s (`:345`),
  teardown (`:535`). `Plugin.swift` (350 LOC) = CoreBluetooth equivalente
  (CBPeripheralManager+CBCentralManager, advertising, didReceiveWrite `:222`,
  sweep `:330`). `web.ts` = simulador BroadcastChannel honesto (declarado "NOT
  real BLE" `:16`).
- **Engine mesh pura y completa** — `meshPacket.ts` (content-addressed sha256 IDs,
  TTL/expiry, loop avoidance, priority SOS) + `meshRelayQueue.ts` (store-carry
  500-cap, dedup TTL 6h, drainForPeer con hop) + `meshRequestRouter.ts`
  (file_request → chunk → reconstruct) + `fileChunker.ts`. Todas con tests.
- **Mesh CABLEADO end-to-end** — `MeshProvider.tsx:70-127` construye
  `MeshRelayQueue` + `TransportFacade`, llama `startMesh()` y
  `registerMeshTransport(facade)` (cerró el gap Sprint 33 D3 donde quedaba
  `activeFacade=null`). Montado en `AppProviders.tsx:139`. Wire mesh→XP vía
  `makeRelayXpHandler()` (+50 XP por SOS rebroadcast, `meshRelayXpWire.ts:45`).
- **Sync offline real** — `OfflineSyncManager.tsx` drena `getPendingActions()`,
  hace per-field conflict detection (`detectConflicts`/`partitionFields`/LWW),
  audita resoluciones, y enruta campos críticos al drawer del supervisor vía
  `sync-critical-conflict`. Doble cola: legacy IDB + state machine
  (`syncStateMachine.ts`). Montado en `App.tsx:26,552` (lazy).
- **SensorBus correlación** — `sensorBus.ts` Zustand con 5 reglas declarativas
  (fall+inactivity+ble-off→urgent, hr+gas, wbgt+inactivity, noise+hr, panic),
  STALE 60s, NUNCA bloquea (directiva #2, `:18-19`). Consumido por
  SystemEngine/SensoryFatigueMonitor.
- **SensorContext** — Motion nativo + DeviceMotion/Orientation web, memoizado
  (`SensorContext.tsx:121`). Montado en `AppProviders.tsx:119`.
- **Service Worker / PWA** — VitePWA `autoUpdate` (`vite.config.ts:98`), workbox
  runtimeCaching para fonts/images + ruta CacheFirst para pesos SLM
  `/models/*.onnx` (`:180`), registro en `main.tsx:78`. FCM SW separado
  (`public/firebase-messaging-sw.js`).
- **syncQueueTracker** (engine puro: estados, backoff exponencial 30s×2^n,
  badges) + **server route `syncStatus.ts`** (5 ops, `verifyAuth` +
  `assertProjectMember` en cada una, errores tipados). Cumple Reglas #6.
- **AndroidManifest mesh** — permisos BLE 31+/legacy + Wi-Fi Direct + FGS
  `FOREGROUND_SERVICE_CONNECTED_DEVICE` declarados.

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔵 **`conflict_queue` SIN HOGAR Y SIN REGLAS** — `conflictQueue.ts` (238 LOC)
  es engine pura completa con tests, pero (a) NO tiene importadores fuera del
  test (`grep` confirma 0 consumidores), (b) NO existe `conflict_queue` en
  `firestore.rules` (grep = vacío). Es código muerto hoy; si se cablea sin
  añadir reglas + ≥5 rules-tests + entrada en `security_spec.md`, **viola
  CLAUDE.md #4 (default-deny)**. El JSDoc promete "escribe a Firestore
  `conflict_queue/{queueId}`" pero nadie lo hace. `OfflineSyncManager` aún usa
  el window-event `sync-critical-conflict`, no este queue persistente.
- ⚠️ **`encryptData` NO es cifrado** — `offlineStorage.ts:116-123`:
  `btoa(encodeURIComponent(JSON.stringify(data)))` es base64, reversible
  trivialmente. El campo se llama `_encryptedData` (`:135`) — naming engañoso.
  En SQLite móvil la capa real es SQLCipher (OK), pero en **web/IndexedDB el
  dato de workers/matrices/zettel queda en claro** (solo base64). No es la capa
  primaria de Regla #16 pero el nombre miente sobre la garantía.
- 🏚️ **`useSyncStatus.ts` + `SyncQueueBadge.tsx` huérfanos** — grep: 0
  consumidores `.tsx` no-test de `useSyncStatus`/`createSyncItemApi`/
  `SyncQueueBadge`. El engine y el server route existen, pero la UI que los
  expone al usuario no está montada. La "Estado Sincronización Visible"
  (Sprint 39 H.3) está a medio cablear: backend listo, badge sin renderizar.
- ⚠️ **Mesh packets nunca firmados/verificados** — `meshPacket.ts:237-238`
  hardcodea `signature: 'unsigned-dev'` / `signaturePublicKeyId: 'unsigned-dev'`.
  No hay sign/verify en runtime (grep mesh = 0 verifySignature). Un peer
  malicioso en proximidad puede inyectar SOS/file_chunk falsos. El campo
  `signature` del tipo es decorativo. ADR 0013 contempla "sign/verify
  integridad" (`meshPacket.ts:11`) pero está pendiente (Sprint 26 wire nunca
  llegó).
- 🟡 **`isSupervisor()` siempre false** — `meshRelayQueue.ts:311-315`: los
  packets `toUid:'supervisors'` nunca se entregan localmente porque el rol no
  está cableado (TODO Sprint 26).
- 🟡 **`unlockBlackBox` no-op en nativo** — `offlineStorage.ts:299-300` retorna
  sin hacer nada en plataforma nativa ("native unlock handled separately") —
  sin implementación nativa visible.
- 🟡 **Migración SQLite destructiva** — instalaciones dev preexistentes con
  datos plaintext NO abren en modo cifrado y requieren reinstall
  (`sqliteEncryption.ts:26-33`). Aceptable porque base de usuarios prod = 0,
  pero queda como deuda si hay testers con datos.

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| src/utils/sqliteEncryption.ts | 76 | ✅🔑 | sí | Secret SQLCipher en secure store nativo; passphrase 256-bit `:40`. Cumple Regla #16. |
| src/utils/offlineStorage.ts | 350 | 🟡 | sí | IDB+SQLite workers/matrices/zettel/queue/blackbox/breadcrumbs. ⚠️ `encryptData`=base64 `:116`; blackbox nativo va a tabla offlineQueue `:277` (no tabla propia); `unlockBlackBox` no-op nativo `:300`. |
| src/utils/pwa-offline.ts | 314 | ✅ | sí | pending_sync + ai_cache + bunker_knowledge; conflict shape `localUpdatedAt` ISO normalizado `:251`; SQLCipher init `:66-78`; `saveForSync` deprecado delega a state machine `:175`. |
| src/services/sync/conflictQueue.ts | 238 | 🔵 | NO | Engine pura de cola de conflictos críticos. Sin importadores, sin reglas Firestore. Viola #4 si se cablea. `deterministicQueueId :56`. |
| src/services/syncStatus/syncQueueTracker.ts | 228 | ✅ | parcial | Estados sync + backoff exp `:124-137` + badge `:212`. Engine OK; UI consumer huérfano. |
| src/server/routes/syncStatus.ts | 245 | ✅ | sí | 5 ops puras, `verifyAuth`+`assertProjectMember` en c/u `:92-242`. Cumple #6. |
| src/hooks/useSyncStatus.ts | 101 | 🏚️ | NO | Cliente HTTP de las 5 ops. 0 consumidores tsx no-test. |
| src/components/syncStatus/SyncQueueBadge.tsx | 94 | 🏚️ | NO | Badge UI; sin importadores no-test. |
| src/components/syncStatus/SyncQueueBadge.test.tsx | — | ✅ | test | Test del badge huérfano. |
| src/components/OfflineSyncManager.tsx | 350 | ✅ | sí | Drena cola, per-field conflict + LWW + audit `:77-110`, drawer crítico `:104`. Montado App.tsx:26. |
| src/components/OfflineIndicator.tsx | 119 | ✅ | sí | Banner online/offline; montado App.tsx:552. |
| src/contexts/SensorContext.tsx | 139 | ✅ | sí | Motion nativo+web, memo `:121`. Montado AppProviders:119. |
| src/services/sensorBus/sensorBus.ts | 348 | ✅ | sí | Zustand 5 reglas correlación, no bloquea `:18`. |
| src/providers/MeshProvider.tsx | 131 | ✅ | sí | Construye queue+facade, `registerMeshTransport` `:110`. Montado AppProviders:139. |
| src/services/mesh/transportFacade.ts | 240 | ✅ | sí | Une engine a plugin Capacitor; reconcile 30s `:185`; native/web auto `:78`. |
| src/services/mesh/meshRelayQueue.ts | 316 | ✅ | sí | Store-carry-forward, dedup, drainForPeer hop `:195`. ⚠️ `isSupervisor` siempre false `:311`. |
| src/services/mesh/meshPacket.ts | 366 | 🟡 | sí | Modelo+helpers; ⚠️ `signature:'unsigned-dev'` hardcoded `:237`, nunca verificado. |
| src/services/mesh/meshRequestRouter.ts | 342 | ✅ | sí | Lifecycle file_request→chunk→reconstruct `:176-318`. |
| src/services/mesh/fileChunker.ts | 80 | ✅ | sí | chunkBlob/reconstructBlob puros. |
| src/services/mesh/meshRelayXpWire.ts | 68 | ✅ | sí | SOS rebroadcast → awardXp +50, fire-and-forget `:45`. |
| packages/capacitor-mesh/android/.../MeshPlugin.kt | 552 | ✅ | sí | BLE GATT REAL Sprint 46 (advertiser/scanner/gattServer/clients). NO stub. |
| packages/capacitor-mesh/ios/Plugin.swift | 350 | ✅ | sí | CoreBluetooth REAL Sprint 46. NO stub. |
| packages/capacitor-mesh/src/web.ts | 240 | ✅ | sí | Simulador BroadcastChannel (honesto: "NOT real BLE" `:16`). |
| packages/capacitor-mesh/src/{index,definitions}.ts | 69+ | ✅ | sí | Registro plugin + tipos contractuales. |
| packages/capacitor-mesh/android/AndroidManifest.xml | — | ✅ | sí | Permisos BLE 31+/legacy + Wi-Fi Direct + FGS. Header dice "SCAFFOLD" (drift: el .kt ya es real). |
| src/hooks/useSlmOffline.ts | 202 | ✅ | sí | Política Gemini→ONNX SLM fallback offline `:136-199`. |
| src/utils/offlineKnowledge.ts | 125 | ✅ | sí | Base de conocimiento offline (altura/confinados/EPP) + Fuse search + idb-keyval cache. |
| public/data/guardian-offline-corpus.json | — | ✅ | sí | Corpus RAG offline (asset). |
| public/firebase-messaging-sw.js | — | ✅ | sí | SW de FCM (sustitución __VITE_FIREBASE_*__ en build). |
| capacitor.config.ts | 133 | ✅🔑 | sí | `iosIsEncryption/androidIsEncryption:true` `:87,93` coincide con runtime. |
| docs/architecture-decisions/0013-mesh-information-relay.md | — | ✅ | doc | ADR del mesh (contempla sign/verify aún pendiente). |
| docs/offline-sync.md | — | ✅ | doc | Doc de sync offline. |
| infra/photogrammetry-worker/poisson-mesh.py | — | ✅ | infra | "mesh" 3D photogrammetry — NO relacionado al mesh BLE (falso positivo del bloque). |
| android/* (build.gradle, settings.gradle, ExampleTests) | — | ✅ | build | Capacitor build scaffolding + tests de ejemplo generados. |
| tests/e2e/offline-resilience.spec.ts | — | ✅ | test | Playwright resiliencia offline. |
| *.test.ts(x) (fileChunker/meshPacket/meshRelayQueue/relayXp/meshRequestRouter/transportFacade/sensorBus/conflictQueue/syncQueueTracker/offlineStorage/pwa-offline/sqliteEncryption/syncStatus) | — | ✅ | test | Cobertura de engines (la mayoría puros). |

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **`conflict_queue` — decidir destino.** Opciones: (a) cablearlo
  correctamente añadiendo reglas en `firestore.rules` + ≥5 rules-tests +
  `security_spec.md` (CLAUDE.md #4) y un consumer real en `OfflineSyncManager`;
  o (b) borrar el módulo si se descarta. Hoy es 238 LOC de código muerto con
  tests verdes que dan falsa sensación de cobertura.
- ⚠️ **`encryptData` base64 en web.** ¿Aceptar que IndexedDB en web guarda
  workers/matrices/zettel sin cifrado real (solo base64 con campo mal llamado
  `_encryptedData`)? Si la app web maneja PII de trabajadores offline, esto es
  una brecha de datos-en-reposo. Renombrar a `_encodedData` como mínimo, o
  cifrar con WebCrypto + clave derivada.
- ⚠️ **Mesh sin firma criptográfica.** ¿Es aceptable para v1 que un peer BLE
  malicioso inyecte SOS/eventos/chunks falsos sin verificación? El SOS es la
  ruta crítica (🛟). Decidir si Sprint de firma ed25519 (ADR 0013 lo contempla)
  es bloqueante antes de release móvil.
- ❓ **`SyncQueueBadge`/`useSyncStatus` huérfanos.** ¿Montar la UI de estado de
  sync (Sprint 39 H.3 dejó backend+engine listos pero sin renderizar el badge)?
- ❓ **Header AndroidManifest dice "SCAFFOLD"** mientras `MeshPlugin.kt` ya es
  BLE real (Sprint 46). Drift doc-vs-code menor — actualizar comentario.
