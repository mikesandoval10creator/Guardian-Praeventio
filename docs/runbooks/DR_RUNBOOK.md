# Disaster Recovery Runbook (DR_RUNBOOK)

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com` / `contacto@praeventio.net`
> **Mutual de seguridad**: ACHS (asistencia operacional Ley 16.744)
> **Timezone**: America/Santiago (CLT/CLST)
> **Última revisión**: 2026-05-03
> **Próxima revisión**: trimestral o post-incidente

Este runbook describe el procedimiento operacional cuando uno o más componentes
críticos de la plataforma Praeventio sufren una pérdida total o degradación
severa que excede el alcance del [Incident Response Runbook](./INCIDENT_RESPONSE.md).
Para incidentes de seguridad ver [docs/security/incident-response.md](../security/incident-response.md).

---

## 1. Scope: ¿qué se considera un disaster?

Un evento se clasifica como **disaster** y activa este runbook cuando se cumple
al menos UNA de estas condiciones:

| Condición | Detalle | Prioridad |
|---|---|---|
| **Cloud Run regional outage** | `southamerica-west1` (Santiago) o `us-central1` no responden por más de 15 minutos en health checks | P0 |
| **Firestore corruption** | Lecturas inconsistentes en colecciones críticas (`audit_logs`, `projects`, `crews`, `processes`, `billing.invoices`, `zettelkasten/nodes`) confirmadas por dos instancias independientes | P0 |
| **KMS key compromise** | Sospecha o confirmación de exposición de `oauth-tokens-kek` u otra cryptoKey usada por `kmsAdapter.ts` | P0 |
| **Full GCP project failure** | El proyecto `praeventio-541ad` no puede ser administrado (billing suspended, IAM lockout, region+region failure simultáneo) | P0 |
| **Pérdida de datos confirmada** | Borrado accidental masivo en una colección crítica | P0/P1 según volumen |
| **Webpay endpoint failure prolongado** | `/webpay/return` con error rate > 50% por más de 30 minutos | P1 |

Los incidentes que **NO** son disasters (single-pod crash, latencia elevada
puntual, una API externa caída) deben tratarse vía
[INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 2. RTO / RPO targets por colección

**RTO** = Recovery Time Objective (tiempo máximo aceptable de downtime).
**RPO** = Recovery Point Objective (pérdida máxima de datos aceptable medida en tiempo).

| Colección / dataset | RTO | RPO | Justificación |
|---|---|---|---|
| `audit_logs` | 4h | 24h | Compliance Ley 16.744 + ISO 27001; reconstruible parcialmente desde Cloud Logging sink |
| `projects`, `crews`, `processes` | 1h | 1h | Datos operacionales en tiempo real; cuadrillas en terreno dependen de éstos |
| `billing.invoices` | 24h | 0 | RPO=0 garantizado por idempotency keys + reconciliación con Transbank/Khipu/Google Play |
| `zettelkasten/nodes` | 4h | 24h | Knowledge graph; reconstruible desde fuentes upstream pero costoso |
| `users`, `auth_sessions` | 2h | 1h | Re-login forzoso aceptable si fuera necesario |
| `health.observations` (HealthKit/Health Connect) | 8h | 24h | Datos sensibles pero re-sincronizables desde dispositivos del usuario |

**Nota sobre `billing.invoices` RPO=0**: la idempotencia se garantiza vía
`idempotency_key` único por intent de pago + reconciliación periódica contra
los webhooks de Transbank, Khipu y Google Play. Si Firestore pierde una invoice,
la reconciliación la regenera desde la fuente del proveedor.

---

## 3. Estrategia de backups

### 3.1 Firestore: backups diarios automatizados

- **Trigger**: Cloud Scheduler ejecuta job `firestore-daily-export` a las 03:00 CLT.
- **Destino**: `gs://praeventio-backups/firestore/YYYY-MM-DD/`
- **Retención**: 30 días en Standard, 365 días en Coldline (Object Lifecycle Management).
- **Cobertura**: todas las colecciones del proyecto `praeventio-541ad`.
- **Versionado**: bucket con Object Versioning habilitado.

Comando manual de export (si Scheduler falla):

```bash
gcloud firestore export gs://praeventio-backups/firestore/$(date +%Y-%m-%d) \
  --project=praeventio-541ad \
  --async
```

### 3.2 Cloud Storage: replicación cross-region

