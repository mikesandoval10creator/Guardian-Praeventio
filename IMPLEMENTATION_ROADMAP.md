# Hoja de Ruta de Implementación — Guardian Praeventio
**Fecha:** 2026-05-07 | **Servidor de desarrollo:** `http://localhost:57335`  
**Principio rector:** El sistema nunca puede fallar cuando alguien está en peligro.

---

> **Contexto de lectura**
> `TECHNICAL_DEBT_AUDIT.md` documenta lo que *existe incompleto*.
> Este documento describe **cómo completarlo**, en qué orden exacto, qué puede
> salir mal, qué validaciones son innegociables, y cómo cada decisión técnica
> conecta con la protección real de vidas humanas en faenas, minas y obras.

---

## El problema real: la brecha entre "funciona en demo" y "funciona en una mina"

Un minero en el Nivel 8 de una mina de cobre no tiene señal 4G. La pantalla de su teléfono está bloqueada en el bolsillo. Lleva 6 horas sin parar. Su ritmo cardíaco acaba de cruzar 140 bpm. Nadie está mirando la pantalla.

En ese momento, Guardian Praeventio tiene exactamente **dos segundos** para hacer su trabajo antes de que la ventana se cierre. Si falla — por un timeout de red, porque el proceso PWA fue matado por el SO, porque el KMS usó la clave dev, porque la URL del modelo ONNX era incorrecta — un ser humano puede morir sin que nadie lo sepa.

Eso define el orden de todo lo que sigue.

---

## Entorno de desarrollo local

```bash
# Iniciar el stack completo (Express + Vite en modo dev):
npm run dev
# → http://localhost:57335

# Para correr solo el emulador de Firebase (tests de reglas):
npx firebase emulators:start --only firestore,auth

# Para correr tests:
npm test

# Para ver la PWA instalada en móvil desde la red local:
# Reemplazar con la IP de tu máquina:
# http://192.168.x.x:57335
```

El servidor Express sirve tanto el API (`/api/*`) como la app React (via middleware Vite en dev, via `dist/` en producción). Todo en el mismo puerto.

---

## Parte 1: Los 4 Niveles de Implementación

### Nivel 0 — Bloqueadores Inmediatos (1–2 semanas)

No tienen justificación técnica ni de negocio para estar pendientes. Son configuraciones, wirings, o reemplazos de valores placeholder. Si un trabajador usa el sistema hoy con alguno de estos pendiente, el sistema tiene un agujero activo.

---

#### 0.1 Montar el Webhook de MercadoPago en `server.ts`
**Esfuerzo:** 2 horas | **Archivo:** `src/services/billing/mercadoPagoIpn.ts` ya existe

El webhook IPN procesa la notificación de pago de MercadoPago y actualiza el tier del usuario en Firestore. El archivo existe y está listo, pero nunca se montó en el router principal.

```typescript
// server.ts — agregar junto a los otros billing routers:
import { mercadoPagoIpnRouter } from './src/server/routes/billing/mercadoPagoIpn.js';
app.use('/api/billing/webhook', mercadoPagoIpnRouter);
```

**Cuidado crítico:** Antes de procesar el pago, verificar la firma HMAC del header `x-signature` que MercadoPago envía. `mercadoPagoIpn.ts` ya tiene `verifyMpSignature()` — confirmar que se llame como middleware antes de `procesarPago()`, no después. Un endpoint de webhook sin verificación de firma puede ser abusado para activar tiers de pago arbitrariamente.

**Idempotencia:** Guardar en Firestore el `id` de cada notificación procesada. Si MercadoPago reenvía la misma notificación (lo hace cuando no recibe 200 en < 5 segundos), no procesar dos veces.

---

#### 0.2 Variable de Entorno KMS en Cloud Run
**Esfuerzo:** 30 minutos + migración de datos

El PII médico y biométrico de los trabajadores está cifrado con la clave `'praeventio-in-memory-kms-dev-kek-v1'` — visible en el repositorio público. Cualquier persona con acceso al repo puede descifrar los datos.

```bash
# 1. Crear el keyring en Cloud KMS:
gcloud kms keyrings create guardian --location us-central1
gcloud kms keys create worker-pii \
  --keyring guardian --location us-central1 \
  --purpose encryption \
  --rotation-period 7776000s \   # 90 días
  --next-rotation-time "2026-08-05T00:00:00Z"

# 2. Dar permisos a la Service Account de Cloud Run:
gcloud kms keys add-iam-policy-binding worker-pii \
  --keyring guardian --location us-central1 \
  --member "serviceAccount:guardian-backend@PROYECTO.iam.gserviceaccount.com" \
  --role "roles/cloudkms.cryptoKeyEncrypterDecrypter"

# 3. Configurar en Cloud Run:
gcloud run services update guardian-backend \
  --set-env-vars KMS_ADAPTER=cloud-kms \
  --set-env-vars KMS_KEY_NAME=projects/PROYECTO/locations/us-central1/keyRings/guardian/cryptoKeys/worker-pii
```

**Advertencia de migración:** Al cambiar de `in-memory-dev` a `cloud-kms`, los datos ya cifrados NO pueden descifrarse con la nueva clave. Ejecutar el script de migración de `KMS_ROTATION.md` **antes** del switch, en una ventana de mantenimiento con backup verificado de Firestore.

**En local (`.env.local`):** Mantener `KMS_ADAPTER=in-memory-dev` para desarrollo. Nunca poner credenciales KMS reales en `.env.local`.

---

#### 0.3 Eliminar `ctx.skip()` de Tests de Seguridad Firestore
**Esfuerzo:** 4 horas

Los tests que validan que empresa A no puede leer datos de empresa B se saltan silenciosamente cuando el emulador tarda en arrancar. La solución es un health-check explícito en el workflow de CI:

```yaml
# .github/workflows/ci.yml — en el job de Firestore rules tests:
- name: Wait for Firestore emulator
  run: |
    echo "Waiting for Firestore emulator on port 8080..."
    timeout 60 bash -c 'until curl -sf http://127.0.0.1:8080/; do sleep 1; done'
    echo "Firestore emulator ready"
```

Luego en los tests, reemplazar el pattern `ctx.skip()` por:

```typescript
// Antes (silencia el fallo):
if (!emulatorAvailable) { ctx.skip(); return; }

// Después (falla el test explícitamente si el emulador no está):
if (!emulatorAvailable) {
  throw new Error('Firestore emulator required for security tests — check CI setup');
}
```

---

#### 0.4 `firebase.json` — Hosting, Storage y Functions
**Esfuerzo:** 1 hora

