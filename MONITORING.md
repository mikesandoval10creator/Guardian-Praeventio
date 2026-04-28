# Praeventio Guard — Monitoring runbook

Operator-facing guide for the Cloud Monitoring stack codified in
`infrastructure/terraform/monitoring.tf`. Source-of-truth SLO definitions
live in `OBSERVABILITY.md`; this file is the *running-the-thing* manual.

> Lenguaje operativo en español-chileno; las tablas técnicas (SLO, costos)
> permanecen en inglés para alinear con `OBSERVABILITY.md`.

---

## Inicio rápido

Después de correr `terraform apply` desde `infrastructure/terraform/`:

1. Las 6 políticas de alerta quedan vivas en GCP. Verifica en
   **Cloud Console → Monitoring → Alerting**.
2. Los dashboards se ven en **Cloud Console → Monitoring → Dashboards**:
   "Praeventio Guard — Operational" y "Praeventio Guard — Business KPI".
3. Acepta el correo de confirmación que GCP envía a
   `soporte@praeventio.net` y `security@praeventio.net` — sin esa
   confirmación los canales de notificación no envían nada.

```sh
cd infrastructure/terraform
terraform plan -out=tfplan
terraform apply tfplan
```

No corras `terraform apply` desde el laptop si CI ya lo hace; se pisan
el state. Ver `infrastructure/terraform/README.md` §State management.

---

## Canales de notificación

| Canal             | Dirección                  | Usado por                                    |
| ----------------- | -------------------------- | -------------------------------------------- |
| Founder email     | soporte@praeventio.net     | Default — todas las alertas P2/P3            |
| Security email    | security@praeventio.net    | Alertas P1 sensibles (KMS, backups)          |
| PagerDuty         | TODO                       | Pendiente: rotación on-call                  |
| Slack #incidents  | TODO                       | Pendiente: app de Slack + token en SM        |

Cuando exista la rotación on-call:

1. Crea un **service** en PagerDuty, copia el integration key.
2. Agrega `pagerduty_service_key` como variable en `variables.tf` y como
   secreto en Secret Manager.
3. Descomenta el bloque `google_monitoring_notification_channel.pagerduty`
   en `monitoring.tf`.