- **Bucket primario**: `praeventio-uploads` (multi-region `nam4` o `southamerica-west1`).
- **Backup**: réplica en `us-east1` mediante Storage Transfer Service (sync diario).
- **Cifrado**: CMEK con `oauth-tokens-kek` para buckets sensibles.

### 3.3 Cloud Logging: sink permanente

- Sink `audit-logs-archive` exporta logs a `gs://praeventio-audit-archive/`
  con retención de 7 años (cumplimiento Ley 16.744 art. 76).

### 3.4 Verificación de backups (mensual)

**Imprescindible**: un backup no verificado es un backup que no existe.

El primer lunes de cada mes a las 10:00 CLT:

1. Restaurar el último export de Firestore al proyecto `praeventio-staging`.
2. Ejecutar suite de integridad: `pnpm run test:dr-restore` (verifica conteos,
   integridad referencial entre `projects` ↔ `crews` ↔ `processes`, e
   idempotencia de `billing.invoices`).
3. Documentar el resultado en `docs/runbooks/restore-rehearsals/YYYY-MM.md`.
4. Si falla: abrir issue P1 etiquetado `dr-rehearsal-failure` y notificar a
   `contacto@praeventio.net`.

---

## 4. Failover regions

| Tier | Region primaria | Region secundaria | Tipo de switch |
|---|---|---|---|
| Cloud Run (API) | `us-central1` | `us-east1` | Manual (revision split) |
| Firestore | `nam5` (multi-region) | N/A — ya es multi-region | Automático |
| Cloud Storage | `southamerica-west1` | `us-east1` (replicado) | Manual (DNS o config flip) |
| KMS | `southamerica-west1` | `southamerica-east1` (Buenos Aires) | Manual con re-encrypt |

**Nota sobre KMS multi-region**: la cryptoKey `oauth-tokens-kek` está en
`southamerica-west1`. Una versión replicada en `southamerica-east1` se mantiene
como fallback frío (no automático) y solo se activa bajo procedimiento de la
sección 5.3 del [KMS_ROTATION.md](./KMS_ROTATION.md).

---

## 5. Procedimiento step-by-step

### 5.1 Detección

1. **Alerta automática**: Cloud Monitoring dispara una de las alertas críticas
   (uptime check fallido > 5 minutos, error rate > 10%, latency p99 > 10s).
2. **Confirmación manual**: Daho (o on-call equivalente) confirma vía:
   - Status page externa (`https://status.cloud.google.com`)
   - Test manual de los 3 endpoints sintéticos (`/api/health`, `/api/me`, `/webpay/return` smoke)
   - Si Cloud Monitoring está caído, ver Sentry (`praeventio` org)
3. **Declaración de disaster**: si el incidente cumple criterios de §1, declarar
   "DISASTER ACTIVE" en el canal `#incidents` (cuando exista) o por email a
   `contacto@praeventio.net` con asunto `[DR ACTIVE] <YYYY-MM-DD HH:MM> <componente>`.

### 5.2 Switch de tráfico (Cloud Run)

Si la región primaria está caída pero la secundaria está sana:

```bash
# 1. Verificar que la revisión secundaria esté desplegada y healthy
gcloud run services describe praeventio-api \
  --region=us-east1 \
  --project=praeventio-541ad

# 2. Reservar tráfico 100% a us-east1
gcloud run services update-traffic praeventio-api \
  --region=us-east1 \
  --to-revisions=LATEST=100 \
  --project=praeventio-541ad

# 3. Actualizar DNS / Load Balancer si aplica
# (Cloud Load Balancer con backend service multi-region: ya rutea automáticamente
# si el backend us-central1 está unhealthy. Verificar con:)
gcloud compute backend-services get-health praeventio-backend \
  --global \
  --project=praeventio-541ad

# 4. Validar
curl -fsS https://api.praeventio.net/health
```

**Tiempo objetivo**: 15 minutos desde declaración de disaster.

### 5.3 Restore desde backup (si hay corrupción de datos)

```bash
# 1. Identificar el último export sano (verificar last-rehearsal log)
gsutil ls gs://praeventio-backups/firestore/ | tail -10

# 2. Restaurar al proyecto de recuperación (staging primero, NUNCA directo a prod)
gcloud firestore import gs://praeventio-backups/firestore/2026-05-02/ \
  --project=praeventio-staging \
  --async

# 3. Validar integridad: pnpm run test:dr-restore --project=praeventio-staging

# 4. Si validación OK, restaurar a producción con --collection-ids selectivo
#    para minimizar el alcance (NO importar collection-ids ya sanas)
gcloud firestore import gs://praeventio-backups/firestore/2026-05-02/ \
  --collection-ids='audit_logs,projects' \
  --project=praeventio-541ad \
  --async

# 5. Re-validar en producción + invalidar cachés (Redis si aplica)
```

