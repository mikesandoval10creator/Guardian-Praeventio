# Hoja de Ruta de Implementación — Guardian Praeventio
**Fecha:** 2026-05-07 | **Principio rector:** El sistema nunca puede fallar cuando alguien está en peligro.

---

> **Contexto de lectura**
> Este documento no describe lo que *existe* en el código — eso está en `TECHNICAL_DEBT_AUDIT.md`.
> Este documento describe **cómo completarlo correctamente**, en qué orden, qué puede salir mal,
> y qué validaciones son innegociables antes de que un trabajador real dependa del sistema.

---

## El problema real: la brecha entre "funciona en demo" y "funciona en una mina"

Un minero en el Nivel 8 de una mina de cobre no tiene señal 4G. La pantalla de su teléfono está bloqueada en el bolsillo. Lleva 6 horas sin parar. Su ritmo cardíaco acaba de cruzar 140 bpm. Nadie está mirando la pantalla.

En ese momento, Guardian Praeventio tiene exactamente **dos segundos** para hacer su trabajo antes de que la ventana se cierre. Si falla —por un timeout de red, porque el proceso PWA fue matado por el SO, porque el KMS usó la clave en memoria de desarrollo, porque el JSON del modelo ONNX tenía una URL incorrecta— un ser humano puede morir sin que nadie lo sepa.

Eso define el orden de todo lo que sigue.

---

## Parte 1: Los 4 Niveles de Implementación

### Nivel 0 — Bloqueadores Inmediatos (1–2 semanas, sin negociación)

Estos ítems **no tienen justificación técnica ni de negocio para estar incompletos**. Son configuraciones, wirings, o reemplazos de valores placeholder. Si un trabajador usa el sistema hoy con alguno de estos pendiente, el sistema tiene un agujero de seguridad activo o una garantía que no puede cumplir.

---

#### 0.1 Montar el Webhook de MercadoPago en `server.ts`
**Esfuerzo:** 2 horas | **Riesgo si no se hace:** Los pagos se acreditan en MercadoPago pero el tier del usuario nunca se actualiza en Firestore. El trabajador paga y sigue con funcionalidades bloqueadas. Esto genera disputas y pérdida de confianza.

```typescript
// En server.ts, agregar junto a los otros routers:
import { mercadoPagoIpnRouter } from './routes/billing/mercadoPagoIpn.js';
app.use('/api/billing/webhook', mercadoPagoIpnRouter);
```

**Cuidado:** El endpoint debe validar la firma HMAC del payload de MercadoPago antes de procesar. `mercadoPagoIpn.ts` ya tiene `verifyMpSignature()` — verificar que se llame antes de `procesarPago()`. No confiar en que el payload sea legítimo solo porque llegó al endpoint.

---

#### 0.2 Variable de Entorno KMS en Cloud Run
**Esfuerzo:** 30 minutos | **Riesgo si no se hace:** El PII médico y biométrico de los trabajadores está cifrado con una clave derivada de la string `'praeventio-in-memory-kms-dev-kek-v1'`, que está visible en el código fuente público del repositorio.

```bash
# En la consola de Cloud Run (o en el deploy workflow):
gcloud run services update guardian-backend \
  --set-env-vars KMS_ADAPTER=cloud-kms \
  --set-env-vars KMS_KEY_NAME=projects/PROYECTO/locations/us-central1/keyRings/guardian/cryptoKeys/worker-pii
```

**Cuidado:** Al cambiar de `in-memory-dev` a `cloud-kms`, los datos ya cifrados con la clave dev **no podrán descifrarse** con la nueva clave KMS. Se necesita una migración de datos antes del switch, no después. El procedimiento está en `KMS_ROTATION.md` — seguirlo al pie de la letra. Hacerlo en mantenimiento programado con backup de Firestore verificado.

---

#### 0.3 Reemplazar `ctx.skip()` en Tests de Seguridad Firestore
**Esfuerzo:** 4 horas | **Riesgo si no se hace:** Las reglas de Firestore que impiden que empresa A lea datos de empresa B no son validadas en CI. Una regla mal escrita puede pasar al pipeline sin ser detectada.

