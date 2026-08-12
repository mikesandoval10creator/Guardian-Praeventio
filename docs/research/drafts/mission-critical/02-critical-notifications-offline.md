# Notificaciones críticas y resiliencia offline-first en Guardian Praeventio

> **Borrador de investigación** — Ticket `3a3aa66d-73fe-8196-b5aa-de61e48f3641`
> Base commit: `09349d1f` · Fecha: 2026-08-12
> Metodología: lectura de código fuente (file:line citado) + fuentes oficiales (FCM/APNs/Firestore docs)
> **No modificar producción, Notion ni git.**

---

## Tabla de fuentes consultadas

| #      | Fuente                                                                     | URL canónica                                                                                                                   | Método                                                 | Fecha de consulta |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------- |
| S1     | FCM: Cómo establecer y administrar la prioridad de los mensajes de Android | <https://firebase.google.com/docs/cloud-messaging/android/message-priority>                                                    | `browser_navigate` + extracción `article.innerText`    | 2026-08-12        |
| S2     | FCM: Limitación y cuotas                                                   | <https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas>                                                       | `browser_navigate` + extracción `article.innerText`    | 2026-08-12        |
| S3     | Apple Developer: Critical Alerts Entitlement                               | <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts> | `browser_navigate` + extracción `main.innerText`       | 2026-08-12        |
| S4     | Firestore: Accede a datos sin conexión                                     | <https://firebase.google.com/docs/firestore/manage-data/enable-offline>                                                        | `browser_navigate` + extracción `article.innerText`    | 2026-08-12        |
| S5     | Firebase Admin Node.js SDK: `sendEachForMulticast`                         | <https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.messaging>                                     | `web_search` (snippet verificado contra release-notes) | 2026-08-12        |
| C1–C12 | Código fuente Guardian Praeventio (commit `09349d1f`)                      | file:line en cada sección                                                                                                      | `read_file`                                            | 2026-08-12        |

---

## 1. Semánticas y límites de FCM (Firebase Cloud Messaging)

### 1.1 Prioridad de mensajes en Android

FCM define dos prioridades para mensajes descendentes:

> **"Prioridad alta. FCM intenta entregar los mensajes de alta prioridad de inmediato, lo que permite a FCM activar un dispositivo inactivo cuando es necesario y ejecutar un procesamiento limitado (incluido el acceso de red altamente limitado)."**
> — S1, <https://firebase.google.com/docs/cloud-messaging/android/message-priority>

> **"elige la prioridad alta cuando necesites garantizar la entrega inmediata de asuntos o acciones urgentes."**
> — S1, ibíd.

**Reducción de prioridad (deprioritización):** FCM monitorea 7 días de comportamiento por instancia de app:

> **"Si FCM detecta un patrón en el que los mensajes no generan notificaciones para el usuario, es posible que la prioridad de tus mensajes no sea la normal o que se deleguen para que los Servicios de Google Play los manejen."**
> — S1, ibíd.

**Implicación para Guardian:** Las alertas críticas (SOS, evacuación, hombre caído) SIEMPRE generan notificaciones visibles al usuario, por lo que cumplen el criterio de FCM para no ser depriorizadas. El código lo garantiza: el canal `praeventio_emergency` tiene `importance: 4` (IMPORTANCE_HIGH) — `src/services/notifications/criticalNotificationChannel.ts:34-43`.

### 1.2 Cuotas y throttling

> **"La API de HTTP v1 introdujo cuotas por proyecto y por minuto para la mensajería downstream. La cuota predeterminada de 600,000 mensajes por minuto abarca a más del 99% de los desarrolladores de FCM."**
> — S2, <https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas>

> **"En Android, puedes enviar hasta 240 mensajes por minuto y 5,000 mensajes por hora a un solo dispositivo."**
> — S2, ibíd.

> **"En iOS, se muestra un error cuando la tasa supera los límites de APNS."**
> — S2, ibíd.

