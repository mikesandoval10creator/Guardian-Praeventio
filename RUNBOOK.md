# Praeventio Guard — Operations Runbook

Procedimientos operacionales del día a día. Para incidentes graves
(corrupción de datos, exfiltración de claves, caída global) ver
[`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Para revisiones de seguridad ver
[`SECURITY.md`](./SECURITY.md).

Última revisión: Round 16 / 2026-04-28.

---

## 1. Run Firestore emulator locally

Útil para correr la suite de reglas (`@firebase/rules-unit-testing`) y para
desarrollo offline sin tocar Firestore real.

### Arranque

```bash
# Una sola vez
npm install -g firebase-tools
firebase login
firebase use praeventio-guard-prod   # o el alias del proyecto

# Cada sesión
firebase emulators:start --only firestore
```

El emulador queda escuchando en `127.0.0.1:8080` (Firestore) y la UI en
`127.0.0.1:4000`. Las reglas que se cargan son las de `firestore.rules`
en la raíz — cualquier cambio se hot-reloadea.

### Apuntar la app al emulador

`firebase-applet-config.json` tiene el flag `useEmulator`, o bien exportar:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
npm run dev
```

El cliente (`src/services/firebase.ts`) detecta la env var y apunta
automáticamente. Las llamadas Admin SDK del server también la honran.

### Seedear data de prueba

Hay 3 caminos:

1. **Endpoint dev** (requiere rol `gerente`): `POST /api/seed-data` →
   crea proyecto demo, miembros, hallazgos, normativas (ver `dataSeedService.ts`).
2. **Glosario**: `POST /api/seed-glossary` (rol `gerente`) carga BCN
   knowledge base + términos comunitarios.
3. **Manual**: importar un dump JSON con la UI del emulador (`Import data`
   button).

### Limpiar entre sesiones

```bash
# Borra todo lo persistido por el emulador (no hay datos en GCP)
firebase emulators:start --only firestore --import=./fresh-state
# o simplemente Ctrl-C (sin --export-on-exit) y la data se va.
```

---

## 2. Deploy to Cloud Run

### Path A: GitHub Actions (preferido)

Push a `main` con un tag `v*.*.*` dispara el workflow
`.github/workflows/deploy-cloud-run.yml` (cuando esté provisionado por R20):

```bash
git tag -a v1.4.0 -m "release 1.4.0"
git push origin v1.4.0
```

El workflow hace:
1. `npm ci && npm run typecheck && npm test` (gate de calidad).
2. `docker build -t gcr.io/praeventio-guard-prod/praeventio:v1.4.0 .`
3. `docker push` + `gcloud run deploy praeventio --image=...`.
4. Smoke test contra `/api/health` post-deploy.
5. Si falla el smoke, rollback automático al revision previo.

### Path B: Manual (Terraform + gcloud)

```bash
cd infrastructure
terraform plan
terraform apply
# Build y push manual
docker build -t gcr.io/praeventio-guard-prod/praeventio:$(git rev-parse --short HEAD) .
docker push gcr.io/praeventio-guard-prod/praeventio:$(git rev-parse --short HEAD)

gcloud run deploy praeventio \
  --image=gcr.io/praeventio-guard-prod/praeventio:$(git rev-parse --short HEAD) \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,SESSION_SECRET=session-secret:latest,WEBHOOK_SECRET=rtdn-webhook-secret:latest,IOT_WEBHOOK_SECRET=iot-webhook-secret:latest,RESEND_API_KEY=resend-api-key:latest \
  --service-account=praeventio-runtime@praeventio-guard-prod.iam.gserviceaccount.com
```

### Verificar el deploy

```bash
gcloud run services describe praeventio --region=us-central1 \
  --format='value(status.url)'

curl -s https://app.praeventio.net/api/health | jq
# Esperado: {"status":"ok", "checks":{"firestore":"ok"}, ...}
```

Si `/api/health` devuelve 503 → ver §6 ("Sentry alerts").

### Rollback rápido

```bash
gcloud run services update-traffic praeventio \
  --region=us-central1 \
  --to-revisions=praeventio-00042-abc=100   # revision anterior
```

Las revisions previas se mantienen 30 días por config de Cloud Run. Lista
con `gcloud run revisions list --service=praeventio --region=us-central1`.

---

## 3. Restore from Firestore backup

**Procedimiento de detalle**: ver [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Resumen:

1. Identificar backup: `gsutil ls gs://praeventio-firestore-backups/`.
2. Restore granular (una colección):
   ```bash
   node scripts/restore-firestore.cjs \
     --backup gs://praeventio-firestore-backups/2026-04-27 \
     --collection invoices \
     --target-project praeventio-guard-prod
   ```
3. Restore total (DR scenario): `gcloud firestore import` desde la consola
   GCP — bloquea las escrituras durante el restore (modo maintenance).
4. Validar integridad: `node scripts/test-backup-integrity.cjs`.

**No restaures sobre la base productiva sin antes** clonarla a un proyecto
de staging y verificar el plan en seco. Un restore "rápido" en producción
ha sido el origen de un incidente DR documentado.

---

## 4. Rotate KMS key

Procedimiento detallado en [`KMS_ROTATION.md`](./KMS_ROTATION.md). Resumen:

### Pre-requisitos
- Acceso al KMS keyring `praeventio-prod` en GCP Console.
- Service account `praeventio-runtime` con rol `roles/cloudkms.cryptoKeyEncrypterDecrypter`.
- Lista de colecciones que usan envelope encryption: `oauth_tokens` (R1).

### Pasos

1. **Generar nueva versión** de la clave:
   ```
   gcloud kms keys versions create \
     --keyring=praeventio-prod \
     --location=us-central1 \
     --key=oauth-envelope-key
   ```
2. **Esperar 5 minutos** (propagación). La nueva versión queda como
   `primary` automáticamente — los nuevos enc/dec usan la versión nueva.
3. **Re-encriptar registros existentes**:
   ```
   node scripts/migrate-oauth-tokens-to-envelope.cjs --rotate
   ```
   El script lee cada `oauth_tokens/{uid}/{provider}`, descifra con la
   versión vieja, cifra con la nueva, y reescribe. Es idempotente —
   re-correrlo es seguro.
4. **Verificar**: `gcloud kms keys versions list ... --filter='state=DESTROY_SCHEDULED'`
   no debe listar la versión nueva.
5. **Auditar**: el log de Cloud KMS muestra cada operación
   `Decrypt` / `Encrypt`. Cuadra el conteo contra el número de registros
   migrados.
6. **Programar destrucción de la versión vieja**: 30 días después
   (`gcloud kms keys versions destroy` con `--scheduled-destroy-time`).

### Si algo sale mal
La versión vieja **no** se destruye automáticamente — sigue accesible para
descifrar registros antiguos. El script puede correrse en modo `--dry-run`
para inspeccionar sin escribir.

---

## 5. Push notifications (FCM)

### Enviar un test FCM al servidor

```bash
gcloud auth application-default login
TOKEN=$(gcloud auth application-default print-access-token)

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://fcm.googleapis.com/v1/projects/praeventio-guard-prod/messages:send \
  -d '{
    "message": {
      "token": "<FCM_TOKEN_DEL_DEVICE>",
      "notification": {
        "title": "Test Praeventio",
        "body": "Mensaje de prueba desde el runbook."
      }
    }
  }'
```

### Obtener un FCM token de un dispositivo
- En la app, abre `Settings` → `Diagnostic` → `Copy FCM Token`. Solo en
  builds dev.
- O lee `users/{uid}.fcmToken` en Firestore (set por `useFCMToken` hook al
  loguear).

### Trigger crítico (incidentes severidad ≥ Alta)
El listener en `server.ts:2674` envía push automáticamente a supervisores
del proyecto cuando se crea un nodo `Hallazgo|Incidente|Riesgo` con
`metadata.severity ∈ {Crítica, Alta}`. Para forzarlo:

```bash
# Crear un incidente de prueba via la app o
firebase firestore:nodes add --collection=nodes \
  --doc='{"type":"Incidente","title":"Test","metadata":{"severity":"Alta"}, "projectId":"<id>"}'
```

---

## 6. Sentry alerts

### Triage de un alert nuevo
1. Abrir Sentry → proyecto `praeventio-server` o `praeventio-web`.
2. Mirar `event.tags`:
   - `endpoint` → ruta HTTP afectada.
   - `method` → verbo.
   - `release` → revision Cloud Run.
3. Ver el breadcrumb trail. Eventos comunes:
   - `firestore_unavailable` → ver §3 (DR).
   - `gemini_quota_exceeded` → revisar Vertex AI quota dashboard; el rate
     limiter del proxy debería haber atajado, si no lo hizo es bug.
   - `webpay_create_failed` → Transbank caído. Status page:
     https://status.transbank.cl. Mientras: deshabilitar tile Webpay en
     Pricing.tsx vía feature flag.
   - `mercadopago_create_failed` → MP API down. Status:
     https://status.mercadopago.com.

### Acknowledge / Silence / Resolve
- **Acknowledge**: cuando estás investigando. No silencia futuros eventos
  iguales.
- **Silence**: por 1h / 24h / 7d / forever. Usar 1h por defecto mientras
  arreglas; nunca silenciar `forever` sin documentar el motivo en el ticket
  vinculado al issue Sentry.
- **Resolve**: solo cuando el fix está deployed. Si el evento vuelve, Sentry
  abre automáticamente.

### Cuándo escalar
- 5xx ratio > 1% por 5 min → page on-call.
- `webpay_return_failed` → bloquea ingresos, page inmediato.
- `kms_decrypt_failed` → potencial pérdida de tokens OAuth, page inmediato.

---

## 7. On-call rotation

> *Pendiente de configuración por el equipo humano.*

Política propuesta:
- Rotación semanal (lunes 9am Santiago / lunes 9am ET para distributed teams).
- Primary + Secondary; el secondary cubre vacaciones del primary.
- PagerDuty / Opsgenie / Google Chat con escalación a 5 min sin ack → 15
  min → 30 min al engineering lead.
- SLO inicial: 5xx ratio < 0.5% sostenido 30 días, p99 latency < 1500 ms en
  `/api/billing/checkout`.

Cuando se concrete la rotación, completar:
- [ ] Tool: ___
- [ ] Schedule URL: ___
- [ ] Escalation policy: ___
- [ ] Primary este mes: ___
- [ ] Secondary este mes: ___

---

## 8. Comandos diagnósticos rápidos

```bash
# Revisar últimos 5xx en producción
gcloud logging read 'resource.type="cloud_run_revision"
  AND severity>=ERROR
  AND httpRequest.status>=500' \
  --project=praeventio-guard-prod \
  --limit=50 \
  --format='value(timestamp,httpRequest.requestUrl,httpRequest.status,jsonPayload.error)'

# Conteo de invoices pending-payment > 24h (potencialmente stuck)
gcloud firestore query \
  --collection=invoices \
  --where='status=pending-payment' \
  --where='createdAt<2026-04-27T00:00:00Z'

# Revisar último RTDN procesado
gcloud firestore query \
  --collection=processed_pubsub \
  --order-by=updatedAt:desc \
  --limit=5
```

---

## 9. Backups

`scripts/backup-firestore.cjs` corre nightly via Cloud Scheduler:
- Horario: 03:00 UTC (00:00 Santiago / 23:00 ET).
- Destino: `gs://praeventio-firestore-backups/{YYYY-MM-DD}`.
- Retención: 30 días (lifecycle policy del bucket).
- Verificación: `scripts/test-backup-integrity.cjs` corre 1h después y
  alerta si el backup está vacío o corrupto.

Para forzar un backup manual antes de un deploy riesgoso:

```bash
node scripts/backup-firestore.cjs --tag=pre-deploy-v1.4.0
```

---

Cualquier procedimiento que falte aquí pero ocurra > 2x al mes,
documéntalo. La regla de oro: **si te encontraste googleando o leyendo
código en lugar de seguir un runbook, el runbook tiene un gap.**