Los tests en `src/rules-tests/firestore.rules.test.ts:153` y `src/rules-tests/dirtyDozen.test.ts:114` usan `ctx.skip()` como fallback cuando el emulador no responde a tiempo. La solución correcta no es eliminar el skip, sino **garantizar que el emulador esté siempre disponible en CI**:

```yaml
# En el workflow de CI, asegurar que el emulador esté healthy antes de los tests:
- name: Wait for Firestore emulator
  run: |
    timeout 30 bash -c 'until curl -sf http://127.0.0.1:8080/; do sleep 1; done'
    echo "Firestore emulator ready"
```

Luego reemplazar `ctx.skip()` con una aserción explícita que falle el test si el emulador no está disponible, en lugar de silenciarlo.

---

#### 0.4 `firebase.json` — Agregar Hosting y Storage
**Esfuerzo:** 1 hora | **Riesgo si no se hace:** `firebase deploy` no despliega la PWA. Los archivos de usuarios (fotos de lesiones, reportes médicos) no tienen reglas de Storage declaradas en el pipeline de deploy.

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      { "source": "**/*.@(js|css)", "headers": [{ "key": "Cache-Control", "value": "max-age=31536000,immutable" }] },
      { "source": "**", "headers": [{ "key": "X-Frame-Options", "value": "DENY" }] }
    ]
  },
  "storage": { "rules": "storage.rules" },
  "emulators": { "firestore": { "host": "127.0.0.1", "port": 8080 }, "auth": { "host": "127.0.0.1", "port": 9099 }, "storage": { "host": "127.0.0.1", "port": 9199 }, "ui": { "enabled": false }, "singleProjectMode": true }
}
```

Crear `storage.rules` con reglas mínimas: solo el usuario autenticado puede leer/escribir sus propios archivos, solo admins pueden leer archivos de otros usuarios.

---

### Nivel 1 — Funcionalidades Críticas de Vida (2–8 semanas)

Estas funcionalidades son el núcleo de la promesa del producto. Sin ellas, Guardian Praeventio es una app de gestión de documentos con alertas decorativas.

---

#### 1.1 Foreground Service Nativo (la más crítica de todas)
**Esfuerzo:** 3–4 semanas | **Por qué es la más crítica:** iOS y Android matan procesos PWA cuando la pantalla se bloquea después de ~5 minutos. `useManDownDetection`, `useBluetoothMesh`, y `useHeartRateMonitor` dejan de ejecutarse. El Guardian se duerme justo cuando el trabajador lo necesita más.

**Cómo hacerlo bien:**

*Android:* Crear un Capacitor plugin nativo en `android/app/src/main/java/.../GuardianForegroundService.kt` que implemente `Service` con `startForeground()`. El plugin expone un método `GuardianNative.startWatchdog({ heartbeatInterval: 10000 })` que el hook TypeScript puede llamar al iniciar sesión de trabajo.

```kotlin
// GuardianForegroundService.kt — estructura mínima
class GuardianForegroundService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildPersistentNotification("Guardian Activo — Monitoreo en curso")
        startForeground(NOTIFICATION_ID, notification)
        startHeartbeatLoop() // llama al JS bridge cada 10s
        return START_STICKY // si Android mata el proceso, lo reinicia
    }
}
```

*iOS:* Usar `BGProcessingTaskRequest` y `BGAppRefreshTaskRequest` de Background Tasks framework. Registrar en `Info.plist` con `BGTaskSchedulerPermittedIdentifiers`. Tiempo máximo garantizado: 30 segundos cada ejecución — suficiente para enviar un heartbeat y verificar sensores.

**Cuidado:** En iOS el tiempo de ejecución en background NO es continuo. El sistema lo concede de forma oportunista. La arquitectura correcta es **push-based**: el servidor debe enviar una notificación silenciosa (APNs `content-available: 1`) que despierte la app cuando no recibe un heartbeat esperado. La app no puede garantizar ejecución continua en iOS — el servidor sí puede garantizar detección de ausencia.

**No hacer:** No intentar hackear el sistema con geofencing falso o reproducción de audio silencioso para mantener el proceso vivo. Apple rechaza apps que usan estos trucos y los usuarios los detectan por el consumo de batería.

---

#### 1.2 Verificación Real de Recibos IAP (Google + Apple)
**Esfuerzo:** 2 semanas | **Riesgo activo:** Cualquier persona puede fabricar un recibo falso y obtener acceso al tier Pro o Enterprise sin pagar.

**Google Play — implementación correcta:**
```typescript
// billing.ts — reemplazar el return true por:
import { google } from 'googleapis';