**Tiempo objetivo**: 1-4h según RTO de la colección afectada (ver §2).

### 5.4 KMS key compromise — rotación de emergencia

Procedimiento detallado en [KMS_ROTATION.md §3](./KMS_ROTATION.md). Resumen:

1. Crear nueva versión de la cryptoKey.
2. Re-encryptar todos los OAuth tokens en Firestore con la nueva versión.
3. Marcar versión vieja como `DESTROYED`.
4. Auditar acceso a la versión comprometida en Cloud Audit Logs.

### 5.5 Post-incident review (template)

Generar dentro de las 72h post-recovery un documento en
`docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md` con:

```markdown
# Post-mortem: <título>

- **Fecha del incidente**: YYYY-MM-DD HH:MM CLT
- **Duración del downtime**: HH:MM
- **Severidad**: P0 / P1
- **Componentes afectados**:
- **Usuarios afectados** (estimado):
- **Pérdida de datos** (sí/no, alcance):

## Timeline (en CLT)
- HH:MM — Primer síntoma observado
- HH:MM — Alerta disparada
- HH:MM — Disaster declarado
- HH:MM — Acción 1
- HH:MM — Servicio recuperado
- HH:MM — Validación completa

## Root cause

## Contributing factors

## What went well

## What went poorly

## Action items
- [ ] (Owner) Acción correctiva 1 — due YYYY-MM-DD
- [ ] (Owner) Mejora del runbook — due YYYY-MM-DD

## Lessons learned
```

---

## 6. Rehearsal schedule (simulacros)

**Compromiso**: al menos 1 simulacro de DR completo por trimestre (cada 90 días).

| Trimestre | Tipo de simulacro | Owner |
|---|---|---|
| Q1 | Restore Firestore a staging + validación de integridad | Daho |
| Q2 | Region failover Cloud Run (us-central1 → us-east1) en horario de baja carga | Daho |
| Q3 | KMS rotation simulada (no destructiva) | Daho |
| Q4 | Full disaster: restore + failover + KMS rotation encadenados | Daho + ACHS observa |

Cada simulacro produce un documento en `docs/runbooks/rehearsals/YYYY-Q<n>.md`
con: hipótesis previa, ejecución, métricas (RTO/RPO observados vs target),
hallazgos, action items.

**Si el equipo aún es single-dev**: mínimo 1 simulacro trimestral en horario
no laboral con buddy externo (par técnico de confianza) como observador.

---

## 7. Contactos de escalamiento

| Rol | Contacto | Cuándo escalar |
|---|---|---|
| Founder / CTO | Daho Sandoval — `dahosandoval@gmail.com` / `contacto@praeventio.net` | Siempre primero |
| Mutual ACHS | Soporte operacional Ley 16.744 | Si la caída afecta servicio prevencional contractual |
| GCP Support | Console → Support → Create Case (severity P1 si es plataforma) | Cuando el problema es claramente de GCP y no del código |
| Transbank Support | Email a soporte@transbank.cl | Failures sostenidos en `/webpay/return` |
| Sentry | praeventio.sentry.io | Para correlación de errores durante el incidente |

---

## 8. Compliance y reporte regulatorio

- **Ley 16.744** (Chile, accidentes del trabajo): si el outage impide el
  funcionamiento de la plataforma de prevención durante una emergencia laboral,
  notificar a la mutual ACHS dentro de las 24h.
- **Ley 21.719** (protección de datos personales, Chile): si el disaster involucra
  pérdida o exposición de datos personales, reportar a la ANPD dentro de 72h
  (ver [docs/security/incident-response.md](../security/incident-response.md)).
- **ISO 27001 A.17** (continuidad del negocio): cada disaster declarado debe
  registrarse en el ISMS con el post-mortem asociado.

---

## 9. Apéndices

- [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) — runbook maestro de incidentes
- [KMS_ROTATION.md](./KMS_ROTATION.md) — runbook específico de rotación KMS
- [docs/security/incident-response.md](../security/incident-response.md) — incidentes de seguridad
- [docs/security/severity-rubric.md](../security/severity-rubric.md) — clasificación de severidad