**Implicación para Guardian:** El volumen de alertas críticas (decenas a cientos de supervisores por incidente, no millones) está varios órdenes de magnitud por debajo de la cuota de 600k/min. El riesgo de throttling es despreciable en el contexto operacional actual.

### 1.3 API utilizada: `sendEachForMulticast`

El código usa `messaging.sendEachForMulticast()` — `src/server/triggers/backgroundTriggers.ts:715` y `src/server/routes/emergency.ts:172-195`. Esta API reemplazó a la obsoleta `sendMulticast` (que usaba la API legacy HTTP/1.1) y envía cada token individualmente vía HTTP v1:

> **"Added HTTP/2 support for `sendEach()` and `sendEachForMulticast()`."**
> — S5, Firebase Admin Node.js SDK Release Notes, <https://firebase.google.com/support/release-notes/admin/node>

Cada token se envía como un mensaje individual; `successCount`/`failureCount` se reportan por token. Esto significa que un token inválido NO bloquea la entrega a los demás.

---

## 2. Semánticas y límites de APNs (Apple Push Notification service)

### 2.1 Prioridad APNs

APNs define dos niveles de prioridad mediante el header `apns-priority`:

- **`10`** — Entrega inmediata. Apropiado para notificaciones que disparan una alerta, sonido o badge.
- **`5`** — Entrega conservadora de batería. El mensaje puede retrasarse.

### 2.2 Critical Alerts (entitlement requerido)

Apple exige un entitlement especial para que las notificaciones críticas suenen incluso en modo No Molestar:

> **"An entitlement that permits an app to receive critical alert notifications. [...] If your app has this entitlement, then it can request criticalAlert authorization to receive push notifications that cause the system to play a sound even when the app is locked, muted, or a person uses Do Not Disturb focus."**
> — S3, <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts>

**Key:** `com.apple.developer.usernotifications.critical-alerts`

### 2.3 Payload de Critical Alert en Guardian

La ruta de emergencia directa construye el payload APNs con prioridad 10 y Critical Alert:

```typescript
// src/server/routes/emergency.ts:172-195 (C5)
export function buildEmergencyMulticastMessage(
  tokens: string[],
  payload: EmergencyPushPayload,
): admin.messaging.MulticastMessage {
  return {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: { priority: "high" },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
        "apns-expiration": "0",
      },
      payload: {
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: { critical: true, name: "default", volume: 1 },
        },
      },
    },
  };
}
```

Esto es correcto y cumple con la especificación de Apple: `apns-priority: '10'` para entrega inmediata y `sound.critical: true` para bypass de No Molestar (sujeto al entitlement `com.apple.developer.usernotifications.critical-alerts`).

---

## 3. Entrega confiable: outbox transaccional, idempotencia y retry

### 3.1 Patrón outbox transaccional (servidor)

Guardian implementa un outbox transaccional en Firestore para alertas críticas. El diseño separa **provisionamiento** (congelar el payload) de **entrega** (enviar FCM/email con retry):

**Create-once atómico** — `src/server/triggers/criticalAlertOutbox.ts:70-86` (C1):

```typescript
export function createCriticalAlertOutbox(args): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return false;  // segunda instancia no sobreescribe
    tx.create(ref, { status: 'pending', attempts: 0, payload, ... });
    return true;
  });
}
```

**Claim con lease** — `src/server/triggers/criticalAlertOutbox.ts:107-136` (C1):

- Estado `pending` → `processing` con lease binario (`leaseUntilMs`)
- Si el lease está vivo, el segundo worker recibe `{ kind: 'leased' }` y no compite
- `claimBackgroundWork` usa `tx.create` fuerte-atómico cuando se provee `claimRef` — `src/server/triggers/backgroundTriggerClaim.ts:92-113` (C2)

**Sent/Failed/Dead-letter** — `src/server/triggers/criticalAlertOutbox.ts:152-225` (C1):