async function verifyGooglePlayReceipt(packageName: string, productId: string, purchaseToken: string): Promise<boolean> {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });
  
  const { data } = await androidpublisher.purchases.subscriptions.get({
    packageName,
    subscriptionId: productId,
    token: purchaseToken,
  });
  
  // paymentState: 1 = pagado, 2 = trial gratuito
  return data.paymentState === 1 || data.paymentState === 2;
}
```

**Apple App Store — implementación correcta:**
Usar la App Store Server API (no el endpoint legacy `/verifyReceipt` que Apple deprecó en 2023). Requiere JWT firmado con la clave privada de App Store Connect.

**Cuidado crítico:** Nunca procesar el mismo `purchaseToken` dos veces (replay attack). Guardar en Firestore el conjunto de tokens ya procesados e idempotency-check antes de actualizar el tier.

---

#### 1.3 WebAuthn Server-Side (endpoint de registro + verificación CBOR)
**Esfuerzo:** 2 semanas | **Riesgo activo:** La biometría actual es un gesto UI sin validación criptográfica. No protege datos reales.

```bash
npm install @simplewebauthn/server
```

```typescript
// curriculum.ts — implementar el endpoint faltante:
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';

router.post('/api/auth/webauthn/register', verifyAuth, async (req, res) => {
  const { credential, challenge } = req.body;
  
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge, // debe estar en Redis/Firestore, no en el request
    expectedOrigin: process.env.APP_ORIGIN!,
    expectedRPID: process.env.RP_ID!,
  });
  
  if (!verification.verified) return res.status(400).json({ error: 'WebAuthn verification failed' });
  
  // Guardar credencial en Firestore (webauthnCredentialStore.ts ya tiene la interfaz)
  await credentialStore.save(req.user.uid, verification.registrationInfo!);
  res.json({ ok: true });
});
```

**Cuidado:** El `challenge` debe ser generado en el servidor, guardado en Firestore/Redis con TTL de 5 minutos, y eliminado después de una verificación exitosa. Nunca usar el challenge enviado por el cliente — es vulnerable a replay attacks. Tampoco usar un challenge fijo o derivado del UID del usuario.

---

#### 1.4 Sincronización Offline Predictiva (el Guardian que anticipa)
**Esfuerzo:** 4–6 semanas | **Por qué importa:** El modo offline reactivo actual guarda lo que el usuario *ya cambió*. En una mina, el trabajador entra al túnel sin haber cambiado nada — el sistema no pre-descargó el manual de la máquina ni su historial médico relevante.

**Arquitectura correcta:**

```typescript
// syncStateMachine.ts — agregar fase de pre-descarga predictiva
async function predictivePrefetch(workerUid: string, scheduleDb: FirestoreDb): Promise<void> {
  // 1. Leer el calendario del trabajador para las próximas 4 horas
  const upcomingTasks = await scheduleDb.getUpcomingTasks(workerUid, { hoursAhead: 4 });
  
  // 2. Para cada tarea, resolver el sub-grafo Zettelkasten necesario
  const nodeIds = await resolveRequiredNodes(upcomingTasks);
  
  // 3. Pre-descargar a IndexedDB antes de que el trabajador pierda señal
  await indexedDbCache.prefetch(nodeIds, { priority: 'high' });
  
  // 4. Registrar qué se pre-descargó y cuándo, para saber qué está stale
  await prefetchLog.record({ workerUid, nodeIds, cachedAt: Date.now() });
}

