# KMS Key Rotation Runbook (KMS_ROTATION)

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com` / `contacto@praeventio.net`
> **Timezone**: America/Santiago (CLT/CLST)
> **Última revisión**: 2026-05-03
> **Próxima revisión**: post-Sprint 21 cutover, luego trimestral

Este runbook describe la provisión inicial, la rotación regular, la rotación
de emergencia y el monitoreo de las KMS keys que cifran datos sensibles
(actualmente OAuth tokens, futuramente PII de salud y backups Coldline).

Contexto: en Sprint 20 multi-agent (PR #28) se cambió `KMS_ADAPTER=in-memory-dev`
a `cloud-kms` con la env var `KMS_KEY_RESOURCE_NAME`. El secret debe
provisionarse antes del próximo deploy a producción (ver §1).

---

## 1. Sección 1 — Setup inicial (pre-Sprint 21 cutover)

### 1.1 Pre-requisitos

- Cuenta GCP con rol `roles/cloudkms.admin` sobre el proyecto `praeventio-541ad`.
- API `cloudkms.googleapis.com` habilitada.
- Service account de Cloud Run (`praeventio-api@praeventio-541ad.iam.gserviceaccount.com`)
  con rol `roles/cloudkms.cryptoKeyEncrypterDecrypter` sobre el keyring que vamos
  a crear.
- GitHub Actions con permisos para leer secrets del repositorio.

### 1.2 Crear el keyring `praeventio` en `southamerica-west1`

La región `southamerica-west1` (Santiago) es prioritaria por dos razones:
proximidad para reducir latencia de las operaciones de cifrado/descifrado, y
residencia de datos en territorio chileno (alineado con Ley 21.719 sobre
transferencia internacional de datos personales).

```bash
# 1. Crear el keyring
gcloud kms keyrings create praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

# 2. Verificar
gcloud kms keyrings list \
  --location=southamerica-west1 \
  --project=praeventio-541ad
```

### 1.3 Crear la cryptoKey `oauth-tokens-kek`

KEK = Key Encryption Key. Cifra las DEK (Data Encryption Keys) que a su vez
cifran los OAuth tokens almacenados en Firestore.

```bash
gcloud kms keys create oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time=$(date -u -d "+90 days" +%Y-%m-%dT%H:%M:%SZ) \
  --protection-level=software \
  --project=praeventio-541ad
```

**Output esperado** (forma del recurso):

```
projects/praeventio-541ad/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek
```

### 1.4 Asignar IAM al service account de Cloud Run

```bash
gcloud kms keys add-iam-policy-binding oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --member=serviceAccount:praeventio-api@praeventio-541ad.iam.gserviceaccount.com \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter \
  --project=praeventio-541ad
```

### 1.5 Provisionar el secret en GitHub Actions

1. Ir a GitHub → repo Praeventio → Settings → Secrets and variables → Actions.
2. Crear secret `KMS_KEY_RESOURCE_NAME` con valor:
   ```
   projects/praeventio-541ad/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek
   ```
3. Verificar que `deploy.yml` lea el secret y lo pase como env var al
   `gcloud run deploy` (`--set-env-vars`).

**Validación post-setup**:

```bash
# Smoke test: cifrar una cadena dummy y descifrarla
echo -n "smoke-test-$(date +%s)" | gcloud kms encrypt \
  --plaintext-file=- \
  --ciphertext-file=/tmp/encrypted.bin \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

gcloud kms decrypt \
  --ciphertext-file=/tmp/encrypted.bin \
  --plaintext-file=- \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

rm /tmp/encrypted.bin
```

Si el smoke test pasa, el setup está completo y se puede proceder con el
deploy a producción usando `KMS_ADAPTER=cloud-kms`.

---

## 2. Sección 2 — Verificación post-rotation (rotación automática)

GCP rota automáticamente la cryptoKey cada 90 días (configurado en §1.3).
La rotación crea una nueva versión activa pero **NO destruye la anterior**:
las versiones viejas quedan disponibles para descifrar datos cifrados con
ellas, lo que garantiza zero-downtime.

### 2.1 Detección de la rotación

GCP envía un evento a Cloud Logging cuando se crea una nueva versión.
La alerta `kms-rotation-detected` (ver §5.2) notifica vía email a
`contacto@praeventio.net`.

### 2.2 Verificación manual

```bash
# Listar versiones de la key
gcloud kms keys versions list \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