- `markOutboxSent`: solo se marca `sent` si ≥1 canal entregó (FCM o email). Verifica `claimToken` para que un worker stale no marque.
- `markOutboxFailed`: backoff exponencial `base * 2^(attempts-1)` → `backoffBaseMs`, `2x`, `4x`, `8x`… (`criticalAlertOutbox.ts:214`)
- Dead-letter tras `CRITICAL_OUTBOX_MAX_ATTEMPTS = 12` (`criticalAlertOutbox.ts:10`)

**Invariante de vida-seguridad** — `src/server/triggers/backgroundTriggers.ts:677-682` (C3):

> El mirror en el nodo original (`_criticalAlertSentAt`) se escribe SOLO cuando el worker llega a `sent`, nunca antes. Una alerta no entregada jamás se reporta como enviada.

### 3.2 Worker de entrega del outbox

`src/server/triggers/criticalAlertOutboxWorker.ts:42-147` (C4):

1. Claim → leer payload congelado → enviar FCM multicast → enviar email
2. Si `fcmDelivered > 0 || emailDelivered` → `markOutboxSent` + `mirrorNodeSent`
3. Si 0 canales entregaron → `markOutboxFailed` (backoff o dead-letter)
4. Claim perdido mid-flight → terminal no-op (`kind: 'completed'`)

**Parámetros de producción** — `backgroundTriggers.ts:710-714` (C3):

- `leaseMs: 2 * 60 * 1000` (2 minutos)
- `backoffBaseMs: 60_000` (base de 60s → 60s, 120s, 240s, …)
- `maxAttempts: 12`
- Tiempo máximo teórico de reintento: ~60 × (2^12 − 1) ≈ 68 horas

### 3.3 Idempotencia server-side (middleware Express)

`src/server/middleware/idempotencyKey.ts` (C6) — patrón Stripe:

> Comentario del archivo (líneas 1-10): _"a client may attach `Idempotency-Key: <opaque-token>` to any mutating route opt-in to the middleware. The first request executes the handler and we cache the resulting (status + headers + body) keyed by `(uid|tenantId, key)` for `ttlSec` seconds (default 24 h)."_

**Semánticas clave:**

- **Header ausente → pasa sin caching** (legacy clients) — `idempotencyKey.ts:215-217`
- **Misma key + mismo body → replay** (status + body + headers) — `idempotencyKey.ts:278-303`
- **Misma key + body distinto → 422** (`idempotency_key_reused_with_different_params`) — `idempotencyKey.ts:279-287`
- **Non-2xx NO se cachea** — el cliente puede reintentar contra estado fresco — `idempotencyKey.ts:316`
- **Cache en Firestore** (`system_idempotency_cache`) con TTL policy — `idempotencyKey.ts:71`

**Test de la ruta SOS** — `src/__tests__/server/emergency.sos.idempotency.test.ts:170-199` (C7):

> Un SOS reintentado con el mismo `Idempotency-Key` crea exactamente UN alerta y UN fan-out, y replaya el mismo `alertId`. El header `Idempotent-Replayed: true` se devuelve en la segunda llamada.

### 3.4 Mutex por entidad (prevención de doble-procesamiento)

`src/server/triggers/backgroundTriggers.ts:67-111` (C3) — `serializeByKey`:

> Serializa llamadas concurrentes con la MISMA key (FIFO), mientras diferentes keys corren en paralelo. Previene: doble embedding RAG, doble burst FCM, doble post-mortem.

---

## 4. Offline-first: almacenamiento local y resincronización

### 4.1 Guía de plataforma: Firestore offline

> **"Cloud Firestore admite la persistencia de datos sin conexión. Esta función almacena en caché una copia de los datos de Cloud Firestore que usa la app de forma activa, de modo que esta pueda acceder a los datos cuando el dispositivo no tenga conexión."**
> — S4, <https://firebase.google.com/docs/firestore/manage-data/enable-offline>

> **"En las plataformas de Android y Apple, la persistencia sin conexión está habilitada de forma predeterminada."**
> — S4, ibíd.

