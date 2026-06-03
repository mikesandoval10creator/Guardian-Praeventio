# DEEP-EX #8 — B16-Offline [0:30] · 2026-06-02

**Atestación:** leídos 30/30 línea por línea.

Lote derivado de `ledger.json` (`category` empieza con "FEAT" && `block=="B16-Offline"`,
orden por `path`, slice [0:30] = los 30 del bloque). No repite hallazgos de
`DEEP-B16-Offline.md` (que cubrió cifrado SQLCipher, mesh nativo, `encryptData`
base64, `conflict_queue` sin reglas, mesh sin firma, `isSupervisor` siempre false,
huérfanos `useSyncStatus`/`SyncQueueBadge`). Aquí solo NUEVOS, centrados en colas
que pierden datos de seguridad, integridad mesh, `Math.random` en IDs (#15), y
`require()` en ESM.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/services/sync/syncStateMachine.ts:313-322` | 🔴 | **Cola central descarta operaciones tras 6 intentos — pérdida silenciosa.** `syncNow()` hace `this.operations.delete(op.id)` al superar `MAX_ATTEMPTS=6`. No hay dead-letter queue ni escalación; solo `logger.error`. `saveForSync()` (pwa-offline) delega aquí, así que un incidente/evidencia encolado offline que falle 6 veces (p.ej. doc rechazado por rules transitoriamente) se borra para siempre. A diferencia del `sosOutbox.ts` dedicado (fuera del lote), que marca `gave_up` y conserva el registro. | `if (updated.attempts >= MAX_ATTEMPTS) { logger.error('...dropping'...); this.operations.delete(op.id); }` |
| `src/services/sync/syncStateMachine.ts:100` | 🟡 | **`Math.random()` en generación de ID — viola CLAUDE.md #15.** Fallback de `makeOpId()` usa `Math.random().toString(36)`. #15 prohíbe `Math.random()` en "ID-generation code"; debe usar `randomId()` de `src/utils/randomId.ts` (existe, verificado). El opId colisionable degrada el dedup por id de la cola offline. | `return \`op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}\`;` |
| `src/services/sync/genericOutboxEngine.ts:248-262` | 🔴 | **Engine genérico purga eventos `critical` tras TTL (7d) o 20 reintentos — solo telemetría.** El JSDoc dice "Generaliza el patrón de sosOutbox a cualquier dominio" y lista SOS/fallDetected como `critical`. `flush()` borra (`deleteEntry`) cualquier entry con `retryCount>=maxRetries` o `ageMs>ttlMs`, emitiendo `expired_purged` sin persistir ni escalar. Si alguna feature de seguridad lo cablea para SOS, los eventos se pierden. Mitigante: hoy es **código muerto** (0 consumidores no-test, verificado por grep) — el SOS real usa `sosOutbox.ts`. Riesgo latente si se cablea. | `if (ttlExpired \|\| retriesExceeded) { await this.config.adapter.deleteEntry(...); this.emit({kind:'expired_purged'...}); }` |
| `src/services/sync/conflictQueue.ts:67-69` | 🟡 | **`require()` CommonJS dentro de módulo ESM — crash en bundle browser.** `deterministicQueueId` hace `require('@noble/hashes/sha2.js')`. Vite/ESM no define `require` en cliente → `ReferenceError` en runtime si este módulo se ejecuta en el browser. Otros módulos del bloque (`meshPacket.ts:24`, `syncQueueTracker.ts:20`) importan `@noble/hashes` con `import` precisamente por esto. Hoy mitigado porque `conflictQueue` sigue siendo código muerto (0 consumidores, confirma audit previo + grep), pero es una bomba si se cablea. | `const { sha256 } = require('@noble/hashes/sha2.js');` (línea 67) |
| `src/services/mesh/meshRequestRouter.ts:292-317` | 🟡 | **Reconstrucción de archivo sin verificar `contentHash` — chunks falsificables.** `handleIncomingFileChunk` acumula chunks y reconstruye el Blob cuando `receivedChunks.size === totalChunks`, llamando `onFileComplete(record)` SIN comparar el contenido reconstruido contra `record.contentHash` ni el `payload.contentHash` recibido. Un peer mesh malicioso (los packets van `signature:'unsigned-dev'`, sin verificación — audit previo) puede entregar chunks adulterados de un procedimiento/permiso y la víctima los acepta como genuinos. El `contentHash` ya está disponible en el payload pero no se usa para integridad. | `record.reconstructedFile = reconstructBlob(ordered, 'application/octet-stream'); record.state = 'complete'; this.onFileComplete(record);` (sin hash check) |
| `src/services/sensorBus/sensorBus.ts:313` | 🟡 | **`pendingAlerts.slice(-100)` puede descartar alertas `urgent` no-acknowledged.** `publishReading` recorta a `PENDING_ALERTS_LIMIT=100` los más recientes; si entran >100 alertas antes de que un supervisor haga `acknowledgeAlert`, las MÁS ANTIGUAS se evictan sin distinción de escalación. Una alerta `urgent` (lone-worker-panic, fall+inactivity+ble-off) puede desaparecer del estado antes de que alguien la vea. El cap debería preservar `urgent` sobre `recommend`. | `pendingAlerts: [...state.pendingAlerts, ...emitted].slice(-PENDING_ALERTS_LIMIT)` |
| `src/services/mesh/meshRelayQueue.ts:82 + 124-126 / 146-148` | 🔵 | **Ventana de dedup (6h) << lifetime SOS (48h) → posible re-procesamiento.** `DEFAULT_DEDUP_TTL_MS=6h` mientras `DEFAULT_LIFETIME_MS_BY_TYPE.sos=48h` (meshPacket.ts:152). `cleanup()` borra IDs de `seenIds` tras 6h; un packet SOS todavía vivo a las 7-48h reaparecido por un peer ya no está en `seenIds` → se re-`enqueue`/re-`forLocal` y re-relaya. No es pérdida de datos pero genera relays duplicados y re-XP por el mismo SOS. Alinear dedupTtl ≥ lifetime máximo. | `DEFAULT_DEDUP_TTL_MS = 6h` vs `sos: 48h`; `receive()` re-procesa si `!seenIds.has(packet.id)` |
| `src/services/mesh/meshPacket.ts:262-272` | 🔵 | **`shouldRelay` re-relaya unicast no-ack dirigido al receptor.** Para `event_to_supervisor`/`file_chunk` con `toUid===receiverUid`, `shouldRelay` retorna true (solo excluye el caso `type==='ack'`). El destinatario legítimo además re-difunde el packet que era para él — amplificación innecesaria de tráfico mesh (consume el escaso ancho de banda BLE en el camino crítico SOS). Solo broadcast/supervisors deberían re-relayar tras consumir. | `if (packet.toUid === receiverUid && packet.type === 'ack') return false; return true;` |

## Archivos limpios: 21

Sin hallazgos nuevos accionables (engines puros correctos, hooks delgados,
auth/validate presentes):
`OfflineIndicator.tsx`, `OfflineSyncManager.tsx`, `ConflictResolutionDrawer.tsx`
(role-gate admin/gerente correcto), `SyncQueueBadge.tsx`, `useDeduplication.ts`,
`useEventReplay.ts`, `usePendingActions.ts`, `useReconciliationStatus.ts`,
`useSlmOffline.ts`, `useSyncState.ts`, `useSyncStatus.ts`,
`server/routes/syncStatus.ts` (verifyAuth+assertProjectMember en c/u, errores
tipados), `server/sync/distributedLock.ts` (runTransaction correcto, crypto.randomUUID,
release best-effort), `fileChunker.ts`, `meshRelayXpWire.ts`, `transportFacade.ts`,
`conflictResolver.ts` (los 5 doc types siempre-humano correctos), `outboxBackoff.ts`,
`monotonicSync.ts`, `topologyAwarePrefetch.ts`, `syncManager.ts`
(`MatrixSyncManager` NUNCA descarta ops — reference-identity guard correcto;
el `Math.random()` en `:274` es jitter de backoff, NO ID, por lo que #15 no aplica;
`encryptedOutboxAdapter.ts` usa `encryptEnvelope`/`deviceKek` AES-GCM real, cifrado
genuino — distinto del base64 de `offlineStorage`).

---

### Resumen (para el usuario)

Leí los 30 archivos del lote B16-Offline línea por línea. El bloque sostiene el
SOS sin red; los hallazgos nuevos se concentran en **colas que pierden datos**.
Dos 🔴: (1) `syncStateMachine.ts:313` descarta SILENCIOSAMENTE operaciones offline
tras 6 reintentos (sin dead-letter ni escalación) y `saveForSync()` enruta aquí
incidentes/evidencia — pérdida real; (2) `genericOutboxEngine.ts:248` purga eventos
`critical` (SOS según su propio JSDoc) tras 7d/20-retries — hoy es código muerto,
pero bomba latente si se cablea. El SOS real (`sosOutbox.ts`, fuera del lote)
está bien: marca `gave_up` sin borrar. Tres 🟡 relevantes: `Math.random()` en
ID-gen de la cola (viola #15, fix trivial con `randomId()`); `require()` CommonJS
en `conflictQueue.ts` (crashea en browser si se cablea); y `meshRequestRouter`
reconstruye archivos mesh **sin verificar contentHash**, aceptando chunks
falsificables de peers no firmados. Otro 🟡: `sensorBus` puede evictar alertas
`urgent` no-acknowledged al recortar a 100. Dos 🔵 de mesh: dedup 6h vs SOS-48h
(re-relay duplicado) y `shouldRelay` amplifica unicast. 21 archivos limpios;
notable que `encryptedOutboxAdapter` SÍ usa cifrado AES-GCM real (no base64) y
`MatrixSyncManager` nunca pierde ops. Doc-only, sin git commit.
