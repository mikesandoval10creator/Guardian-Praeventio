# Cowork — qué necesito de ti (Daho) para destrabar el ~15% final

> **Propósito.** Casi todo el roadmap se puede avanzar sin ti (cobertura,
> deuda técnica, wire de features). Pero **~23 ítems están bloqueados por
> secrets/cuentas que solo tú puedes proveer**. Sin ellos, el techo real de la
> plataforma es **~85% E2E** (lo dice `TODO.md §12.5`). Este documento es la
> lista clara y priorizada de lo que necesito en una sesión de **cowork**:
> qué es cada cosa, **cómo obtenerla**, dónde se configura, y qué desbloquea.
>
> Marca con ✅ lo que ya tengas listo. Lo demás lo provisionamos juntos cuando
> me des acceso al cowork.

## Orden de trabajo acordado (2026-05-29)

1. **Ahora (yo, sin ti):** verificar que TODO el código existente funcione —
   cobertura/calidad, cazando bugs (van ~46% líneas, subiendo; 1 bug real ya
   arreglado: Man Down).
2. **Luego (yo, sin ti):** deuda técnica (con la red de tests puesta, reparar
   es seguro).
3. **Luego (yo, sin ti):** features que NO necesitan secrets (wire de
   CalculatorHub UI, mesh consumer, jurisdicciones UI, RAG vectorial…).
4. **Cowork (tú + yo):** los ítems de abajo. Te aviso cuando llegue a esta
   fase; idealmente ya tendrás algunos listos.

---

## 🔴 P0 — Bloquean producción o el lanzamiento en tiendas

| # | Qué necesito | Cómo obtenerlo | Dónde va | Desbloquea |
|---|---|---|---|---|
| **C1** | **KMS key (Cloud KMS)** | GCP Console → Security → Key Management → crear keyring + key. Copia el resource name `projects/.../cryptoKeys/...` | `KMS_KEY_RESOURCE_NAME` + `KMS_ADAPTER=cloud-kms` | **Prod NO bootea sin esto** (fail-fast). Cifrado de PII/médico/tokens. |
| **C2** | **Google Maps API key** | GCP Console → APIs → habilitar Maps JavaScript + restringir por dominio | `VITE_GOOGLE_MAPS_API_KEY` | 4 mapas + Site25D + mapas de evacuación/costero/volcánico (hoy placeholder) |
| **C3** | **Keystore Android (`.jks`)** + SHA-256 | Android Studio → Generate Signed Bundle → crea/expone keystore; o `keytool -genkey`. Dame el SHA-256 | `assetlinks.json` + `signingConfigs` | Firma Android + deep-links + billing RTDN + HealthConnect |
| **C4** | **Apple Developer Program ($99/año)** | developer.apple.com → enrolar; luego provisioning profile + APNS `.p8` | iOS provisioning + `apple-app-site-association` TEAMID | Build iOS + push (APNS) + HealthKit |

> C1 es el más urgente para cualquier deploy productivo. C2 desbloquea la mayor
> cantidad de features visibles. C3/C4 son para el lanzamiento en Play Store / App Store.

## 🟡 P1 — Desbloquean funcionalidad ya programada

| # | Qué necesito | Cómo obtenerlo | Variable | Desbloquea |
|---|---|---|---|---|
| **F1** | Firebase VAPID key | Firebase Console → Cloud Messaging → Web Push certificates | `VITE_FIREBASE_VAPID_KEY` | Push web real (hoy cae a polling) |
| **F2** | Google OAuth client | GCP → Credentials → OAuth client ID (web) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Calendar + Fit + object-lifecycle calendar wire |
| **F3** | MercadoPago prod token | mercadopago.cl → Tus integraciones → credenciales de producción | `MP_ACCESS_TOKEN` + `MP_ENV=production` | Checkout MercadoPago productivo (LATAM) |
| **F4** | Google Play billing keys | Play Console → Monetization setup → RTDN + service account | `GOOGLE_PLAY_*` (3) | Verificación de compras Android + RTDN |
| **F5** | Sentry DSN prod | sentry.io → proyecto praeventio → Settings → Client Keys; **rotar el leak previo** | `SENTRY_DSN` | Error-tracking real en prod |
| **F6** | Scheduler shared secret | Generar `openssl rand -hex 32` y registrarlo en Cloud Scheduler | `SCHEDULER_SHARED_SECRET` | Gate del reaper de mantenimiento + crons admin |
| **F7** | IoT webhook secret | Generar `openssl rand -hex 32` | `IOT_WEBHOOK_SECRET` | Verificación HMAC de telemetría IoT |
| **F8** | Vertex AI project + región | GCP → habilitar Vertex AI; proyecto + `southamerica-west1` | `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` | Residencia de datos IA en Latam |

## 🟢 P2 — Deep-tech / ops (decides cuándo activar)

| # | Qué necesito | Notas | Desbloquea |
|---|---|---|---|
| **D1** | Deploy COLMAP worker (Cloud Run) + `PHOTOGRAMMETRY_WORKER_TOKEN` | El worker ya existe en `cloud-run/photogrammetry-worker/` (325 LOC reales); falta deployarlo | Fotogrametría → Digital Twin de faena |
| **D2** | LibreDWG converter (Cloud Run) | `DWG_CONVERTER_URL` + `_TOKEN` + `CAD_OUTPUT_BUCKET` | Importar planos DWG/CAD |
| **D3** | MQTT broker prod (emqx/cloud-iot) | Decides el adapter; `IOT_BROKER_ADAPTER=cloud\|emqx` | Telemetría IoT en tiempo real (hoy InMemory) |
| **D4** | SHA-256 del modelo Gemma 2 2B | DevOps computa el hash del modelo descargado | Completa el SLM offline (Phi-3 + Qwen ya tienen SHA reales) |

## ⚪ P3 — Externos / proceso comercial (no técnicos)

| # | Qué necesito | Notas |
|---|---|---|
| **E1** | Apple Root CA G3 PEM (full-chain) | Descarga oficial de Apple — para verificar Apple SSN |
| **E2** | Traducciones humanas profesionales | fr/de/it/ja/zh-CN/ar/ko/hi/ru (hoy shells ~1-2%). es-CL/en/pt-BR ya están |
| **E3** | Acuerdos con mutualidades (ACHS/IST/Mutual) | Proceso comercial — opcional para Day-1 |

---

## Cómo trabajaremos el cowork
Cuando llegue a la Fase 4 (o cuando tengas los P0 listos), avísame. Idealmente:
1. Provisionas **C1 (KMS)** y **C2 (Maps)** primero — máximo impacto.
2. En cowork, me das acceso/valores y yo: configuro los `.env`, valido con
   `npm run validate:env`, activo los wire que dependían de cada secret, y
   corro la verificación E2E de cada feature desbloqueada.
3. Cada secret provisto sube el % E2E real y lo dejamos comprobado con tests.

**Importante:** nunca commiteo secrets reales — van solo a Secret Manager /
`.env.local` (gitignored). Este doc solo lista *qué* se necesita, nunca el valor.