> **"En la Web, la persistencia sin conexión está inhabilitada de forma predeterminada. Para habilitar la persistencia, llama al método `enablePersistence`."**
> — S4, ibíd.

> **"Cuando el dispositivo vuelve a estar en línea, Cloud Firestore sincroniza los cambios locales que la app realizó en el backend. En el caso de varios cambios en el mismo documento, gana la última escritura."**
> — S4, ibíd.

### 4.2 Almacenamiento offline de Guardian

Guardian implementa almacenamiento offline dedicado más allá del cache de Firestore, con cifrado AES-256-GCM:

**Capa de persistencia** — `src/utils/offlineStorage.ts` (C8):

- **Native (iOS/Android):** SQLite cifrado vía `@capacitor-community/sqlite` con `encrypted: true` — `offlineStorage.ts:92`
- **Web:** IndexedDB con cifrado AES-256-GCM (`offlineCrypto.ts`) — `offlineStorage.ts:120-127`
- **Cola offline:** `offlineQueue` store (IDB) / tabla (SQLite) — `offlineStorage.ts:50-51, 101`
- **Caja negra biométrica:** dump telemétrico inmutable para ManDown — `offlineStorage.ts:255-273`
- **Breadcrumbs:** últimas 50 posiciones GPS para rescate — `offlineStorage.ts:299-316`

### 4.3 SOS outbox offline-first (cliente)

`src/services/emergency/sosOutbox.ts` (C9) — el botón SOS NO depende de red:

**Diseño:**

- Persistencia local inyectable (IndexedDB en producción vía adapter)
- Idempotencia por `clientEventId` (UUID del cliente) — `sosOutbox.ts:31-32, 148-153`
- Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s, cap 60s — `sosOutbox.ts:78-81`
- `MAX_RETRY = 6`, `MAX_QUEUE_SIZE = 50` — `sosOutbox.ts:70-71`
- **Dead-letter NUNCA se descarta** — se retiene y la UI lo expone — `sosOutbox.ts:196-228`

**Mutex de serialización** — `sosOutbox.ts:129-142`:

> `runExclusive` encadena load→modify→save para que un `flush()` (que bloquea en `send()`) y un `enqueue()` concurrente no sobreescriban con estado stale → SOS PERDIDO.

### 4.4 Outbox genérico para reportes de incidentes

`src/services/incidents/incidentOutbox.ts` (C10) — usa `GenericOutboxEngine`:

- Persistence: IndexedDB (`idb-keyval`) — `incidentOutbox.ts:31, 52-87`
- Sender: POST `/api/incidents/report` con `Idempotency-Key: clientEventId` — `incidentOutbox.ts:98-115`
- **Regla de honestidad:** el sender NUNCA retorna `permanent_failure` — todo fallo es `retry` hasta dead-letter — `incidentOutbox.ts:18-23`
- Drain en app-start + reconexión (`online` event) — `incidentOutbox.ts:170-189`

### 4.5 State machine de sincronización offline

`docs/offline-sync.md` (C11) documenta `OfflineSyncStateMachine`:

- Cola única persistida en IndexedDB (`idb-keyval`)
- Backoff exponencial con give-up tras 6 intentos: 1s → 5s → 30s → 5min → 30min → drop
- Deduplicación last-write-wins por `${collection}:${type}:${docId}`
- Estados: `online_synced`, `online_syncing`, `online_failed`, `offline_queued`, `offline_idle`, `reconnecting`

### 4.6 Canal de notificación de emergencia (Android)

`src/services/notifications/criticalNotificationChannel.ts` (C12):

- Canal dedicado `praeventio_emergency` con `importance: 4` (IMPORTANCE_HIGH) — heads-up + sonido
- `visibility: 1` (VISIBILITY_PUBLIC) — legible en lock screen sin desbloquear
- Detección de "alertas críticas desactivadas": `getCriticalAlertStatus` falla cerrado (`enabled: false` si no puede leer) — `criticalNotificationChannel.ts:98-107`
- **Muro de plataforma honesto:** `setBypassDnd(true)` NO está expuesto por `@capacitor/push-notifications` — `criticalNotificationChannel.ts:17-22`