Sin este cambio, `firebase deploy` no despliega la app web ni las reglas de Storage.

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "/api/**", "function": "api" },
                 { "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**/*.@(js|css|woff2)",
        "headers": [{ "key": "Cache-Control", "value": "max-age=31536000,immutable" }]
      },
      {
        "source": "**",
        "headers": [
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      }
    ]
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "firestore": { "host": "127.0.0.1", "port": 8080 },
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "storage": { "host": "127.0.0.1", "port": 9199 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

Crear `storage.rules` mínimo:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Solo el propietario puede leer/escribir sus archivos
    match /workers/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // Documentos de empresa — solo miembros autenticados de esa empresa
    match /companies/{companyId}/{allPaths=**} {
      allow read: if request.auth != null && request.auth.token.companyId == companyId;
      allow write: if request.auth != null
                   && request.auth.token.companyId == companyId
                   && request.auth.token.role in ['admin', 'prevencionista'];
    }
  }
}
```

---

#### 0.5 Activar `Site25DPanel` Tests (Gemelo Digital)
**Esfuerzo:** 3 horas | **Archivo:** `src/components/digital-twin/Site25DPanel.test.tsx:205`

El `describe.skip` existe porque los mocks de `react-google-maps` son inestables. La solución es mockear al nivel correcto:

```typescript
// Reemplazar el mock inestable de GoogleMap por un stub determinístico:
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: any) => <div data-testid="google-map-stub">{children}</div>,
  AdvancedMarker: ({ children, position }: any) => (
    <div data-testid="marker" data-lat={position?.lat} data-lng={position?.lng}>
      {children}
    </div>
  ),
}));
```

Con esto, los tests del Gemelo Digital dejan de depender del SDK real de Google Maps y son determinísticos en CI.

---

#### 0.6 Revocar Refresh Tokens al Desactivar un Trabajador
**Esfuerzo:** 2 horas | **Riesgo activo:** Ex-empleados mantienen acceso hasta que el token expira (hasta 1 hora)

```typescript
// Firestore trigger (o Cloud Function) — cuando workers/{uid} cambia a inactive:
// src/server/triggers/backgroundTriggers.ts — agregar:
export async function onWorkerDeactivated(uid: string): Promise<void> {
  await admin.auth().revokeRefreshTokens(uid);
  // El usuario queda inmediatamente sin acceso, incluso si tiene un token válido
  await admin.auth().setCustomUserClaims(uid, { role: 'inactive', revokedAt: Date.now() });
}
```

En el middleware `verifyAuth`, agregar verificación de `tokensValidAfterTime`:

```typescript
const userRecord = await admin.auth().getUser(decoded.uid);
const tokenIssuedAt = decoded.iat * 1000;
const revokedAt = new Date(userRecord.tokensValidAfterTime!).getTime();
if (tokenIssuedAt < revokedAt) {
  return res.status(401).json({ error: 'Token revoked — please re-authenticate' });
}
```

---

### Nivel 1 — Funcionalidades Críticas de Vida (2–8 semanas)

El núcleo de la promesa del producto. Sin estas piezas, Guardian Praeventio es una app de gestión de documentos con alertas decorativas.

---

#### 1.1 Foreground Service Nativo (la más crítica de todas)
**Esfuerzo:** 3–4 semanas | **Por qué es la más crítica:** iOS y Android matan procesos PWA cuando la pantalla se bloquea después de ~5 minutos. `useManDownDetection`, `useBluetoothMesh`, y `useHeartRateMonitor` dejan de ejecutarse. El Guardian se duerme en el bolsillo del minero.

**Arquitectura correcta para Android:**

Crear el plugin Capacitor en `packages/capacitor-foreground/`:

```kotlin
// android/src/main/java/com/praeventio/foreground/GuardianForegroundService.kt
class GuardianForegroundService : Service() {
  
  private val handler = Handler(Looper.getMainLooper())
  private var heartbeatRunnable: Runnable? = null
  
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channel = NotificationChannel(
      "guardian_watchdog",
      "Guardian Activo",
      NotificationManager.IMPORTANCE_LOW  // bajo para no molestar con sonido
    )
    
    val notification = NotificationCompat.Builder(this, "guardian_watchdog")
      .setContentTitle("Guardian Praeventio")
      .setContentText("Monitoreo activo — Turno en curso")
      .setSmallIcon(R.drawable.ic_shield)
      .setOngoing(true)  // no se puede deslizar para cerrar
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    
    startForeground(1001, notification)
    
    // Heartbeat cada 10 segundos — envía evento al JS bridge
    heartbeatRunnable = object : Runnable {
      override fun run() {
        sendHeartbeatToJs()
        handler.postDelayed(this, 10_000)
      }
    }
    handler.post(heartbeatRunnable!!)
    
