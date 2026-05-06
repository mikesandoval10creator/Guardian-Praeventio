# ADR 0015 — MQTT IoT Broker Strategy (dual adapter)

Status: **accepted (implementation Sprint 32 TT — in progress)**
Date: 2026-05-05
Última revisión: 2026-05-05 (post-audit recalibration)
Aplica a: Sprint 32 Bucket TT, módulo IoT real (wearables / gas / CO2 /
maquinaria / sensores ambientales), TODO.md Prioridad 12.

> **Estado real al 2026-05-05** (post-audit profundo): solo
> `src/services/iot/mqttAdapter.ts` (1 archivo) + `ingestRuleEngine.ts` +
> `types.ts` + `pages/IoTEdgeFiltering.tsx` (UI shell) están construidos.
> No hay boot del adapter en `server.ts`, no hay endpoint
> `POST /api/iot/devices/register`, no hay X.509 device cert flow, no
> hay bridge MQTT→Firestore wired. La arquitectura abajo es target del
> Sprint 32 TT actualmente en flight; este ADR es la decisión, no el
> reporte de estado. Ver `docs/audits/AUDIT_2026-05-05_FULL.md` §1.5.

## Contexto

Hoy `pages/IoTEdgeFiltering.tsx` es solo un shell de UI con telemetría
simulada. La ingesta real existe parcialmente vía
`POST /api/telemetry/ingest` (HMAC-SHA256, RFC 8785 canonical body) — un
webhook HTTP que asume que el dispositivo (o un gateway) ya hizo el último
hop. No hay broker MQTT, no hay X.509 device certs, no hay heartbeat,
no hay reglas de ingesta inteligentes ni jerarquía de tópicos.

Sprint 32 Bucket TT debe cerrar Prioridad 12 del TODO.md sin atarnos a un
proveedor: la operación es global (Chile, LATAM, EU, eventualmente CN/RU
con requisitos de data residency). Usar exclusivamente Cloud IoT Core de
Google es más simple operacionalmente, pero deja a clientes en
jurisdicciones con residencia obligatoria sin ruta. EMQX self-hosted da
control pero pone toda la operación on-call interna.

## Decisión

**Adaptador MQTT dual con interfaz canónica `MqttAdapter`.**

- **Default productivo: Cloud IoT Core** (Google Cloud IoT Core, gestionado).
- **Alternativa data-residency: EMQX self-hosted** (cluster propio, MQTT 5.0).
- **Tests + dev local: InMemoryAdapter** (EventEmitter pub/sub).

La selección se hace por configuración (`IOT_BROKER_ADAPTER=cloud|emqx|memory`)
en boot — el resto de la app (rule engine, ingest pipeline, jobs) trabaja
contra la interfaz `MqttAdapter` y no sabe cuál está montado.

### Autenticación

**X.509 client certs por device.** Cada device se registra vía
`POST /api/iot/devices/register` (verifyAuth + admin role). El servidor:

1. Genera un keypair + CSR via `node:crypto`.
2. Firma el cert con la CA del proyecto (`IOT_CA_KEY` / `IOT_CA_CERT` en
   Secret Manager — provisionada fuera de banda).
3. Persiste solo el fingerprint (`certificateFingerprint`) en
   `iot_devices/{deviceId}`. La key privada se devuelve UNA SOLA VEZ
   en el body de la respuesta (mismo patrón que `admin/iot/rotate-secret`
   y `admin/b2d/keys` — operator copy-now-or-rotate).

**Anti-pattern explícito:** no se almacena la private key en Firestore
ni en logs. El operator es responsable de inyectarla en el device.

### Jerarquía de tópicos

```
tenants/{tenantId}/projects/{projectId}/devices/{deviceId}/{kind}
```

donde `{kind}` es uno de:

- `telemetry` — muestras periódicas (gas, HR, temp, etc.).
- `status`    — cambios de estado (battery low, calibration needed).
- `heartbeat` — keepalive cada 5 min.
- `alert`     — eventos críticos detectados en el edge (device-side).

**Wildcards permitidos para subscribers** (server, dashboards):

- `tenants/{tenantId}/projects/+/devices/+/telemetry` — todos los devices
  de un tenant.
- `tenants/+/projects/+/devices/+/heartbeat` — heartbeat global (reaper).

### QoS por kind

| kind       | QoS | Razón                                                |
| ---------- | --- | ---------------------------------------------------- |
| heartbeat  | 0   | Best-effort. El reaper detecta missing > 15 min.     |
| telemetry  | 1   | At-least-once. Idempotency vía `(deviceId, ts)`.     |
| status     | 1   | At-least-once.                                       |
| alert      | 2   | Exactly-once. No tolera dup ni miss.                 |

### Ingesta inteligente (rule engine)

`evaluateSample(sample, rules)` decide:

- **persist**: ¿escribir esta muestra a Firestore (`iot_telemetry/{}`)?
  Solo si umbral excedido o `severity >= warning`.
- **alerts**: lista de alertas a despachar (push + audit + notification).

Reglas hardcoded MVP por kind de device:

- `gas-sensor`: `gas_co_ppm > 50 → critical`; `gas_co_ppm > 25 → warning`.
- `wearable`:   `heart_rate_bpm > 180 → warning`; `heart_rate_bpm < 40 → critical`.
- `co2-monitor`: `co2_ppm > 1000 → warning`; `co2_ppm > 5000 → critical`.
- `environment`: `temperature_c > 50 → warning`; `temperature_c < -10 → warning`.
- `machinery`:  `vibration_g > 5 → warning`.