// Disparar cuando el trabajador abre la app y hay señal:
useEffect(() => {
  if (isOnline && workerScheduleLoaded) {
    predictivePrefetch(currentUser.uid, db);
  }
}, [isOnline, workerScheduleLoaded]);
```

**Cuidado:** Definir un límite de tamaño de caché por dispositivo (recomendado: 50MB máximo). Priorizar: historial médico > manual de máquina > normativa relevante > fotos de incidentes previos. Establecer TTL de frescura: datos médicos = 24h, normativa = 7 días, calendarios = 1h.

---

### Nivel 2 — Infraestructura de Confianza (2–4 meses)

Estas piezas no son visibles para el trabajador, pero son lo que hace que el sistema sea confiable a escala.

---

#### 2.1 Bus de Eventos para Sensores (los sensores que se hablan entre sí)
**El problema actual:** `useBluetoothMesh` detecta que un sensor BLE dejó de responder. `useZettelkastenIntelligence` no sabe esto. `useManDownDetection` tampoco. Cada hook vive en su silo.

**Arquitectura recomendada — Zustand Store centralizado:**

```typescript
// store/sensorBus.ts
interface SensorEvent {
  type: 'BLE_DISCONNECTED' | 'HEART_RATE_SPIKE' | 'FALL_DETECTED' | 'GAS_THRESHOLD_EXCEEDED';
  sensorId: string;
  value: number;
  timestamp: number;
  workerId: string;
}