---

## 5. Brechas medidas (gaps reales contra fuentes oficiales)

### GAP-1: El worker del outbox NO envía APNs priority/critical-alert headers

**Severidad: MEDIA (iOS)**

La ruta de emergencia directa (`/api/emergency/sos`) construye el payload APNs completo:

```
apns-priority: '10', apns-push-type: 'alert', sound: { critical: true, ... }
```

— `src/server/routes/emergency.ts:181-193` (C5)

Pero el **worker del outbox** en `backgroundTriggers.ts:714-721` (C3) solo envía:

```typescript
sendFcmMulticast: async (msg) => {
  const r = await messaging.sendEachForMulticast({
    tokens: msg.tokens,
    notification: { title: msg.title, body: msg.body },
    data: { projectId: msg.projectId, nodeId: msg.nodeId },
    android: { priority: 'high' },
    // ← NO apns block, NO apns-priority, NO critical sound
  });
```

**Impacto:** Una alerta crítica que se enruta por el outbox (incidente creado en Firestore → trigger → outbox → worker) se entrega a dispositivos iOS SIN prioridad 10 y SIN bypass de No Molestar. En Android funciona (`android.priority: 'high'`), pero en iOS la entrega puede ser diferida y NO sonará si el supervisor tiene el teléfono en silencio o No Molestar.

**Causa raíz:** El worker del outbox fue un cambio "quirúrgico" (comentario explícito en `backgroundTriggers.ts:726-730`) que delega el envío FCM inline en lugar de reutilizar `buildEmergencyMulticastMessage()`.

### GAP-2: El worker del outbox NO envía email CPHS

**Severidad: BAJA (canal secundario)**

`backgroundTriggers.ts:723-731` (C3):

```typescript
sendCphsEmail: async (...) => {
  // El worker de outbox reutiliza el envío CPHS de la capa de servicio;
  // en esta primera integración conservamos la lógica de email fuera del
  // scope de outbox para mantener el cambio quirúrgico.
  return false;  // ← email siempre "falla"
},
```

El outbox requiere `fcmDelivered > 0 || emailDelivered` para marcar `sent` — `criticalAlertOutboxWorker.ts:113`. Con email siempre `false`, la entrega depende exclusivamente de FCM. Si todos los tokens FCM están inválitos, el outbox hace backoff y eventualmente dead-letter, sin que el canal de email haya siquiera intentado entregar.

### GAP-3: `setBypassDnd(true)` no implementado en Android

**Severidad: MEDIA (Android)**

`criticalNotificationChannel.ts:17-22` (C12) reconoce honestamente:

> _"true Do-Not-Disturb override (`setBypassDnd(true)`) is NOT exposed by @capacitor/push-notifications — its Channel type has no bypassDnd field."_

IMPORTANCE_HIGH entrega heads-up + sonido, pero NO bypassa No Molestar. Un trabajador que active No Molestar no recibirá sonido de alerta crítica en Android. Esto requiere una adición nativa delgada y verificación en dispositivo.

### GAP-4: Sin entitlement de Critical Alerts configurado (iOS)

**Severidad: ALTA (iOS, pendiente de verificación)**

Apple requiere el entitlement `com.apple.developer.usernotifications.critical-alerts` (S3) para que `sound: { critical: true }` funcione. El payload lo envía correctamente (`emergency.ts:190`), pero no se encontró evidencia en el repositorio (en este commit) de que el entitlement esté aprovisionado en el provisioning profile de iOS. Sin el entitlement, iOS ignora silenciosamente `sound.critical` y entrega la notificación como alerta normal (sin bypass de No Molestar ni volumen forzado).

**Nota:** Esto requiere verificación contra Apple Developer Portal / `ios/` entitlements, que está fuera del scope de este análisis de código.

---

## 6. Resumen de evidencia de cumplimiento