    return START_STICKY  // Android reinicia el servicio si lo mata
  }
  
  private fun sendHeartbeatToJs() {
    // Notificar al WebView que el Foreground Service sigue activo
    JSEventManager.notifyListeners("guardianHeartbeat", JSObject().apply {
      put("timestamp", System.currentTimeMillis())
      put("source", "foreground_service")
    })
  }
}
```

```typescript
// packages/capacitor-foreground/src/index.ts — API TypeScript:
export interface GuardianForegroundPlugin {
  start(options: { workerUid: string; heartbeatInterval: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'guardianHeartbeat', handler: (data: { timestamp: number }) => void): Promise<PluginListenerHandle>;
}

export const GuardianForeground = registerPlugin<GuardianForegroundPlugin>('GuardianForeground');
```

**Arquitectura correcta para iOS:**

iOS no tiene Foreground Services como Android. La estrategia correcta es push-based: el servidor detecta la ausencia del heartbeat y envía una APNs notification silenciosa (`content-available: 1`) que despierta la app brevemente.

```swift
// ios/App/App/GuardianBackgroundTask.swift
import BackgroundTasks

class GuardianBackgroundTask {
  static func register() {
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: "com.praeventio.guard.heartbeat",
      using: nil
    ) { task in
      handleHeartbeatTask(task as! BGAppRefreshTask)
    }
  }
  
  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: "com.praeventio.guard.heartbeat")
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // mínimo 15min
    try? BGTaskScheduler.shared.submit(request)
  }
  
  private static func handleHeartbeatTask(_ task: BGAppRefreshTask) {
    task.expirationHandler = { task.setTaskCompleted(success: false) }
    // Enviar heartbeat al servidor, re-programar próximo task
    sendHeartbeat { success in
      task.setTaskCompleted(success: success)
      schedule() // re-programar para el siguiente ciclo
    }
  }
}
```

**Servidor — detectar ausencia de heartbeat:**

```typescript
// src/server/jobs/heartbeatWatchdog.ts
// Cloud Scheduler llama a POST /api/admin/jobs/heartbeat-watchdog cada 2 minutos:
export async function runHeartbeatWatchdog(): Promise<void> {
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
  
  // Trabajadores en turno activo que no enviaron heartbeat en 2 minutos:
  const silentWorkers = await db.collection('active_sessions')
    .where('lastHeartbeat', '<', twoMinutesAgo)
    .where('status', '==', 'on_shift')
    .get();
  
  for (const doc of silentWorkers.docs) {
    const worker = doc.data();
    // Enviar APNs silenciosa para despertar la app en iOS:
    await fcm.send({
      token: worker.fcmToken,
      apns: { payload: { aps: { contentAvailable: true } } },
      data: { type: 'HEARTBEAT_REQUEST', priority: 'high' },
    });
  }
}
```

---

#### 1.2 Outbox Pattern para Alertas de Emergencia
**Esfuerzo:** 1 semana | **Garantía requerida:** Ninguna alerta de emergencia puede perderse, incluso ante fallos de red.

```typescript
// src/services/emergency/alertOutbox.ts
export async function dispatchEmergencyAlert(alert: EmergencyAlert): Promise<void> {
  const alertRef = db.collection('alert_outbox').doc(alert.id);
  
  // 1. Escritura atómica en Firestore como fuente de verdad:
  await alertRef.set({
    ...alert,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  
  // 2. Intentar entrega inmediata:
  try {
    await deliverAlert(alert);
    await alertRef.update({ status: 'delivered', deliveredAt: FieldValue.serverTimestamp() });
  } catch {
    // 3. Si falla, el Cloud Function con trigger en 'alert_outbox'
    //    reintentará con backoff exponencial: 30s, 2m, 10m, 30m, 2h
  }
}

// Cloud Function trigger:
export const retryPendingAlerts = onDocumentUpdated('alert_outbox/{alertId}', async (event) => {
  const data = event.data?.after.data();
  if (data?.status !== 'pending') return;
  if (data.attempts >= 5) {
    // Escalar a SMS y llamada de voz como fallback final
    await smsAdapter.sendEmergencySms(data.targetPhone, formatSmsAlert(data));
    return;
  }
  // Backoff exponencial: 30s * 2^attempts
  const backoffMs = 30_000 * Math.pow(2, data.attempts);
  if (Date.now() < data.nextAttemptAt.toMillis() + backoffMs) return;
  
  await deliverAlert(data);
});
```

**Stack de notificación redundante (3 capas):**

| Capa | Tecnología | Latencia | Garantía |
|---|---|---|---|
| 1 | FCM push notification | 0–30s | Best-effort |
| 2 | SMS via Twilio | 5–60s | Alta (llega con señal mínima) |
| 3 | Llamada de voz automática | 60s si no hay confirmación | Máxima |

---

#### 1.3 Verificación Real de Recibos IAP
**Esfuerzo:** 2 semanas | **Riesgo activo:** Recibos falsos permiten acceso gratuito a tiers de pago.

**Google Play Developer API v3:**

```typescript
// src/services/billing/googlePlayVerifier.ts
import { google } from 'googleapis';
import { db } from '../firebase.js';

export async function verifyGooglePlayReceipt(
  packageName: string,
  productId: string,
  purchaseToken: string,
): Promise<{ valid: boolean; expiryMs: number }> {
  // Anti-replay: rechazar tokens ya procesados
  const tokenHash = createHash('sha256').update(purchaseToken).digest('hex');
  const existing = await db.collection('processed_iap_tokens').doc(tokenHash).get();
  if (existing.exists) return { valid: true, expiryMs: existing.data()!.expiryMs };
  
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const publisher = google.androidpublisher({ version: 'v3', auth });
  
  const { data } = await publisher.purchases.subscriptions.get({
    packageName, subscriptionId: productId, token: purchaseToken,
  });
  
  const valid = data.paymentState === 1 || data.paymentState === 2; // 1=paid, 2=trial
  const expiryMs = Number(data.expiryTimeMillis);
  
  if (valid) {
    await db.collection('processed_iap_tokens').doc(tokenHash).set({
      productId, expiryMs, processedAt: FieldValue.serverTimestamp(),
    });
  }
  
  return { valid, expiryMs };
}
```

**Apple App Store Server API (no usar el endpoint `/verifyReceipt` deprecado):**

```typescript
// src/services/billing/appleVerifier.ts
import * as jwt from 'jsonwebtoken';

export async function verifyAppleReceipt(transactionId: string): Promise<boolean> {
  // JWT firmado con la clave privada de App Store Connect (.p8)
  const token = jwt.sign({}, process.env.APPLE_PRIVATE_KEY!, {
    algorithm: 'ES256',
    issuer: process.env.APPLE_ISSUER_ID,
    audience: 'appstoreconnect-v1',
    keyid: process.env.APPLE_KEY_ID,
    expiresIn: '5m',
  });
  
  const response = await fetch(
    `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${transactionId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  if (!response.ok) return false;
  const data = await response.json();
  return data.status === 0; // 0 = válido
}
```

---

#### 1.4 WebAuthn Server-Side Real
**Esfuerzo:** 2 semanas | **Riesgo activo:** La biometría es un gesto UI sin validación criptográfica.

```bash
npm install @simplewebauthn/server
```

```typescript
// src/server/routes/webauthn.ts — nuevo archivo:
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// POST /api/auth/webauthn/register/begin
router.post('/register/begin', verifyAuth, async (req, res) => {
  const { uid, email } = req.user;
  const options = await generateRegistrationOptions({
    rpName: 'Guardian Praeventio',
    rpID: process.env.RP_ID!, // ej: 'praeventio.net'
    userID: uid,
    userName: email,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });
  
  // Guardar el challenge en Firestore con TTL de 5 minutos
  await db.collection('webauthn_challenges').doc(uid).set({
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  
  res.json(options);
});

// POST /api/auth/webauthn/register/complete
router.post('/register/complete', verifyAuth, async (req, res) => {
  const { uid } = req.user;
  const challengeDoc = await db.collection('webauthn_challenges').doc(uid).get();
  
  if (!challengeDoc.exists || challengeDoc.data()!.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Challenge expired or not found' });
  }
  
  const verification = await verifyRegistrationResponse({
    response: req.body,
    expectedChallenge: challengeDoc.data()!.challenge,
    expectedOrigin: process.env.APP_ORIGIN!,
    expectedRPID: process.env.RP_ID!,
  });
  
  if (!verification.verified) {
    return res.status(400).json({ error: 'WebAuthn verification failed' });
  }
  
  // Eliminar challenge usado
  await challengeDoc.ref.delete();
  
  // Guardar credencial (webauthnCredentialStore.ts ya tiene la interfaz)
  await credentialStore.save(uid, verification.registrationInfo!);
  
  res.json({ ok: true });
});
```

---

#### 1.5 Sincronización Offline Predictiva (el Guardian que anticipa)
**Esfuerzo:** 4–6 semanas | **Por qué importa:** Un minero entra al túnel sin haber cambiado nada. El sistema no pre-descargó los datos que necesitará.

**Motor de pre-descarga predictiva:**

```typescript
// src/services/slm/predictiveSync.ts

interface PrefetchPlan {
  nodeIds: string[];
  estimatedSizeBytes: number;
  requiredBy: Date; // cuándo el trabajador perderá señal
}

export async function buildPrefetchPlan(
  workerUid: string,
  db: FirestoreDb,
): Promise<PrefetchPlan> {
  // 1. Leer el calendario para las próximas 4 horas:
  const tasks = await db.getUpcomingTasks(workerUid, { hoursAhead: 4 });
  
  // 2. Para cada tarea, resolver nodos Zettelkasten necesarios:
  //    - Tipo 'machine_operation' → nodo manual + nodo historial_alertas
  //    - Tipo 'confined_space' → nodo normativa_DS594 + nodo EPP_requerido
  //    - Tipo 'electrical_work' → nodo normativa_DS72 + nodo historial_incidentes
  const nodeIds = await resolveRequiredNodes(tasks);
  
  // 3. Agregar el historial médico relevante del trabajador:
  const medicalNodes = await getMedicalSummaryNodes(workerUid);
  
  // 4. Calcular tamaño y priorizar (límite: 50MB por dispositivo):
  const allNodes = prioritizeNodes([...nodeIds, ...medicalNodes], { maxSizeBytes: 50 * 1024 * 1024 });
  
  return {
    nodeIds: allNodes,
    estimatedSizeBytes: await estimateDownloadSize(allNodes),
    requiredBy: tasks[0]?.startTime ?? new Date(Date.now() + 4 * 3600 * 1000),
  };
}

// Hook React — disparar cuando hay WiFi y el trabajador abre la app:
export function usePredictiveSync(workerUid: string) {
  const { isOnline, connectionType } = useNetworkStatus();
  
  useEffect(() => {
    if (!isOnline || connectionType === '2g') return; // no pre-descargar en 2G
    
    buildPrefetchPlan(workerUid, db).then(plan => {
      indexedDbCache.prefetch(plan.nodeIds, { priority: 'background' });
    });
  }, [isOnline, workerUid]);
}
```

**Priorización de datos para pre-descarga:**

| Tipo de dato | TTL de frescura | Prioridad |
|---|---|---|
| Historial médico relevante | 24 horas | 1 (crítica) |
| Normativa aplicable al turno | 7 días | 2 (alta) |
| Manual de la máquina asignada | 30 días | 3 (media) |
| Fotos de incidentes previos del sitio | 7 días | 4 (media) |
| Reportes históricos de la empresa | 90 días | 5 (baja) |

---

#### 1.6 Bus de Eventos para Correlación de Sensores
**Esfuerzo:** 2–3 semanas | **Por qué importa:** Sin correlación, los falsos positivos vacían el crédito de alerta del sistema.

```typescript
// src/store/sensorBus.ts — Zustand store central:
import { create } from 'zustand';

export type SensorEventType =
  | 'BLE_DISCONNECTED'
  | 'HEART_RATE_SPIKE'          // > umbral configurado por el médico
  | 'HEART_RATE_FLATLINE'       // sin variabilidad = posible inconciencia
  | 'FALL_DETECTED'             // acelerómetro > 3g + inactividad > 2s
  | 'GAS_THRESHOLD_EXCEEDED'    // sensor de gas cruzó límite permisible
  | 'TEMPERATURE_EXTREME'       // WBGT > 28°C (riesgo estrés térmico)
  | 'NOISE_OVEREXPOSURE'        // dosis acumulada > 85dB TWA
  | 'NO_MOTION_PROLONGED'       // sin movimiento > 5 minutos en turno activo
  | 'LOCATION_GEOFENCE_EXIT';   // salió de zona autorizada

interface SensorEvent {
  type: SensorEventType;
  sensorId: string;
  workerId: string;
  value: number;
  timestamp: number;
  confidence: number; // 0–1, qué tan seguro está el sensor
}

interface CorrelationWindow {
  events: SensorEvent[];
  startedAt: number;
}

const useSensorBus = create<{
  recentEvents: SensorEvent[];
  dispatch: (event: SensorEvent) => void;
  getCorrelationWindow: (workerId: string, windowMs: number) => SensorEvent[];
}>((set, get) => ({
  recentEvents: [],
  
  dispatch: (event) => {
    set(state => {
      // Mantener solo los últimos 5 minutos de eventos en memoria:
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      const recentEvents = [
        ...state.recentEvents.filter(e => e.timestamp > fiveMinutesAgo),
        event,
      ];
      
      // Disparar correlación automática en background:
      correlate(recentEvents, event.workerId);
      
      return { recentEvents };
    });
  },
  
  getCorrelationWindow: (workerId, windowMs) => {
    const cutoff = Date.now() - windowMs;
    return get().recentEvents.filter(
      e => e.workerId === workerId && e.timestamp > cutoff
    );
  },
}));

// Motor de correlación — reglas de escalada:
async function correlate(events: SensorEvent[], workerId: string): Promise<void> {
  const last30s = events.filter(
    e => e.workerId === workerId && e.timestamp > Date.now() - 30_000
  );
  
  const hasFall = last30s.some(e => e.type === 'FALL_DETECTED' && e.confidence > 0.7);
  const hasHeartSpike = last30s.some(e => e.type === 'HEART_RATE_SPIKE');
  const bleDisconnected = last30s.some(e => e.type === 'BLE_DISCONNECTED');
  const noMotion = last30s.some(e => e.type === 'NO_MOTION_PROLONGED');
  
  // Regla 1: Caída + inactividad + BLE desconectado = emergencia alta probabilidad
  if (hasFall && noMotion && bleDisconnected) {
    await dispatchEmergencyAlert({
      id: generateId(),
      workerId,
      severity: 'critical',
      type: 'MAN_DOWN_CONFIRMED',
      evidence: last30s.map(e => e.type),
    });
    return;
  }
  
  // Regla 2: Solo caída = alarma con ventana de cancelación de 15 segundos
  if (hasFall && !hasHeartSpike) {
    await dispatchAlertWithCancellation({
      workerId,
      cancellationWindowMs: 15_000,
      message: '¿Estás bien? Toca para cancelar la alerta.',
    });
  }
}
```

---

#### 1.7 SLM Offline — URLs ONNX Verificadas + SHA256
**Esfuerzo:** 1 semana + validación con proveedores

Antes de lanzar el SLM offline a producción, cada modelo necesita URL confirmada y hash de integridad:

```typescript
// src/services/slm/registry.ts — estructura de cada entrada:
export const SLM_REGISTRY: ModelDefinition[] = [
  {
    id: 'phi-3-mini',
    displayName: 'Phi-3 Mini (4K context)',
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx/resolve/main/cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/phi3-mini-4k-instruct-cpu-int4-rtn-block-32-acc-level-4.onnx',
    sha256: '<VERIFICAR CON MICROSOFT ANTES DE USAR EN PRODUCCIÓN>',
    sizeBytes: 2_100_000_000,
    tokenizerUrl: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct/resolve/main/tokenizer.json',
    suitableFor: ['normativa', 'recomendaciones', 'chat_asesor'],
  },
  // Qwen y Gemma: confirmar URLs con los equipos respectivos
  // No usar URLs especulativas — si la URL es incorrecta, la descarga
  // falla silenciosamente y el usuario queda sin SLM offline sin saber por qué
];

// Función de descarga con verificación de integridad:
export async function downloadAndVerifyModel(model: ModelDefinition): Promise<boolean> {
  const response = await fetch(model.url);
  const buffer = await response.arrayBuffer();
  
  const hash = createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  if (hash !== model.sha256) {
    console.error(`SHA256 mismatch for ${model.id}: expected ${model.sha256}, got ${hash}`);
    return false; // No usar un modelo comprometido o corrupto
  }
  
  await indexedDb.setItem(`model_${model.id}`, buffer);
  return true;
}
```

---

### Nivel 2 — Infraestructura de Confianza (2–4 meses)

Piezas no visibles para el trabajador, pero que hacen el sistema confiable a escala industrial.

---

#### 2.1 Pipeline de Entrenamiento Vertex AI (Predicción de Accidentes)
**Esfuerzo:** 4–6 semanas | **Sprint asignado:** 33

El modelo predictivo es la diferencia entre un sistema reactivo y uno preventivo.

**Arquitectura de datos para entrenamiento:**

```
Features de entrada (secuencia temporal de 4 horas):
  - Telemetría BLE: frecuencia cardíaca, temperatura corporal, pasos
  - Ergonómica REBA: score cada 15 minutos
  - Ambiental: temperatura ambiente, humedad, nivel de ruido, concentración de gases
  - Contextual: hora del día, día de la semana, fase del turno (inicio/medio/final)
  - Histórico: incidentes previos en este sitio, incidentes previos de este trabajador
  - Clima: temperatura WBGT, velocidad del viento

Output:
  - P(incidente en próximos 30 minutos): float [0, 1]
  - Tipo más probable: 'estrés_térmico' | 'caída' | 'golpe' | 'ergonómico'
  - Confianza del modelo: float [0, 1]
```

**Protocolo de entrenamiento federado (privacidad empresarial):**

```python
# vertex_training/federated_trainer.py — esquema de federación:
# 1. Modelo base entrenado con datos sintéticos + datasets públicos de accidentes (ACHS, ISP)
# 2. Fine-tuning por empresa: cada empresa entrena su variante sin compartir datos raw
# 3. Agregación: solo los gradientes (no los datos) se agregan en el modelo base
# 4. Resultado: modelo personalizado por empresa + modelo base mejorado globalmente
```

**Reglas de privacidad innegociables:**
- Datos de trabajador A de empresa X jamás se usan para entrenar predicciones de empresa Y
- Todos los datos de entrenamiento deben ser anonimizados (sin nombre, sin RUT)
- Consentimiento explícito del trabajador para contribuir con sus datos al entrenamiento
- Derecho a opt-out: si el trabajador retira su consentimiento, sus datos se eliminan del dataset

---

#### 2.2 Integración Completa de Analytics (39 Eventos Faltantes)
**Esfuerzo:** 2 semanas | **Archivo:** `src/services/analytics/types.ts:30`

```typescript
// types.ts — agregar los 39 eventos del event-catalog.md:
export type AnalyticsEvent =
  // Ya implementados:
  | { name: 'app.session.started'; props: { workerUid: string; shiftId: string } }
  | { name: 'emergency.alert.triggered'; props: { type: string; severity: string } }
  
  // Faltantes — ejemplos representativos:
  | { name: 'auth.user.signed_in'; props: { method: 'email' | 'google' | 'webauthn' } }
  | { name: 'auth.user.signed_out'; props: { sessionDuration: number } }
  | { name: 'document.inspection.completed'; props: { inspectionType: string; findings: number } }
  | { name: 'training.module.completed'; props: { moduleId: string; score: number } }
  | { name: 'ble.sensor.connected'; props: { sensorType: string; rssi: number } }
  | { name: 'ble.sensor.disconnected'; props: { sensorType: string; reason: string } }
  | { name: 'offline.sync.started'; props: { pendingChanges: number } }
  | { name: 'offline.sync.completed'; props: { synced: number; conflicts: number } }
  | { name: 'ergo.analysis.completed'; props: { rebaScore: number; risk: string } }
  // ... resto en event-catalog.md
```

---

#### 2.3 Internacionalización Completa (i18n)
**Esfuerzo:** 3 semanas | **Cobertura actual:** ~70% de los componentes

Los sub-componentes de Calendar (`AddEventModal`, `EventDetailsModal`) tienen strings hardcodeados en español. Con expansión a México, Colombia y Perú (mercados objetivo), la internacionalización completa es requisito de negocio.

**Prioridad de componentes a i18nizar:**

| Componente | Impacto | Esfuerzo |
|---|---|---|
| Calendar modals | Alto (uso diario) | 2h |
| Emergency flow | Crítico (vidas) | 4h |
| Billing / Pricing | Alto (conversión) | 3h |
| Normativa display | Medio (varía por país) | 8h |
| Error messages | Medio (UX) | 4h |

**Idiomas objetivo:** ES-CL (base), ES-MX, ES-CO, ES-PE, PT-BR (largo plazo)

---

#### 2.4 Content Security Policy Estricta
**Esfuerzo:** 2 semanas

El CSP actual permite `'unsafe-inline'` en scripts para compatibilidad con bibliotecas de terceros. Con nonces implementados (ya hay infraestructura en `vite.config.ts`), se puede eliminar `'unsafe-inline'`:

```typescript
// src/server/middleware/securityHeaders.ts — CSP final:
const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,  // solo scripts con nonce
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://picsum.photos https://maps.googleapis.com",
  "connect-src 'self' https://*.googleapis.com https://api.resend.com wss://",
  "font-src 'self' https://fonts.gstatic.com",
  "worker-src 'self' blob:",  // para ONNX workers
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
```

---

#### 2.5 Migración del Directorio Android
**Esfuerzo:** 1 semana (requiere máquina con JDK 17 + Android SDK)

```bash
# Pasos en orden exacto (ejecutar localmente, no en CI):
npx cap add android
npx cap sync android

# Configurar el keystore de producción (guardar en un gestor de secretos, NO en git):
keytool -genkeypair -v -storetype PKCS12 \
  -keystore guardian-release.jks \
  -alias guardian \
  -keyalg RSA -keysize 2048 \
  -validity 10000

# Reemplazar el SHA256 en assetlinks.json:
keytool -list -v -keystore guardian-release.jks | grep "SHA256:"
# Copiar el valor y reemplazar REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD

# Build de producción:
cd android && ./gradlew bundleRelease
```

---

### Nivel 3 — Inteligencia y Expansión (4–9 meses)

Estas funcionalidades elevan el producto de "buena herramienta de seguridad" a "sistema de prevención inteligente".

---

#### 3.1 WebXR AR Overlay Real
**Esfuerzo:** 6–8 semanas | **Ola asignada:** Ola 4

La superposición AR permite que un trabajador apunte su teléfono a una máquina y vea en tiempo real: manual de operación, alertas de mantenimiento, historial de accidentes de ese equipo.

```typescript
// src/hooks/useArPlacement.ts — reemplazar la sesión simulada:
export async function startArSession(overlayRoot: HTMLElement): Promise<XRSession | null> {
  if (!navigator.xr) return null;
  
  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) return null; // Fallback al Gemelo Digital 2.5D
  
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'dom-overlay'],
    domOverlay: { root: overlayRoot },
  });
  
  const referenceSpace = await session.requestReferenceSpace('local');
  const hitTestSource = await session.requestHitTestSource!({ space: referenceSpace });
  
  session.requestAnimationFrame((time, frame) => {
    const hitResults = frame.getHitTestResults(hitTestSource!);
    if (hitResults.length > 0) {
      const pose = hitResults[0].getPose(referenceSpace);
      // Identificar el objeto mediante ARCore (Android) o RealityKit (iOS)
      // y mostrar el overlay de datos relevantes
    }
  });
  
  return session;
}
```

**Compatibilidad:**
- Android: Chrome 81+ con ARCore instalado
- iOS: Safari 17+ (RealityKit bridge, API limitada)
- Fallback universal: Gemelo Digital 2.5D (ya existe y funciona)

---

#### 3.2 Análisis de Postura en Vivo con MediaPipe Local
**Esfuerzo:** 3–4 semanas | **Bucket asignado:** OO.4

```typescript
// src/hooks/useMediaPipeLivePose.ts — análisis a 5 fps en Worker:
const ANALYSIS_FPS = 5;
const FRAME_INTERVAL_MS = 1000 / ANALYSIS_FPS;

export function useMediaPipeLivePose(videoRef: RefObject<HTMLVideoElement>) {
  const workerRef = useRef<Worker>();
  
  useEffect(() => {
    // Usar la versión local de MediaPipe (empaquetar en public/models/mediapipe/):
    workerRef.current = new Worker(
      new URL('../workers/mediapipePoseWorker.ts', import.meta.url),
      { type: 'module' }
    );
    
    const interval = setInterval(() => {
      if (!videoRef.current) return;
      
      // OffscreenCanvas para no bloquear el hilo principal:
      const canvas = new OffscreenCanvas(
        videoRef.current.videoWidth / 2, // mitad de resolución para rendimiento
        videoRef.current.videoHeight / 2
      );
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      workerRef.current!.postMessage({ type: 'ANALYZE_FRAME', imageData }, [imageData.data.buffer]);
    }, FRAME_INTERVAL_MS);
    
    return () => {
      clearInterval(interval);
      workerRef.current?.terminate();
    };
  }, []);
}
```

**Pasos para empaquetar MediaPipe localmente:**

```bash
# Descargar los archivos WASM y el modelo:
mkdir -p public/models/mediapipe
curl -o public/models/mediapipe/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

# Actualizar scripts/download-mediapipe-models.mjs para hacerlo automático:
# (ya existe el script, solo agregar las URLs correctas)
```

---

#### 3.3 Certificación Regulatoria
**Esfuerzo:** 2–4 meses | **Sin esto, el producto no puede venderse a grandes empresas**

Para operar en Chile como herramienta de prevención de riesgos, existen tres certificaciones relevantes:

**ISP (Instituto de Salud Pública):**
- Registro como sistema de gestión de salud ocupacional
- Requiere: auditoría de código por tercero, documentación de metodología REBA/RULA, trazabilidad de incidentes

**Mutual de Seguridad / ACHS / IST:**
- Para integrarse con los sistemas de las mutuales (reporte automático de accidentes)
- Requiere: API de integración certificada, protocolo de transmisión de datos seguro

**ISO 45001 (SGSST):**
- Para clientes que requieren certificación del sistema de gestión
- El sistema debe demostrar que sus alertas y reportes cumplen con los requisitos de la norma

**Línea de tiempo sugerida:**
1. Piloto con 5 empresas → documentar casos de uso reales (mes 1–2)
2. Auditoría de seguridad externa (mes 3)
3. Presentación ante ISP (mes 4–5)
4. Certificación ISO 45001 del proceso (mes 6+)

---

## Parte 2: Los 6 Patrones que Pueden Costar una Vida

### 2.1 El Problema de la Batería (el más ignorado)

Un turno de 12 horas sin carga. Si Guardian consume 15% de batería por hora, el SO entra en modo ahorro de energía a las 10 horas y mata los procesos en background.

**Reglas de implementación:**

```typescript
// Reducir polling cuando la batería está baja:
const battery = await navigator.getBattery();

const POLLING_INTERVALS = {
  normal: { ble: 10_000, heartbeat: 30_000, gps: 60_000 },
  low_battery: { ble: 30_000, heartbeat: 60_000, gps: 120_000 }, // < 20%
  critical: { ble: 60_000, heartbeat: 120_000, gps: 300_000 },   // < 10%
};

battery.addEventListener('levelchange', () => {
  const mode = battery.level < 0.10 ? 'critical'
             : battery.level < 0.20 ? 'low_battery'
             : 'normal';
  sensorBus.dispatch({ type: 'BATTERY_MODE_CHANGED', mode });
});
```

**Consumo máximo aceptable por función:**

| Función | Consumo máximo |
|---|---|
| BLE scanning en reposo | < 3% por hora |
| MediaPipe en vivo | < 8% por hora (solo cuando activo) |
| GPS tracking | < 5% por hora |
| Todo el sistema en turno activo | < 12% por hora total |

### 2.2 Race Conditions en Escrituras Offline

**Escenario peligroso:** El trabajador marca una inspección como "completada" offline. Al mismo tiempo, el supervisor la marca "requiere revisión" desde la web. Sin resolución explícita, uno de los dos cambios se pierde silenciosamente.

```typescript
// reconciliation.ts — para documentos de seguridad, NUNCA "último gana":
type ReconciliationStrategy = 
  | 'last_write_wins'        // para preferencias de UI, configuración personal
  | 'server_wins'            // para normativas, listas de precios
  | 'conflict_queue';        // para documentos de seguridad — SIEMPRE esto

const SAFETY_DOC_TYPES = [
  'inspection', 'incident_report', 'emergency_alert',
  'medical_record', 'training_completion'
] as const;

function getStrategy(docType: string): ReconciliationStrategy {
  return SAFETY_DOC_TYPES.includes(docType as any)
    ? 'conflict_queue'   // Los documentos de seguridad siempre requieren resolución humana
    : 'last_write_wins';
}
```

### 2.3 El SLM que Alucina en Contexto de Seguridad

Los modelos pequeños (Phi-3, Gemma, Qwen) tienen tasas de alucinación más altas que los modelos grandes. En contexto normativo, una alucinación puede matar.

**Regla innegociable:** El SLM NUNCA genera texto normativo sin RAG verificado.

```typescript
// src/services/slm/safeQuery.ts
export async function safeNormativeQuery(
  question: string,
  context: WorkerContext,
): Promise<SafeQueryResult> {
  // 1. Buscar en la base de datos de normativas local (fuente de verdad):
  const ragResults = await ragSearch(question, {
    collections: ['normativa_cl', 'normativa_mx', 'procedimientos'],
    minRelevanceScore: 0.75, // rechazar resultados poco relevantes
  });
  
  if (ragResults.length === 0) {
    // No inventar — devolver respuesta honesta:
    return {
      text: 'No tengo información verificada sobre esto en las normativas disponibles. Consulte el texto oficial del DS 594, la Ley 16.744, o comuníquese con su prevencionista.',
      sources: [],
      verified: false,
    };
  }
  
  // 2. El SLM solo reformula el texto recuperado, nunca genera desde cero:
  const reformulated = await slm.reformulate(ragResults, question);
  
  return {
    text: reformulated,
    sources: ragResults.map(r => r.source),
    verified: true, // solo true si viene de RAG
  };
}
```

### 2.4 Falsos Positivos en Detección de Caída

3 falsas alarmas en un día → los trabajadores desactivan las alertas → la próxima caída real no avisa a nadie.

**Umbrales calibrados:**

```typescript
// src/hooks/useManDownDetection.ts — umbrales basados en literatura industrial:
const FALL_DETECTION_CONFIG = {
  // Acelerómetro: el impacto debe superar 3g (no 1g — agacharse activa 1g)
  impactThresholdG: 3.0,
  
  // Post-impacto: debe haber inactividad durante al menos 2 segundos
  // (una caída real tiene impacto + quietud; una tropezada tiene impacto + movimiento)
  postImpactInactivityMs: 2000,
  
  // Ventana de cancelación: 15 segundos con vibración intensa
  cancellationWindowMs: 15_000,
  
  // Si el GPS muestra que el trabajador está en el comedor o sala de reuniones,
  // reducir la sensibilidad del acelerómetro:
  indoorContextSensitivityMultiplier: 0.5,
  
  // Correlación: la alarma solo escala si hay al menos 2 sensores de acuerdo:
  minSensorsForConfirmedAlert: 2,
};
```

### 2.5 La Sesión que No Expira (el ex-empleado invisible)

Firebase Auth custom claims no tienen TTL. Un trabajador desvinculado sigue teniendo acceso hasta que un admin lo revoca manualmente — o hasta que el refresh token expire (hasta 60 días).

**Implementación completa de expiración de sesión:**

```typescript
// En cada petición autenticada, verificar frescura del token:
// src/server/middleware/verifyAuth.ts — agregar después de verificar firma:

const userRecord = await admin.auth().getUser(decoded.uid);

// 1. Verificar si el token fue revocado explícitamente:
const tokenIssuedAt = decoded.iat * 1000;
const revokedAfter = new Date(userRecord.tokensValidAfterTime ?? 0).getTime();
if (tokenIssuedAt < revokedAfter) {
  return res.status(401).json({ error: 'SESSION_REVOKED', redirect: '/login' });
}

// 2. Forzar reautenticación si el token tiene más de 8 horas (un turno laboral):
const tokenAge = Date.now() - tokenIssuedAt;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
if (tokenAge > MAX_SESSION_MS) {
  return res.status(401).json({ error: 'SESSION_EXPIRED', redirect: '/login' });
}

// 3. Si el rol del usuario fue cambiado después de emitir el token,
//    el token aún tiene el rol viejo — forzar refresh:
if (decoded.role !== userRecord.customClaims?.role) {
  return res.status(401).json({ error: 'ROLE_CHANGED', redirect: '/login?reason=role_update' });
}
```

### 2.6 Notificaciones de Emergencia que No Llegan

FCM puede tardar 30+ segundos en condiciones de señal débil. En una emergencia, ese tiempo es inaceptable.

**Stack de 3 capas en paralelo:**

```typescript
// src/services/emergency/redundantNotifier.ts
export async function notifyEmergencyRedundant(
  workerId: string,
  alert: EmergencyAlert,
): Promise<NotificationResult[]> {
  const worker = await getWorkerProfile(workerId);
  
  // Disparar las 3 capas en paralelo — no esperar que una tenga éxito
  // para iniciar la siguiente:
  const results = await Promise.allSettled([
    
    // Capa 1: FCM push (mejor para apps activas)
    fcm.sendWithPriority(worker.fcmToken, {
      ...formatFcmAlert(alert),
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    }),
    
    // Capa 2: SMS via Twilio (funciona con señal mínima, sin internet)
    twilio.messages.create({
      to: worker.phoneNumber,
      from: process.env.TWILIO_FROM_NUMBER!,
      body: `ALERTA GUARDIAN: ${formatSmsAlert(alert)}. Responda OK para confirmar.`,
    }),
    
    // Capa 3: Programar llamada de voz si no hay confirmación en 60 segundos
    scheduleVoiceCall(worker.phoneNumber, alert, { delayMs: 60_000 }),
  ]);
  
  // Notificar también al supervisor de turno y a la central de emergencias:
  await notifySupervisor(worker.shiftSupervisorId, alert);
  
  return results.map((r, i) => ({
    layer: ['fcm', 'sms', 'voice'][i],
    success: r.status === 'fulfilled',
  }));
}
```

---

## Parte 3: Áreas Funcionales Incompletas — Completar en Sprint Orden

### 3.1 Persistencia de Nodos de Cálculo en Zettelkasten

Tres módulos calculan datos y los muestran pero no los persisten. Al cerrar la pantalla, los resultados desaparecen.

**BioAnalysis** (`src/pages/BioAnalysis.tsx:68`):
```typescript
// Reemplazar el console.log con persistencia real:
const bioNode: ZettelNode = {
  id: generateNodeId('bio', workerId),
  type: 'biometric_analysis',
  workerId,
  data: { altitudeMetersSL, pulmonaryRiskScore, hematocritEstimate },
  createdAt: FieldValue.serverTimestamp(),
  tags: ['biometrico', 'altitud', 'pulmonar'],
};
await addNode(bioNode); // addNode ya existe en el Zettelkasten service
```

**HazmatStorageDesigner** (`src/components/engineering/HazmatStorageDesigner.tsx:76`):
```typescript
// Cada vez que el diseñador calcula un layout válido, persistir como nodo:
const hazmatNode: ZettelNode = {
  id: generateNodeId('hazmat', siteId),
  type: 'hazmat_storage_design',
  siteId,
  data: { layout, substanceMatrix, safetyDistances, normativaCompliance },
  createdAt: FieldValue.serverTimestamp(),
  linkedTo: [siteNodeId], // conectar al nodo del sitio en el grafo
};
await addNode(hazmatNode);
```

**StructuralCalculator** (`src/components/engineering/StructuralCalculator.tsx:86`):
```typescript
const structNode: ZettelNode = {
  id: generateNodeId('struct', projectId),
  type: 'structural_calculation',
  projectId,
  data: { loads, safetyFactors, materialSpec, result },
  createdAt: FieldValue.serverTimestamp(),
};
await addNode(structNode);
```

---

### 3.2 Completar Tests de `CreateApiKeyModal`

```typescript
// src/components/admin/CreateApiKeyModal.test.tsx:36
// Los 2 TODOs (tier→scopes reset y form submit) se resuelven con:

// 1. Usar userEvent en lugar de fireEvent para simular interacción real:
import userEvent from '@testing-library/user-event';

it('resets scopes when tier changes', async () => {
  const user = userEvent.setup();
  render(<CreateApiKeyModal ... />);
  
  await user.selectOptions(screen.getByLabelText('Tier'), 'enterprise');
  // Verificar que los scopes del tier anterior se limpiaron:
  expect(screen.getByLabelText('Scopes').value).toBe('');
});

// 2. Para el form submit en jsdom, usar submit() directamente sobre el form:
it('calls onSubmit when form is valid', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<CreateApiKeyModal onSubmit={onSubmit} />);
  
  await user.type(screen.getByLabelText('Nombre'), 'test-key');
  await user.click(screen.getByRole('button', { name: /crear/i }));
  
  expect(onSubmit).toHaveBeenCalledOnce();
});
```

---

### 3.3 Resolver `@ts-ignore` en Código de Producción

**`GuardianVoiceAssistant.tsx:14`** — `window.webkitSpeechRecognition`:
```typescript
// Agregar los tipos correctos:
declare global {
  interface Window {
    webkitSpeechRecognition?: typeof SpeechRecognition;
    SpeechRecognition?: new() => SpeechRecognition;
  }
}
const SpeechRecognitionAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition;
```

**`billingService.ts:45`** — Revisar qué campo tiene el `@ts-ignore` y agregar type assertion explícita o extender la interfaz correcta. No silenciar el error sin entender la causa.

**`adService.ts:78`** — Capacitor global:
```typescript
// Usar el tipo de Capacitor correctamente:
import type { Capacitor } from '@capacitor/core';
declare const Capacitor: Capacitor | undefined;
if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) { ... }
```

---

## Parte 4: Protocolo de Validación Pre-Producción

Estas validaciones son **obligatorias** antes de que un trabajador real dependa del sistema. Los tests de CI son necesarios pero no suficientes.

### 4.1 Tests de Campo Mínimos

| # | Escenario | Éxito esperado | Cómo validar |
|---|---|---|---|
| 1 | Teléfono en bolsillo, pantalla bloqueada, 6 horas | Foreground Service activo, heartbeats en log | SQLite local de heartbeats; revisar después |
| 2 | Sin señal 4G ni WiFi, 2 horas continuas | Acceso a normativas pre-descargadas funciona; SLM responde | Modo avión + flujo completo de consulta |
| 3 | Caída simulada sobre colchón | Alerta en < 3 segundos, ventana de cancelación activa | Cronómetro manual; verificar que la alerta llega al supervisor |
| 4 | Batería al 15% | Sistema no crashea, heartbeats siguen enviándose | Descarga controlada de batería; monitorear log |
| 5 | Cambio de turno (nuevo trabajador) | El caché del trabajador anterior NO es accesible en IndexedDB | DevTools → Application → IndexedDB; verificar limpieza |
| 6 | 50 trabajadores simultáneos en la misma faena | Latencia de alertas < 2 segundos; sin errores en logs | k6 load test contra staging environment |
| 7 | Recibo IAP falso (token fabricado) | Servidor rechaza con 400; no se actualiza el tier | Modificar el token manualmente y enviar al endpoint |
| 8 | Ex-empleado intenta acceder con token antiguo | 401 con SESSION_REVOKED después de revocar en admin panel | Flujo manual de revocación + reintento con token viejo |
| 9 | Supervisor sin señal recibe alerta Man Down | Alerta llega por SMS en < 60 segundos | Desactivar WiFi del supervisor antes del test |
| 10 | Modelo ONNX con SHA256 incorrecto | Sistema rechaza la carga, muestra error claro al usuario | Modificar un byte del archivo del modelo |

### 4.2 Piloto Real Mínimo Viable

Antes del lanzamiento comercial:

**Fase 1 (semana 1–2):** Instalación en 2–3 empresas voluntarias con prevencionistas técnicamente sofisticados. Solo módulos de documentación y normativa — sin alertas automáticas. Objetivo: detectar bugs de UX y flujos rotos.

**Fase 2 (semana 3–4):** Activar alertas manuales (el trabajador presiona el botón de emergencia). El Foreground Service ya debe estar probado. Objetivo: validar que las notificaciones llegan en < 10 segundos.

**Fase 3 (semana 5–6):** Un turno nocturno completo monitoreado con el equipo técnico disponible 24/7. Activar detección automática de caída con umbral alto (reducir falsos positivos). Objetivo: 0 alertas perdidas, < 2 falsos positivos por turno.

**Fase 4 (mes 2):** Simulacro formal de emergencia cronometrado. Activar Man Down intencionalmente, medir tiempo desde evento hasta que el equipo de rescate recibe la alerta y confirma. Objetivo: < 3 minutos en condiciones reales.

---

## Parte 5: Decisiones de Arquitectura Que Marcan la Diferencia

### 5.1 Diseñar para Fallo, No para Éxito

Cada componente crítico debe tener una respuesta documentada a la pregunta "¿qué pasa si esto falla?":

| Componente | Fallo posible | Comportamiento correcto |
|---|---|---|
| Firebase Auth | Token expirado sin conexión | Permitir lectura de caché local; bloquear escrituras |
| SLM ONNX | Modelo no descargado | Fallback a respuesta de RAG sin generación; mostrar advertencia |
| BLE sensor | Sin señal del sensor | Continuar monitoreo con los sensores restantes; alertar si llevan > 5 min sin señal |
| Firestore | Sin conexión | Encolar en IndexedDB + mostrar "Modo offline — sincronizando cuando haya señal" |
| Foreground Service | Android lo mató | Reiniciar automáticamente (START_STICKY); registrar el evento para análisis |
| KMS | Cloud KMS inalcanzable | NUNCA hacer fallback al adaptador dev en producción — fallar con error explícito |

### 5.2 El Modelo Mental Correcto para Offline

El offline en Guardian Praeventio no es "funcionalidad degradada". Es la funcionalidad principal.

Los trabajadores en minas, obras y faenas pasan **la mayoría del tiempo sin internet**. El sistema debe diseñarse con offline como el estado normal y online como el estado de sincronización. Esto invierte el modelo mental típico de las apps web:

```
App web típica:  Online → funcionalidad completa
                 Offline → "No hay conexión, intente más tarde"

Guardian:        Offline → funcionalidad completa (lo que el trabajador necesita está pre-cargado)
                 Online  → sincronización, actualizaciones, alertas remotas
```

### 5.3 La Regla de los 3 Segundos

Toda interacción de seguridad crítica debe resolverse en < 3 segundos, sin importar el estado de la red:

- Activar Man Down: < 3s
- Acceder a protocolo de emergencia: < 3s
- Ver el EPP requerido para una tarea: < 3s
- Reportar un incidente: < 5s (tiene más campos)

Si una función crítica de seguridad requiere conexión a internet para responder en < 3 segundos, el diseño es incorrecto.

---

## Orden Cronológico Completo

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Semana 1–2:   Nivel 0 completo
              → MercadoPago webhook
              → KMS_ADAPTER=cloud-kms en Cloud Run (con migración)
              → ctx.skip() → fallo explícito + health-check CI
              → firebase.json con hosting + storage.rules
              → Revocación de tokens al desactivar trabajador
              → Site25DPanel tests descongelados

Semana 3–6:   Nivel 1.1 — Foreground Service Android
              Nivel 1.2 — Outbox de alertas de emergencia
              Nivel 0.4 — Tests de CreateApiKeyModal (paralelo)

Semana 4–8:   Nivel 1.3 — IAP receipt validation (Google + Apple)
              Nivel 1.4 — WebAuthn real (server-side CBOR)

Semana 6–12:  Nivel 1.5 — Offline predictivo
              Nivel 1.6 — Bus de eventos Zustand
              Nivel 1.7 — URLs ONNX verificadas + SHA256

Semana 8–12:  Fase 1 piloto (2–3 empresas, solo documentación)
              Nivel 2.5 — Build Android (requiere JDK local)

Semana 10–14: Fase 2 piloto (alertas manuales activadas)
              Nivel 2.1 — Vertex AI pipeline
              Nivel 2.2 — 39 eventos de analytics

Semana 12–16: Fase 3 piloto (turno nocturno, alertas automáticas)
              Nivel 2.3 — i18n completo
              Nivel 2.4 — CSP estricta

Semana 14–18: Fase 4 piloto — simulacro formal cronometrado
              Nivel 3.1 — AR overlay real
              Nivel 3.2 — MediaPipe local + análisis en vivo

Mes 4–6:      Inicio proceso certificación ISP
              Nivel 3.3 — Certificación regulatoria

Mes 6+:       Expansión geográfica (México, Colombia, Perú)
              ISO 45001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Compromisos de Calidad Innegociables

1. **Una alerta de emergencia nunca se pierde.** Si falla la red, el outbox la reintenta. Si falla el teléfono, el servidor detecta la ausencia del heartbeat.

2. **El sistema falla de forma segura.** Si el SLM no puede cargar, el sistema sigue funcionando. Si el KMS no responde, el sistema falla con error explícito — jamás hace fallback silencioso al adaptador dev.

3. **Ningún dato de salud viaja sin cifrado real.** KMS de desarrollo jamás llega a producción.

4. **La detección de Man Down en offline responde en < 3 segundos.** Si requiere consultar el servidor, el diseño es incorrecto.

5. **El trabajador siempre puede cancelar una falsa alarma en 15 segundos.** Sin esta válvula de escape, los trabajadores desactivan el sistema.

6. **Los documentos de seguridad nunca se resuelven con "último gana".** Siempre requieren resolución humana explícita cuando hay conflicto.

7. **El SLM nunca genera texto normativo sin RAG verificado.** Si no encuentra información, lo dice honestamente.

8. **El sistema soporta 12 horas de turno con batería > 20% al final.** Si consume más, el diseño de polling es incorrecto.

---

*El objetivo no es lanzar rápido. El objetivo es lanzar con la certeza de que el sistema protegerá vidas. Cada atajo técnico en este listado es un riesgo transferido al trabajador.*

*Servidor de desarrollo: `http://localhost:57335` — `npm run dev`*
