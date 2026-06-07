# Deploy secrets — estado de provisión (Secret Manager)

> Proyecto GCP: `praeventio-541ad` · región `southamerica-west1` · servicio Cloud Run
> `guardian-praeventio`. El deploy (`.github/workflows/deploy.yml`) monta estos 20
> secretos como variables de entorno. El SA `github-guardian-deploy@` tiene
> `roles/secretmanager.secretAccessor` **a nivel proyecto**, así que cualquier
> secreto nuevo es accesible automáticamente (no hay que tocar IAM).

**Última actualización:** 2026-06-07 — los 20 secretos existen; el deploy ya monta
todos. Lo que falta para que cada integración FUNCIONE de verdad es subir el valor
real de los marcados `⏳ PENDIENTE` (requieren una cuenta/consola externa). Todos
son **fail-closed**: si el valor no es real, esa función responde "no configurado"
(no rompe el arranque ni el resto de la app).

## Cómo subir el valor real de un secreto

```bash
printf '%s' "EL_VALOR_REAL" | gcloud secrets versions add NOMBRE \
  --data-file=- --project=praeventio-541ad
```

(El de Google Play es un archivo JSON:
`gcloud secrets versions add GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --data-file=C:\ruta\sa.json --project=praeventio-541ad`)

No hace falta re-desplegar para que el nuevo valor tome efecto en el próximo arranque
del contenedor; para forzarlo ya: `gh workflow run deploy.yml --ref main`.

## Inventario

| Secreto | Estado | Qué activa | De dónde sale el valor real |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ real | IA (Gemini) | ya provisto |
| `SESSION_SECRET` | ✅ real | sesiones | ya provisto |
| `RESEND_API_KEY` | ✅ real | emails | ya provisto |
| `IOT_WEBHOOK_SECRET` | ✅ real | webhooks IoT | ya provisto |
| `VITE_GOOGLE_MAPS_API_KEY` | ✅ real | mapas | ya provisto |
| `VITE_OPENWEATHER_API_KEY` | ✅ real | clima | ya provisto |
| `SENTRY_DSN` | ✅ real | monitoreo errores (server) | Sentry org `praeventio` / proyecto `guardian-praeventio` (obtenido vía conector) |
| `VITE_SENTRY_DSN` | ✅ real | monitoreo errores (cliente) | mismo DSN de Sentry |
| `GOOGLE_PLAY_RTDN_TOPIC` | ✅ real | notif. Play billing | topic Pub/Sub `play-billing-rtdn` (ya existía) |
| `GOOGLE_PLAY_PACKAGE_NAME` | ✅ real | billing Android | `com.praeventio.guard` (del capacitor.config) |
| `MP_IPN_SECRET` | ✅ generado | HMAC webhook MercadoPago | **lo definimos nosotros** (hex aleatorio). Al configurar MercadoPago, usa este MISMO valor en el panel. |
| `DWG_CONVERTER_TOKEN` | ✅ generado | auth conversor DWG/CAD | **lo definimos nosotros** (hex aleatorio). Úsalo como bearer en el servicio conversor (pareado con `DWG_CONVERTER_URL`). |
| `GOOGLE_CLIENT_ID` | ✅ real | login Google + Calendar/Fit | el client OAuth REAL de Firebase Auth (Google sign-in), recuperado del Identity Toolkit |
| `GOOGLE_CLIENT_SECRET` | ✅ real | login Google + Calendar/Fit | mismo client OAuth de Firebase Auth |
| `VITE_FIREBASE_VAPID_KEY` | ⏳ PENDIENTE | notificaciones push web | Firebase Console → Config proyecto → **Cloud Messaging** → Certificados web push → par de claves (no hay API; 1 clic en consola) |
| `WEBPAY_COMMERCE_CODE` | ✅ real (integración) | pagos Transbank/Webpay | código de integración publicado por Transbank (`597055555532`), e2e-verificable con tarjetas de prueba. **Producción:** poner el código del contrato + `WEBPAY_ENV=production`. |
| `WEBPAY_API_KEY` | ✅ real (integración) | pagos Transbank/Webpay | API key de integración publicada por Transbank. **Producción:** llave del contrato + `WEBPAY_ENV=production`. |
| `KHIPU_RECEIVER_ID` | ✅ real (integración) | pagos Khipu | cobrador sandbox publicado por Khipu (`74400`), e2e-verificable. **Producción:** receiver del panel + `KHIPU_ENV=production`. |
| `KHIPU_SECRET` | ✅ real (integración) | pagos Khipu | secret HMAC sandbox publicado por Khipu, e2e-verificable. **Producción:** secret del panel + `KHIPU_ENV=production`. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | ⏳ PENDIENTE (`{}`) | validar compras IAP | Play Console → Acceso a API → cuenta de servicio JSON (**requiere la app publicada en Play** — es prerequisito externo, no código) |

## Estado: 18/20 reales y e2e-verificables

**Cero placeholders falsos.** Lo único pendiente, por dependencia externa que NO se
puede obtener por API:

1. **`VITE_FIREBASE_VAPID_KEY`** — la clave de push web la genera la Firebase Console
   (no hay API). Es 1 clic: *Firebase Console → Configuración del proyecto → Cloud
   Messaging → Certificados push web → par de claves → copiar*. Luego:
   `printf '%s' "LA_CLAVE" | gcloud secrets versions add VITE_FIREBASE_VAPID_KEY --data-file=- --project=praeventio-541ad`
2. **`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`** — requiere la app **publicada en Google Play**
   primero (para crear la cuenta de servicio con acceso a la API de Play). Hasta
   entonces queda `{}` y `/api/billing/verify` responde "Google Play API not
   configured" (fail-closed, no rompe nada).

## Notas

- **Pagos en modo INTEGRACIÓN real:** Webpay (Transbank) y Khipu usan las credenciales
  de **integración publicadas oficialmente** por cada proveedor — el flujo de pago es
  **e2e-verificable** con sus tarjetas/datos de prueba, sin necesitar el contrato de
  producción todavía. Es exactamente el fallback que el código ya usa por diseño
  (`webpayAdapter`/`khipuAdapter` caen a integración cuando no hay creds, "so dev/CI/E2E
  never accidentally hit a real merchant"). Para **producción real** (dinero real): pon
  las credenciales del contrato + `WEBPAY_ENV=production` / `KHIPU_ENV=production`.
- **Cero datos falsos.** Todo valor es real (de su sistema de origen) o una credencial
  de integración publicada. No hay strings inventados pretendiendo ser reales.
- Prioridad pendiente: (1) `VITE_FIREBASE_VAPID_KEY` (1 clic), (2) contratos de
  producción Transbank/Khipu cuando lances pagos reales, (3) Google Play al publicar.