4. Para alertas P1 (SLO #1, #5, #6) cambia el `local.security_notification_channels`
   por `[..., google_monitoring_notification_channel.pagerduty.id]`.

---

## SLO catalog

| #  | SLO                                                | Target          | Window | Alert resource                        | Severity |
| -- | -------------------------------------------------- | --------------- | ------ | ------------------------------------- | -------- |
| 1  | `/api/health` 2xx rate                             | ≥ 99.9%         | 7d     | `api_health_uptime`                   | P1       |
| 2  | Webpay return endpoint p95 latency                 | < 5 s           | 1h     | `webpay_latency_p95`                  | P2       |
| 3  | Health Connect sync success rate                   | ≥ 95%           | 1d     | `health_connect_success_rate`         | P2       |
| 4  | Calendar predictions p99 latency                   | < 10 s          | 1d     | `calendar_prediction_p99`             | P2       |
| 5  | Firestore backup freshness (bonus)                 | < 36h since OK  | —      | `firestore_backup_age`                | P1       |
| 6  | KMS error rate (bonus)                             | < 1%            | 1h     | `kms_error_rate`                      | P1       |

> Todas las políticas embeben su propio runbook en el campo `documentation`
> y se ven al desplegar la alerta en la consola.

---

## Dashboards

Importables como JSON desde la consola si necesitas duplicarlos en otro
proyecto:

- **Console → Monitoring → Dashboards → Create Dashboard → JSON Editor**
- Pega `infrastructure/terraform/dashboards/operational.json` o
  `business.json`.

**Operational** (6 paneles):

1. Request rate por endpoint
2. Latencia p50 / p95 / p99
3. Error rate por status code
4. Cloud Run instance count
5. Firestore reads / writes / deletes
6. KMS operations + error rate

**Business KPI** (6 paneles):

1. Sign-ups por día por tier
2. Active subscriptions por tier
3. Webpay AUTHORIZED count (proxy de revenue)
4. IPER assessments por día
5. Calendar predictions emitidas por día
6. Health Connect connections por proveedor

Algunas series (active_subscriptions, IPER assessments) dependen de
métricas custom que la app aún no emite — los paneles aparecerán vacíos
hasta que el código las publique. Ver TODOs abajo.

---

## Custom metrics declaradas

| Type                                                            | Kind       | Powers SLO |
| --------------------------------------------------------------- | ---------- | ---------- |
| `custom.googleapis.com/praeventio/calendar/prediction_latency_ms` | DISTRIBUTION | #4       |
| `custom.googleapis.com/praeventio/climate/risk_coupling_latency_ms` | DISTRIBUTION | —      |
| `custom.googleapis.com/praeventio/webpay/return_outcome`        | CUMULATIVE | #2         |
| `custom.googleapis.com/praeventio/kms/operations`               | CUMULATIVE | #6         |
| `custom.googleapis.com/praeventio/health_connect/sync`          | CUMULATIVE | #3         |
| `custom.googleapis.com/praeventio/billing/signups`              | CUMULATIVE | KPI        |

Costos: las 6 métricas custom mantienen el footprint bajo el free tier
(~150 MB/mes a la escala actual). Ver §Cost estimate.

---

## Alert response runbook

Cada política embebe su propio runbook. Acceso rápido:

```sh
gcloud alpha monitoring policies list \
  --filter="displayName ~ 'SLO#'" \
  --format="table(displayName,name)"
```

Pasos comunes en cualquier incidente:

1. **Confirma el blast radius**: ¿una región, una ruta, todos los
   usuarios? Mira el dashboard Operational primero.
2. **Mira el commit más reciente**: la mayoría de regresiones P2/P3
   son del último deploy. Compara timestamps.
3. **Cloud Run logs** — el logger emite JSON estructurado; filtra por
   `severity>=ERROR` y por `request_id` si conoces uno.
4. **Decide**: rollback (siempre seguro), feature flag off, hotfix.
5. **Post-mortem**: aún a escala chica, escribe 1 página. Patrones se
   repiten.

Caminos de escalación:

- P1 → cuando exista PagerDuty, despierta al on-call. Hoy: SMS al fundador.
- P2 → email founder + revisar dentro de 4h.
- P3 → email digest, revisar al día siguiente.

---

## Calibración

Los thresholds son *placeholders del primer día*. Después de la primera
semana en producción:

1. Console → Monitoring → Alerting → policy → Edit.
2. Click en "Suggest threshold" — Cloud Monitoring propone uno basado en
   el baseline observado.
3. Actualiza `monitoring.tf` con el nuevo valor (mantén el comentario
   `# CALIBRATE` hasta que hayas validado contra una semana de datos).
4. `terraform apply` desde la nueva rama.

Recursos marcados con `# CALIBRATE` en `monitoring.tf` (en orden de
prioridad de revisión):

1. `api_health_uptime` — el 0.1% asume volumen estable; recalibra cuando
   tengas baseline real.
2. `kms_error_rate` — 1% es generoso; KMS normalmente debe ser ~0%.
3. `webpay_latency_p95` — depende de qué tan rápido responde Transbank
   en producción real; staging es engañosamente lento.
4. `calendar_prediction_p99` — Vertex AI cold-starts dominan; ajusta tras
   habilitar `minInstances=1` en el endpoint.
5. `health_connect_success_rate` — 5% por hora suena alto pero las
   primeras conexiones fallan mucho hasta que el usuario otorga permisos.

---

## Cost estimate

| Concepto                        | Costo                                             |
| ------------------------------- | ------------------------------------------------- |
| Custom metrics                  | $0.30/MB/mes después de 150 MB free               |
| Alert policies                  | gratis                                            |
| Notification channels (email)   | gratis                                            |
| Notification channels (SMS/PD)  | depende del proveedor (PagerDuty no GCP)          |
| Dashboards                      | gratis                                            |
| Log-based metrics               | gratis hasta 50 GB/mes de logs                    |
| **Estimación a escala chica**   | **< US$5/mes** mientras quepamos en el free tier  |

Si el costo de custom metrics empieza a importar, la primera optimización
es bajar la cardinalidad de labels (sacar `tier` o agregar varios tiers
en buckets antes de emitir).

---

## Disabling alerts during planned maintenance

Para silenciar puntualmente:

```sh
gcloud alpha monitoring policies update <policy-id> --no-enabled
```

Para silenciar vía Terraform (recomendado, queda en git):

```hcl
resource "google_monitoring_alert_policy" "api_health_uptime" {
  enabled = false   # <-- temporal; reactivar tras la maintenance window
  # ...
}
```

Nunca dejes alertas deshabilitadas más de 24h sin un TODO con fecha de
re-activación.

---

## Importar dashboards manualmente

Si Terraform no está disponible (caso DR, o un prospecto quiere ver el
shape de los dashboards):

```
Cloud Console → Monitoring → Dashboards → Create dashboard
  → JSON editor → Paste contents of dashboards/operational.json → Save
```

---

## TODOs

- [ ] **PagerDuty integration** — cuando exista rotación on-call.
      Descomentar canal, conectar P1 alerts.
- [ ] **Slack #incidents channel** — bot + OAuth token en Secret Manager.
- [ ] **Threshold calibration after first week** — todos los valores
      marcados `# CALIBRATE` en `monitoring.tf`.
- [ ] **Histogram metric `praeventio/webpay/return_latency_ms`** — la
      alerta SLO #2 actualmente usa el counter como proxy; cambiar a
      histograma cuando el código lo emita.
- [ ] **Métricas custom no emitidas todavía** — `billing/active_subscriptions`,
      `iper/assessments`. Los paneles del business dashboard quedan vacíos
      hasta que el código las publique.
- [ ] **Burn-rate batch job** — calcular el SLO real de 7d (SLO #1) y
      1d (SLO #3, #4) en lugar de usar el proxy de ventana corta.
- [ ] **Sentry quota alert** — agregar cuando se instale Sentry SDK
      (Round 2 de OBSERVABILITY.md).