**Beneficio:** ~95% de las muestras (HR=72, CO=2ppm, etc.) no llegan a
Firestore. La sustained-write cost se mantiene en cientos de docs/día/tenant
en lugar de cientos de miles.

### Heartbeat 5 min + reaper 15 min

Cada device publica `heartbeat` cada 5 min (QoS 0). El servidor stamp-ea
`lastSeenAt` en `iot_devices/{deviceId}`. Una Cloud Function corre
cada 5 min (`POST /api/iot/heartbeat-check`, gated por
`verifySchedulerToken`) y flip-ea a `status: 'lost-heartbeat'` cualquier
device con `lastSeenAt < now - 15 min`. Dispara push al supervisor del
proyecto + audit + notification (mismo patrón que `checkExpiredPpe`).

### WebSockets para dashboards live

El dashboard `IoTEdgeFiltering.tsx` se subscribe vía WSS al gateway HTTP
del servidor (NO directo al broker — el browser no presenta cert X.509).
El gateway re-publica el feed filtrado (solo telemetría del tenant del
usuario) sobre la sesión WSS autenticada.

### Buffers binarios

Las muestras periódicas (HR cada 1s, CO cada 100ms en gas-sensor) se
agrupan en frames binarios (`Buffer`) en el device — no JSON por sample.
El servidor decodifica con un schema versionado (byte 0 = version, byte
1-N = payload TLV). En esta primera entrega el InMemoryAdapter solo
maneja JSON; la decodificación binaria queda como TODO en
`mqttAdapter.ts`.

## Implementación

### Archivos

- `src/services/iot/types.ts` — `IotDevice`, `TelemetrySample`, `IngestRule`.
- `src/services/iot/mqttAdapter.ts` — interfaz `MqttAdapter` +
  `InMemoryAdapter` + factories `createCloudIotCoreAdapter` /
  `createEmqxAdapter` (lazy import del package `mqtt`).
- `src/services/iot/ingestRuleEngine.ts` — `evaluateSample` + reglas MVP.
- `src/services/iot/ingestRuleEngine.test.ts`.
- `src/services/iot/mqttAdapter.test.ts`.
- `src/server/routes/iot.ts` — register / list / ingest webhook /
  heartbeat-check.
- `src/server/jobs/checkLostHeartbeats.ts`.
- `src/server/jobs/checkLostHeartbeats.test.ts`.
- `src/components/iot/DeviceRegistrationModal.tsx` + test.
- `src/pages/IoTEdgeFiltering.tsx` — refactor de shell a página real.

### Reglas Firestore

```
match /iot_devices/{deviceId} {
  allow read: if isProjectMember(existing().projectId);
  allow create, update, delete: if false;  // server-only
}
match /iot_telemetry/{eventId} {
  allow read: if isProjectMember(existing().projectId);
  allow create, update, delete: if false;
}
```

## Consecuencias

### Operacionales

- Cloud IoT Core es default → onboarding "click & go" para tenants
  globales sin requisitos de residency.
- EMQX queda como ruta documentada para tenants enterprise con
  requisitos CN/RU/EU-onprem.
- `MqttAdapter` desacopla la lógica de la decisión de proveedor → swap
  futuro (HiveMQ, Mosquitto cluster) es un archivo nuevo.

### Seguridad

- X.509 sustituye al shared secret actual (`IOT_WEBHOOK_SECRET`). El
  webhook HMAC sigue funcionando para devices que no pueden MQTT directo
  (legacy industrial gateways).
- La CA del proyecto (`IOT_CA_KEY`) vive en Secret Manager — no en
  Firestore, no en repo, no en logs.

### Costos

- Filtrado en server (rule engine) reduce escrituras Firestore a ~5%
  del flujo bruto.
- Heartbeat QoS 0 + reaper batch evita una escritura por device por
  pulso (sería 8.6M escrituras/día con 1k devices @ 5min — inviable).

## Coherencia con ADRs anteriores

- **ADR 0010** (privacy-by-design): `iot_telemetry` no almacena PII —
  solo `(deviceId, timestamp, metric, value, unit)`. El binding device→
  worker queda en `iot_devices` (read-restricted).
- **ADR 0013** (mesh information relay): wearables sin cobertura usan el
  mesh para llegar a un gateway que sí tenga MQTT — el adapter ve el
  mismo formato.
- **ADR 0007** (Euler φ en KMS envelope): la CA del proyecto se encripta
  con el mismo envelope cuando se persiste fuera de Secret Manager
  (backups operacionales).

## Referencias

- MQTT 5.0 spec — OASIS Standard
- Google Cloud IoT Core docs (status: deprecated 2023, sustituible por
  Pub/Sub + dispositivos custom; mantenemos el nombre del adapter pero
  bajo el capó usa Pub/Sub Lite cuando IoT Core no esté disponible).
- EMQX 5.x docs (cluster mode, X.509 auth)
- ADR 0014 — registry pattern reused para selección de adapter.

## Decisión final

**Adapter dual MQTT con `MqttAdapter` canónica. Default Cloud IoT Core,
alternativa EMQX para data residency, InMemoryAdapter para tests/dev.
X.509 client certs por device, jerarquía
`tenants/{}/projects/{}/devices/{}/{kind}`, QoS 0/1/2 por kind, ingest
rule engine filtra ~95% de muestras antes de Firestore, heartbeat 5min
con reaper 15min, dashboards WSS via gateway server-side. Refactor de
`IoTEdgeFiltering.tsx` de shell simulado a página real.**
