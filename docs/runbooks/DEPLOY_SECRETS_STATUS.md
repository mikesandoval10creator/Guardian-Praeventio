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
| `GOOGLE_CLIENT_ID` | ⏳ PENDIENTE | login Google + Calendar/Fit | GCP Console → APIs y servicios → **Credenciales** → ID de cliente OAuth 2.0 (tipo Web) |
| `GOOGLE_CLIENT_SECRET` | ⏳ PENDIENTE | login Google + Calendar/Fit | misma pantalla de Credenciales |
| `VITE_FIREBASE_VAPID_KEY` | ⏳ PENDIENTE | notificaciones push web | Firebase Console → Config proyecto → **Cloud Messaging** → Certificados web push → par de claves |
| `WEBPAY_COMMERCE_CODE` | ⏳ PENDIENTE | pagos Transbank/Webpay | contrato Transbank producción (código de comercio) |
| `WEBPAY_API_KEY` | ⏳ PENDIENTE | pagos Transbank/Webpay | contrato Transbank producción (llave secreta) |
| `KHIPU_RECEIVER_ID` | ⏳ PENDIENTE (opcional) | pagos Khipu | panel de comercio Khipu |
| `KHIPU_SECRET` | ⏳ PENDIENTE (opcional) | pagos Khipu | panel de comercio Khipu |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | ⏳ PENDIENTE (`{}`) | validar compras IAP | Play Console → Acceso a API → cuenta de servicio JSON (**requiere la app publicada en Play**) |

## Notas

- **Esto NO es un atajo de código.** El código de cada integración está completo;
  lo único pendiente es el credencial que entrega un proveedor/consola externa.
  Mientras tanto cada path está fail-closed (devuelve "no configurado" / 503 / 500
  "not configured", sin exponer nada ni romper el resto).
- Los valores marcados `UNCONFIGURED-*` o `000000000000` son placeholders
  deliberados para que el secreto exista (el deploy necesita montarlo) sin fingir
  que la integración funciona.
- Prioridad sugerida de provisión: (1) `GOOGLE_CLIENT_ID/SECRET` + `VITE_FIREBASE_VAPID_KEY`
  (login + push, alto impacto UX), (2) pagos cuando tengas el contrato Transbank,
  (3) Google Play cuando publiques la app.