| Estándar                                             | Estado en Guardian        | Evidencia (file:line)                                                   |
| ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| FCM `android.priority: 'high'` para alertas críticas | ✅ Implementado           | `emergency.ts:180`, `backgroundTriggers.ts:719`                         |
| APNs `apns-priority: '10'` para alertas críticas     | ⚠️ Solo ruta directa      | `emergency.ts:183`; **FALTA en outbox** `backgroundTriggers.ts:714-721` |
| APNs Critical Alert sound                            | ⚠️ Solo ruta directa      | `emergency.ts:190`; **FALTA en outbox**                                 |
| APNs Critical Alert entitlement                      | ❓ Pendiente verificación | Requiere Apple Developer Portal                                         |
| Outbox transaccional create-once                     | ✅ Implementado           | `criticalAlertOutbox.ts:70-86`                                          |
| Claim con lease fuerte-atómico                       | ✅ Implementado           | `backgroundTriggerClaim.ts:92-113`                                      |
| Backoff exponencial con dead-letter                  | ✅ Implementado           | `criticalAlertOutbox.ts:186-225`                                        |
| Idempotencia server-side (middleware)                | ✅ Implementado           | `idempotencyKey.ts:200-369`                                             |
| Idempotencia por clientEventId (cliente)             | ✅ Implementado           | `sosOutbox.ts:148-153`, `incidentOutbox.ts:103`                         |
| Mutex anti-doble-procesamiento                       | ✅ Implementado           | `backgroundTriggers.ts:88-111`                                          |
| SOS offline-first con dead-letter retenido           | ✅ Implementado           | `sosOutbox.ts:196-228`                                                  |
| Incident report offline-first                        | ✅ Implementado           | `incidentOutbox.ts:93-115`                                              |
| State machine de sincronización                      | ✅ Implementado           | `docs/offline-sync.md`                                                  |
| Almacenamiento offline cifrado (AES-256-GCM)         | ✅ Implementado           | `offlineStorage.ts:8, 92`                                               |
| Canal Android IMPORTANCE_HIGH dedicado               | ✅ Implementado           | `criticalNotificationChannel.ts:34-43`                                  |
| Detección de permisos desactivados (fail-closed)     | ✅ Implementado           | `criticalNotificationChannel.ts:98-107`                                 |
| Dead-letter NUNCA descarta datos de seguridad        | ✅ Implementado           | `sosOutbox.ts:196-228`, `incidentOutbox.ts:18-23`                       |
| Bypass DnD en Android (`setBypassDnd`)               | ❌ No implementado        | `criticalNotificationChannel.ts:17-22`                                  |
| Email CPHS en worker de outbox                       | ❌ Stub (`return false`)  | `backgroundTriggers.ts:723-731`                                         |

---

## 7. Distinción crítica: push best-effort vs estado servidor duradero

Una aclaración fundamental para el contexto mission-critical:

- **FCM/APNs son canales best-effort.** Ni Google ni Apple garantizan entrega. FCM puede depriorizar (S1), APNs puede rechazar por rate limiting (S2), y ambos dependen del dispositivo estar conectado.
- **El estado duradero vive en Firestore (servidor).** El outbox `critical_alert_outbox/{nodeId}` es la autoridad: su estado (`pending` → `processing` → `sent`/`dead_lettered`) refleja la verdad, independientemente de si el push llegó al dispositivo.
- **La cola offline del cliente** (`sosOutbox`, `incidentOutbox`) garantiza que el evento LLEGA al servidor aunque el trabajador esté sin red — con dead-letter retenido si nunca conecta.
- **El espejo `_criticalAlertSentAt`** en el nodo solo se escribe tras entrega confirmada (≥1 canal) — nunca antes. Esto significa que un incidente visible en el dashboard SIEMPRE tuvo al menos un canal de entrega exitoso.

**El sistema está diseñado para que la pérdida de un push NO pierda el evento de seguridad.** El push es la notificación; el outbox es el registro duradero.

---

_Fin del documento._