# Output esperado: la versión más nueva está en estado ENABLED
# y es la "primary" (la que se usa para nuevas operaciones de encrypt)
```

### 2.3 Validar que `kmsAdapter.ts` use la nueva versión sin downtime

El adapter debe usar el resource name SIN especificar versión (ej:
`projects/.../cryptoKeys/oauth-tokens-kek`, no
`.../cryptoKeyVersions/3`). Cuando no se especifica versión en operaciones
de encrypt, GCP usa automáticamente la primary version.

**Checklist de validación post-rotation**:

```bash
# 1. Smoke test desde Cloud Run en producción
curl -fsS -H "Authorization: Bearer $TOKEN" \
  https://api.praeventio.net/api/oauth/health

# 2. Validar que un OAuth token nuevo se cifra con la versión nueva
# (revisar audit logs de KMS para confirmar el cryptoKeyVersion usado)
gcloud logging read \
  'resource.type="cloudkms.googleapis.com/CryptoKey"
   AND protoPayload.methodName="Encrypt"' \
  --limit=10 \
  --project=praeventio-541ad \
  --format="value(protoPayload.resourceName)"

# 3. Validar que tokens viejos (cifrados con la versión anterior) siguen siendo
# descifrables. Esto se hace con un test de regresión:
pnpm run test:kms-rotation-regression
```

Si el test falla, NO destruir la versión vieja. Ver §3 para procedimiento de
recuperación.

---

## 3. Sección 3 — Emergency rotation (key compromise)

**Cuándo aplicar**: sospecha o confirmación de exposición de la cryptoKey o
acceso no autorizado al keyring. NO usar para rotación regular (eso lo hace §2).

### 3.1 Declarar el incidente

1. Marcar como P0 en [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).
2. Notificar a `contacto@praeventio.net` con subject `[KMS COMPROMISE] <YYYY-MM-DD>`.
3. Iniciar war room (ver INCIDENT_RESPONSE.md §4).

### 3.2 Crear nueva versión inmediatamente

```bash
# 1. Crear nueva primary version
gcloud kms keys versions create \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

# 2. Listar para confirmar el ID de la nueva versión (ej: "5")
gcloud kms keys versions list \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

# 3. (Opcional pero recomendado) marcar la nueva versión como primary explícitamente
gcloud kms keys set-primary-version oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --version=5 \
  --project=praeventio-541ad
```

### 3.3 Re-encrypt de los OAuth tokens existentes

Los tokens cifrados con la versión comprometida deben re-cifrarse con la
nueva versión antes de destruir la versión vieja.

```bash
# Ejecutar el script de re-encrypt (existente en scripts/ops/reencrypt-oauth-tokens.ts)
pnpm run ops:reencrypt-oauth-tokens \
  --from-version=4 \
  --to-version=5 \
  --project=praeventio-541ad

# Validar que la cantidad de tokens re-cifrados coincida con el conteo de Firestore
```

### 3.4 Revocar (deshabilitar y luego destruir) la versión comprometida

```bash
# 1. DISABLE primero (reversible durante 24h)
gcloud kms keys versions disable 4 \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad

# 2. Esperar 24h validando que NO hay errores de descifrado en producción
#    (los hay si quedó algún token sin re-encryptar)

# 3. DESTROY la versión (irreversible, 24h grace period antes de purga real)
gcloud kms keys versions destroy 4 \
  --key=oauth-tokens-kek \
  --keyring=praeventio \
  --location=southamerica-west1 \
  --project=praeventio-541ad
```

### 3.5 Auditoría post-revocación

Revisar Cloud Audit Logs para identificar qué principal accedió a la versión
comprometida y cuándo:

```bash
gcloud logging read \
  'resource.type="cloudkms.googleapis.com/CryptoKeyVersion"
   AND protoPayload.resourceName=~"oauth-tokens-kek/cryptoKeyVersions/4"' \
  --project=praeventio-541ad \
  --format=json > /tmp/kms-audit.json

# Analizar accesos: principal, source IP, métodos invocados, timestamp
```

Esto va al post-mortem (template en INCIDENT_RESPONSE.md §6).

### 3.6 Notificación regulatoria

Si la versión comprometida cifró datos personales (Ley 21.719 Chile):
notificar a la ANPD dentro de las 72h aunque no se confirme exfiltración.

---

## 4. Sección 4 — Terraform (provisionamiento idempotente)

Cuando el setup pase de manual a IaC (objetivo: Sprint 22), el siguiente
módulo Terraform debe vivir en `infra/terraform/kms.tf`.

```hcl
# infra/terraform/kms.tf
# Idempotente: ejecutar `terraform apply` repetidamente es seguro.

resource "google_kms_key_ring" "praeventio" {
  name     = "praeventio"
  location = "southamerica-west1"
  project  = var.gcp_project
}