const useSensorBus = create<{ events: SensorEvent[]; dispatch: (e: SensorEvent) => void }>((set) => ({
  events: [],
  dispatch: (event) => set((state) => {
    // Máximo 1000 eventos en memoria — descartar los más viejos
    const events = [...state.events.slice(-999), event];
    // Notificar al motor de inteligencia automáticamente
    triggerIntelligenceUpdate(event);
    return { events };
  }),
}));
```

Cada hook produce eventos al bus. El motor Zettelkasten suscribe al bus y decide si crear un nodo de alerta. `useManDownDetection` suscribe y correlaciona: caída + frecuencia cardíaca alta + sensor BLE sin respuesta = emergencia real (no falsa alarma).

**Por qué importa para vidas:** La correlación de múltiples sensores reduce dramáticamente los falsos positivos. Un solo sensor que detecta "caída" puede ser el trabajador agachándose. Tres sensores correlacionados en 10 segundos es una emergencia real. Sin el bus, esta correlación no es posible.

---

#### 2.2 Event Bus de Alertas con Garantía de Entrega (at-least-once)
**El problema:** Si el sistema envía una alerta de emergencia y el servidor responde con timeout, ¿la alerta se perdió? ¿Se envió pero no se registró? ¿Se enviará dos veces cuando se reconecte?

**Patrón correcto — Outbox Pattern:**

```typescript
// Antes de enviar cualquier alerta crítica, escribir a Firestore como fuente de verdad:
async function dispatchEmergencyAlert(alert: EmergencyAlert): Promise<void> {
  // 1. Escribir al outbox (idempotente con el ID de la alerta)
  await db.collection('alert_outbox').doc(alert.id).set({
    ...alert,
    status: 'pending',
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  
  // 2. Intentar envío inmediato
  await attemptDelivery(alert);
  
  // 3. Si falla, una Cloud Function con trigger en 'alert_outbox' reintentará
  //    con backoff exponencial hasta 3 intentos en 24 horas
}
```

Esto garantiza que **ninguna alerta de emergencia se pierde**, independientemente de fallos de red.

---

#### 2.3 Vertex AI — Pipeline de Entrenamiento Real
**Esfuerzo:** 4–6 semanas | **Sprint asignado en código:** 33

El modelo predictivo de accidentes es la diferencia entre un sistema reactivo (detecta cuando ya ocurrió algo) y uno preventivo (detecta cuando *va a ocurrir* algo).

**Arquitectura de datos recomendada para entrenamiento:**
- Input: secuencias temporales de sensores BLE + ergonómica REBA + hora del día + condiciones climáticas + historial de incidentes previos del sitio
- Output: probabilidad de incidente en los próximos 30 minutos (umbral de alerta: > 0.7)
- Actualización del modelo: reentrenamiento semanal con datos anonimizados de todas las faenas (federado por empresa — jamás mezclar datos entre empresas)

**Lo que NO hacer:** No entrenar con datos de todas las empresas en un modelo compartido sin federación. Un trabajador de empresa A no debe contribuir a mejorar predicciones que benefician a empresa B sin consentimiento explícito. Usar Federated Learning o, como mínimo, un modelo por empresa con transfer learning desde un modelo base.

---

### Nivel 3 — Inteligencia y Expansión (4–9 meses)

Estas funcionalidades elevan el producto de "buena herramienta de seguridad" a "sistema de prevención inteligente".

---

#### 3.1 URLs ONNX Confirmadas + Descarga Verificada con SHA256
**Antes de lanzar offline SLM a producción**, cada URL de modelo en `slm/registry.ts` debe:
1. Ser confirmada con el proveedor (HuggingFace, Google, Qwen team)
2. Tener un hash SHA256 del archivo esperado hardcodeado en el código
3. Verificar el hash después de la descarga antes de cargar el modelo en memoria

```typescript
// slm/registry.ts — patrón correcto para cada modelo:
{
  name: 'phi-3-mini',
  url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx/resolve/main/cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/phi3-mini-4k-instruct-cpu-int4-rtn-block-32-acc-level-4.onnx',
  sha256: 'HASH_VERIFICADO_CON_EL_PROVEEDOR', // nunca omitir esto
  sizeBytes: 2_100_000_000, // para mostrar progreso de descarga
}
```

Si el SHA256 no coincide, el modelo descargado puede estar corrupto o comprometido. No cargarlo y reportar error al usuario.

---

#### 3.2 WebXR AR Overlay — Implementación Real
**Esfuerzo:** 6–8 semanas | **Ola asignada:** Ola 4

La superposición AR en el gemelo digital tiene alto potencial para reducir accidentes: un trabajador apuntando su teléfono a una máquina debería ver en superposición el manual de operación, las últimas alertas de mantenimiento, y el historial de accidentes de ese equipo específico.

**Implementación correcta con WebXR:**
```typescript
// useArPlacement.ts — reemplazar la sesión simulada por:
async function startRealArSession(): Promise<XRSession> {
  if (!navigator.xr) throw new Error('WebXR no soportado en este dispositivo');
  
  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) throw new Error('AR inmersivo no disponible');
  
  return navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'dom-overlay'],
    domOverlay: { root: document.getElementById('ar-overlay-root')! },
  });
}
```

**Cuidado:** WebXR AR solo funciona en Chrome para Android (ARCore) y Safari iOS 17+ (RealityKit bridge). Verificar `navigator.xr?.isSessionSupported('immersive-ar')` antes de mostrar el botón. En dispositivos sin soporte, ofrecer el gemelo digital 2.5D como alternativa (que ya existe).

---

#### 3.3 Análisis de Postura en Vivo (MediaPipe Local)
**Esfuerzo:** 3–4 semanas | **Bucket:** OO.4

El análisis de video pre-grabado ya funciona. Para el análisis en vivo:

1. Empaquetar MediaPipe WASM en `public/models/mediapipe/` (eliminar dependencia de CDN externo — esto también resuelve el ítem 3.4 de privacidad del audit)
2. Usar `OffscreenCanvas` + Worker para procesar frames sin bloquear el hilo principal
3. Reducir la tasa de análisis a 5 fps (no 30 fps) para dispositivos de gama media-baja

```typescript
// El worker procesa a 5 fps:
const ANALYSIS_INTERVAL_MS = 200;
setInterval(() => {
  const frame = captureVideoFrame(videoElement);
  pose.send({ image: frame });
}, ANALYSIS_INTERVAL_MS);
```

---

## Parte 2: Los 6 Elementos que Pueden Costar una Vida

### 2.1 El Problema de la Batería (el más ignorado)

Un trabajador en turno de 12 horas no puede cargar el teléfono. Si Guardian Praeventio consume un 15% de batería por hora, el dispositivo llega al 20% a las 10 horas. El sistema operativo entra en modo de ahorro de energía y mata los procesos en background.

**Reglas de implementación:**
- El polling de sensores BLE no debe ser más frecuente de cada 10 segundos en reposo, cada 3 segundos si hay anomalía detectada
- Los modelos ONNX deben descargarse solo en WiFi o con consentimiento explícito del usuario cuando usa datos móviles
- MediaPipe en modo vivo debe pausarse cuando la pantalla se bloquea (no tiene sentido analizar postura si el teléfono está en el bolsillo)
- Usar `navigator.getBattery()` y reducir el polling a la mitad si la batería está por debajo del 20%

### 2.2 Race Conditions en Escrituras Offline (el más silencioso)

**Escenario peligroso:** El trabajador marca una inspección como "completada" offline. Vuelve a tener señal. Al mismo tiempo, su supervisor también marcó la misma inspección como "requiere revisión" desde la web. El reconciliador de `syncStateMachine.ts` aplica la regla "último gana" — y el "completado" se sobrescribe silenciosamente con "requiere revisión" sin que nadie lo note.

**Regla de oro:** Para documentos de seguridad (inspecciones, incidentes, alertas), nunca usar "último gana". Usar un vector de causalidad (Lamport timestamp o CRDT) y cuando haya conflicto, **siempre notificar a ambas partes** y requerir resolución manual.

```typescript
// reconciliation.ts — para documentos de tipo 'safety_record':
if (doc.type === 'safety_record' && hasConflict(local, remote)) {
  await conflictQueue.enqueue({ local, remote, requiresHumanResolution: true });
  // No aplicar ninguna versión automáticamente
  return 'CONFLICT_QUEUED';
}
```

### 2.3 El Modelo SLM Que Alucina (Alucinaciones en Contexto de Seguridad)

Los modelos de lenguaje pequeños (Phi-3, Gemma, Qwen) alucinan con mayor frecuencia que los modelos grandes. En contexto de seguridad laboral, una alucinación puede ser:
- "La norma DS 594 permite exposición a polvo de sílice hasta 10 mg/m³" (es 0.025 mg/m³)
- "No se requiere arnés en andamios menores a 3 metros" (es mentira)

**Regla de implementación innegociable:** El SLM **nunca puede generar texto normativo sin RAG verificado** contra la base de datos de normativas (`src/data/normativa/`). El flujo correcto es:

```
Pregunta del usuario → RAG busca en normativa local → SLM reformula el texto recuperado en lenguaje natural → UI muestra con fuente explícita
```

Si el RAG no encuentra nada relevante, el SLM debe responder "No tengo información verificada sobre esto. Consulte el texto oficial de la normativa." — nunca inventar.

### 2.4 Falsos Positivos en Detección de Caída (el que grita lobo)

Si el sistema detecta 3 caídas falsas en un día, los trabajadores desactivan las alertas. Cuando ocurre la caída real, nadie está mirando.

**Umbrales recomendados basados en literatura de wearables industriales:**
- Acelerómetro: umbral de impacto > 3g (no 1g — agacharse activa 1g)
- Validación temporal: el pico de aceleración debe ir seguido de inactividad > 2 segundos (una caída real tiene impacto + quietud)
- Correlación multi-sensor: si el GPS muestra que el trabajador está sentado en el comedor, ignorar el acelerómetro
- Botón de cancelación: 15 segundos para que el trabajador cancele la alerta antes de escalar — con vibración intensa, no solo visual (la pantalla puede estar en el bolsillo)

### 2.5 Sincronización de Roles y Permisos (el ex-empleado que sigue teniendo acceso)

Cuando un trabajador deja de trabajar en empresa A y comienza en empresa B, su rol de Firebase Auth sigue siendo válido para empresa A hasta que un admin lo revoque manualmente. No hay TTL en los custom claims.

**Implementación correcta:**
```typescript
// Al crear un token JWT, incluir un `iat` y un TTL máximo de 8 horas:
// Si el token tiene más de 8 horas, exigir re-autenticación aunque el custom claim sea válido
// Cloud Functions trigger: cuando `workers/{uid}` cambia `status` a 'inactive',
// revocar automáticamente el refresh token:
await admin.auth().revokeRefreshTokens(uid);
```

### 2.6 Notificaciones de Emergencia que No Llegan (el silencio mortal)

FCM (Firebase Cloud Messaging) no garantiza entrega en menos de X segundos en condiciones de señal débil. Las notificaciones push tienen latencia variable y pueden fallar silenciosamente.

**Stack de notificación de emergencia redundante (3 capas):**
1. FCM push notification (velocidad normal, unreliable en señal débil)
2. SMS via Twilio (llega a dispositivos con señal mínima, sin internet)
3. Si el trabajador no confirma en 60 segundos → llamada telefónica automática al número de emergencia del contrato

```typescript
// emergencyNotificationService.ts — estrategia de redundancia:
async function notifyEmergency(workerId: string, alert: EmergencyAlert): Promise<void> {
  // Disparar las 3 en paralelo, no en secuencia:
  await Promise.allSettled([
    fcm.send(workerId, alert),
    sms.send(getPhoneNumber(workerId), formatSmsAlert(alert)),
    scheduleVoiceCall(workerId, alert, delayMs: 60_000),
  ]);
}
```

---

## Parte 3: Protocolo de Validación Antes de Producción Real

Estas validaciones son **obligatorias** antes de que un trabajador real dependa del sistema para su seguridad. Los tests unitarios y de integración son necesarios pero no suficientes.

### 3.1 Tests de Campo Mínimos

| Escenario | Éxito esperado | Cómo validar |
|---|---|---|
| Teléfono en bolsillo, pantalla bloqueada, 6 horas | El Foreground Service sigue activo | Logger persistente en SQLite local que registre heartbeats; revisar después |
| Sin señal 4G / WiFi durante 2 horas | Acceso a normativas pre-descargadas funciona | Modo avión + test de flujo completo |
| Caída simulada (dejar caer el teléfono sobre colchón) | Alerta en menos de 3 segundos | Cronómetro manual |
| Batería al 15% | El sistema no crashea y sigue enviando heartbeats | Descarga controlada de batería |
| Cambio de turno (nuevo trabajador inicia sesión) | El caché del trabajador anterior no es accesible | Inspección de IndexedDB en DevTools |
| 50 trabajadores simultáneos en la misma faena | Latencia < 2 segundos en alertas | Test de carga con k6 apuntando al staging |

### 3.2 Validación con Usuarios Reales (antes del lanzamiento)

El piloto mínimo viable debe incluir:
- **3–5 prevencionistas reales** que usen el sistema durante al menos 2 semanas en condiciones reales (no demo)
- **1 turno nocturno completo** monitoreado con el equipo técnico disponible para intervenir
- **Simulacro de emergencia real** donde se activa intencionalmente una alerta de Man Down y se mide el tiempo de respuesta del equipo de rescate

Sin este piloto, ningún dato de test en CI puede confirmar que el sistema funciona en el entorno hostil real de una mina o faena de construcción.

---

## Parte 4: Compromisos de Calidad No Negociables

### Lo que el sistema SIEMPRE debe garantizar:

1. **Una alerta de emergencia nunca se pierde.** Si falla la red, el outbox pattern la reintenta. Si falla el teléfomo del trabajador, el supervisor recibe la última posición conocida.

2. **El sistema falla de forma segura.** Si el SLM no puede cargar el modelo, el sistema sigue funcionando sin IA (degradación graciosa, no crash). Si el emulador biométrico falla, el sistema permite ingreso con PIN de respaldo.

3. **Ningún dato de salud de un trabajador viaja sin cifrado real.** El KMS de desarrollo nunca puede llegar a producción.

4. **El tiempo de respuesta de una alerta de Man Down en condiciones offline es siempre < 5 segundos.** Si el sistema necesita consultar el servidor para decidir si hay emergencia, el diseño es incorrecto.

5. **El trabajador siempre puede cancelar una falsa alarma en 15 segundos.** Sin esta válvula, el sistema se convierte en una fuente de ansiedad y los trabajadores lo desactivan.

---

## Resumen: El Orden Correcto de Todo

```
Semana 1–2:   Nivel 0 — Wiring, KMS prod, tests de seguridad, firebase.json
Semana 3–6:   Nivel 1.1 — Foreground Service Android (prioridad máxima)
Semana 4–8:   Nivel 1.2 — IAP receipt validation (bloquea monetización confiable)
Semana 5–8:   Nivel 1.3 — WebAuthn real (bloquea certificación de seguridad)
Semana 6–12:  Nivel 1.4 — Offline predictivo (habilita uso real en minas)
Semana 8–14:  Nivel 2.1 — Bus de sensores (habilita correlación anti-falso-positivo)
Semana 10–16: Nivel 2.2 — Outbox de alertas (garantía de entrega)
Semana 12–20: Nivel 2.3 — Vertex AI pipeline (modelo predictivo real)
Mes 4–6:      Piloto real con prevencionistas en terreno
Mes 5–9:      Nivel 3 — AR, SLM URLs, análisis en vivo
Mes 6+:       Certificación regulatoria (Mutual de Seguridad, ISP Chile)
```

---

*El objetivo no es lanzar rápido. El objetivo es lanzar con la certeza de que el sistema protegerá vidas. Cada atajo técnico en este listado es un riesgo transferido al trabajador.*