resource "google_kms_crypto_key" "oauth_tokens_kek" {
  name            = "oauth-tokens-kek"
  key_ring        = google_kms_key_ring.praeventio.id
  rotation_period = "7776000s" # 90 days
  purpose         = "ENCRYPT_DECRYPT"

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    # Proteger contra destrucción accidental: requiere -replace explícito.
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "cloud_run_encrypter_decrypter" {
  crypto_key_id = google_kms_crypto_key.oauth_tokens_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${var.cloud_run_sa_email}"
}

# Output: el resource name que va en el secret KMS_KEY_RESOURCE_NAME
output "oauth_tokens_kek_resource_name" {
  value     = google_kms_crypto_key.oauth_tokens_kek.id
  sensitive = false
}
```

Variables (`infra/terraform/variables.tf`):

```hcl
variable "gcp_project" {
  type        = string
  description = "GCP project ID (e.g. praeventio-541ad)"
}

variable "cloud_run_sa_email" {
  type        = string
  description = "Email del service account de Cloud Run"
  default     = "praeventio-api@praeventio-541ad.iam.gserviceaccount.com"
}
```

Comandos:

```bash
cd infra/terraform/
terraform init
terraform plan -var="gcp_project=praeventio-541ad"
terraform apply -var="gcp_project=praeventio-541ad"
```

---

## 5. Sección 5 — Monitoring (Cloud Monitoring metrics)

### 5.1 Métricas relevantes

| Métrica | Métrica resource | Alerta |
|---|---|---|
| `cryptoKeyVersionCreated` | Auditlog event | Notificar cada rotación |
| `Encrypt` request count | `cloudkms.googleapis.com/Encrypt` | Caída > 90% sostenida indica problema |
| `Encrypt` latency p95 | Latency metric | > 500ms p95 sostenido |
| `Decrypt` errors | Status code != OK | Cualquier error es page-worthy |
| Permission denied (IAM) | Audit log | Posible compromise o misconfiguration |

### 5.2 Alerta `kms-rotation-detected`

Configuración (gcloud Monitoring policy):

```bash
gcloud alpha monitoring policies create \
  --policy-from-file=infra/monitoring/kms-rotation-policy.yaml \
  --project=praeventio-541ad
```

Donde `kms-rotation-policy.yaml` filtra por:
```
protoPayload.methodName="CreateCryptoKeyVersion"
AND protoPayload.resourceName=~"oauth-tokens-kek"
```

Notificación: email a `contacto@praeventio.net` (canal `email-daho`).

### 5.3 Alerta `kms-decrypt-errors`

Threshold: > 5 errores de Decrypt en una ventana de 5 minutos. Severidad P1
(potencial bug en `kmsAdapter.ts` o token cifrado con versión destruida).

### 5.4 Dashboard

Crear dashboard `KMS Operations` en Cloud Monitoring con:
- Operations/sec (Encrypt + Decrypt)
- Latency p50/p95/p99
- Error rate (todos los métodos)
- Versiones activas (de Audit Log via log-based metric)
- Última rotación (timestamp)

---

## 6. Cronograma de rotación

| Evento | Cadencia | Responsable |
|---|---|---|
| Rotación regular automática | 90 días (gestionada por GCP) | GCP |
| Verificación post-rotación | Dentro de 24h post-rotación | Daho |
| Smoke test E2E de cifrado/descifrado | Mensual | Daho |
| Revisión de IAM bindings | Trimestral | Daho |
| Simulacro de emergency rotation | Semestral | Daho |

---

## 7. Apéndices

- [DR_RUNBOOK.md](./DR_RUNBOOK.md) — disaster recovery (incluye KMS compromise como disaster)
- [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) — runbook maestro de incidentes
- [docs/security/incident-response.md](../security/incident-response.md) — incidentes de seguridad
- `apps/server/src/infra/kms/kmsAdapter.ts` — implementación del adapter (referencia de código)
- [Sprint 20 multi-agent PR #28](https://github.com/dahosandoval/Praeventio/pull/28) — cambio in-memory-dev → cloud-kms

## Professional RUT lookup key rotation

The encrypted professional RUT follows the KMS envelope lifecycle above. Its
deterministic duplicate-detection index uses the separate versioned secret
`HEALTH_PROFESSIONAL_LOOKUP_KEYS`; rotate it with the dual-read/reindex procedure
in `SECRETS_RUNBOOK.md`. Rotating the KMS KEK does not rotate this HMAC secret.
Replacing the HMAC secret without retaining the prior version can permit
duplicate civil identities, so removal is allowed only after a server-side
reindex, count reconciliation, smoke test, and rollback window.
