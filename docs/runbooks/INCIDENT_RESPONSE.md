# Incident Response Runbook (INCIDENT_RESPONSE)

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com` / `contacto@praeventio.net`
> **Mutual de seguridad**: ACHS (Asociación Chilena de Seguridad)
> **Timezone**: America/Santiago (CLT/CLST)
> **Última revisión**: 2026-05-03
> **Próxima revisión**: trimestral o post-incidente significativo

Este runbook es el documento maestro para la gestión de incidentes operacionales,
de seguridad, de billing y de plataforma. Extiende y orquesta los runbooks
especializados; **no reemplaza** [docs/security/incident-response.md](../security/incident-response.md),
que mantiene el procedimiento detallado para vulnerabilidades de seguridad
reportadas externamente.

---

## 1. Severity levels y SLAs

La clasificación define quién responde, en cuánto tiempo, y qué procedimiento
se activa. La severidad se asigna en triage inicial y puede ser reclasificada
durante el incidente.

| Severidad | Definición | Time to acknowledge | Time to mitigate | Time to resolve | Comunicación |
|---|---|---|---|---|---|
| **P0** | Producción caída completamente, pérdida de datos confirmada, KMS compromise, brecha de seguridad activa con datos personales expuestos | 15 min | 1h | 4h | War room inmediato + email a usuarios afectados < 24h |
| **P1** | Degradación severa de un servicio crítico (billing endpoint, auth, sync HealthKit), error rate > 10%, performance p95 > 5x baseline sostenido | 30 min | 4h | 24h | Status page actualizada cada 1h |
| **P2** | Degradación parcial sin impacto inmediato a usuario final, pero requiere intervención (runaway job, latencia elevada en API no crítica, alerta de capacidad) | 2h business hours | 24h | 7 días | Email interno + Sentry follow-up |
| **P3** | Defectos menores, alertas informativas, deuda de monitoreo | 1 día business hours | 7 días | 30 días | Issue de GitHub, sin notificación |

**Nota sobre business hours**: lunes a viernes 09:00-19:00 CLT. Fuera de
horario, los P0/P1 siguen siendo atendidos; P2/P3 esperan al siguiente día hábil.

Para vulnerabilidades de seguridad reportadas externamente, consultar
también el [severity rubric específico de seguridad](../security/severity-rubric.md).

---

## 2. On-call rotation

**Estado actual** (Sprint 20, mayo 2026): el equipo es single-dev. Daho asume
el rol de on-call 24/7 para P0/P1.

**Rotation deferred**: cuando el equipo crezca a ≥ 2 personas full-time, se
implementará rotación semanal con handoff los lunes 10:00 CLT. Hasta entonces:

- **Fallback humano**: si Daho está no-disponible (vacaciones, fuera de
  cobertura), el siguiente paso es contactar a la mutual ACHS para
  comunicación con clientes operacionales y/o pausar el servicio anunciando
  ventana de mantenimiento en la status page.
- **Backup técnico**: GCP Support Premium (a contratar antes de Sprint 22) cubre
  fallos de plataforma fuera del control del código.

**Compromiso de tiempo**: Daho commit a responder a alertas P0 dentro de 15 min
en horario CLT diurno y dentro de 60 min en horario nocturno. Las alertas
llegan vía:

1. Cloud Monitoring → email a `contacto@praeventio.net` y push a Telegram bot personal.
2. Sentry → email + Slack DM (cuando exista workspace).
3. UptimeRobot externo (planificado) → SMS al número personal.

---

## 3. Communication channels

| Canal | Propósito | Estado |
|---|---|---|
| Slack `#incidents` | Coordinación interna durante el incidente | A crear cuando exista workspace de Slack |
| Email a `contacto@praeventio.net` | Canal oficial de comunicación interna y externa | Activo |
| Email a `dahosandoval@gmail.com` | Canal personal de Daho (backup) | Activo |
| Status page (`status.praeventio.net`) | Comunicación pública | A crear (Sprint 22) |
| Twitter / X `@praeventio` | Comunicación pública si la status page está caída | Activo |
| Email a clientes afectados | Notificación dirigida post-incidente | Manual via Gmail |
| Sentry comments | Trace técnico colaborativo | Activo |

**Regla de comunicación**: durante un incidente P0/P1, el Incident Commander
publica updates cada 30 minutos, incluso si es "sin novedad, seguimos
investigando". El silencio prolongado deteriora la confianza más que la
mala noticia.

**Templates de mail**: ver `docs/runbooks/templates/email-customer-notification.md`
(a crear post-Sprint 21).

---

## 4. War room template

Activado para cualquier incidente P0 y para P1 que se prolonguen > 4h.

### 4.1 Roles

| Rol | Responsable | Función |
|---|---|---|
| **Incident Commander (IC)** | Daho (default) | Toma decisiones, prioriza, autoriza acciones destructivas. NO debug en paralelo. |
| **Comms Lead** | Daho (default; rotará cuando crezca el equipo) | Updates a usuarios, status page, email, redes |
| **Tech Lead** | Daho (default) | Investigación técnica y ejecución de mitigaciones |
| **Scribe** | Tooling: Otter / Granola para transcribir + IC para notas estructuradas | Timeline en tiempo real para post-mortem |

En equipo single-dev, los 4 roles colapsan en 1 persona. La disciplina es:
hacer pausas cada 30 minutos para actualizar timeline y comunicaciones,
incluso si interrumpe el debug.

### 4.2 Agenda inicial (primeros 15 minutos)

1. **Confirmar severidad** (60s)
2. **Paginar a quien deba estar** (60s)
3. **Asegurar Comms inicial**: status page actualizada, email "investigamos" al canal cliente (3 min)
4. **Definir hipótesis primaria + 2 alternativas** (5 min)
5. **Asignar streams de trabajo** (mitigación inmediata vs investigación de root cause) (3 min)
6. **Establecer cadencia de check-ins** (cada 30 min) (1 min)

### 4.3 Post-mortem template

Generar dentro de 72h post-resolución en
`docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md`:

```markdown
# Post-mortem: <título corto del incidente>

- **Fecha**: YYYY-MM-DD
- **Severidad**: P0 / P1 / P2
- **Duración**: HH:MM (desde primer síntoma hasta full recovery)
- **Owner**: Daho
- **Servicios afectados**:
- **Usuarios afectados** (cuantía estimada):
- **Pérdida de datos** (sí/no, alcance):
- **Pérdida económica estimada** (CLP):

## Resumen ejecutivo (3 líneas máximo)

## Timeline (en CLT, formato HH:MM)

## Detección
- ¿Cómo se detectó? (alerta, reporte de usuario, observación interna)
- ¿Fue detección automática o manual?
- Tiempo entre síntoma y detección (TTD)

## Root cause (5 Whys)

## Contributing factors
(Cosas que hicieron el incidente más severo o más largo de lo necesario)

## What went well

## What went poorly

## Action items
- [ ] (Owner) Acción correctiva 1 — due YYYY-MM-DD
- [ ] (Owner) Mejora preventiva 1 — due YYYY-MM-DD
- [ ] (Owner) Mejora del runbook — due YYYY-MM-DD

## Lessons learned

## Apéndices
- Sentry traces:
- Logs relevantes:
- PRs de fix:
```

**Regla blameless**: el post-mortem analiza sistemas, no personas. Lenguaje
prohibido: "X olvidó", "X debería haber". Lenguaje preferido: "el sistema no
detectó", "el procedimiento no contemplaba".

---

## 5. Categorías de incidente

Cada categoría tiene su propio runbook especializado. Esta sección lista los
puntos de entrada y los detalles específicos no cubiertos en los runbooks
hijos.

### 5.1 Security

**Runbook detallado**: [docs/security/incident-response.md](../security/incident-response.md)

Incluye: vulnerabilidades reportadas externamente, sospechas de breach,
acceso no autorizado a datos personales, IAM lockout, exposición de secrets
en repos públicos.

**Tiempos legales relevantes** (Chile):
- Ley 21.719 art. 50: reporte a ANPD dentro de 72h si hay brecha de datos personales.
- Ley 16.744: si el incidente impide el servicio prevencional contractual, notificar a la mutual ACHS.

### 5.2 Performance / availability

**Runbook detallado**: [DR_RUNBOOK.md](./DR_RUNBOOK.md)

Incluye: outages regionales, latencia degradada, errores 5xx sostenidos,
saturación de recursos.

**Procedimiento rápido**:
1. Verificar status page de GCP.
2. Verificar Cloud Monitoring uptime checks.
3. Si la región primaria está caída: ver DR_RUNBOOK §5.2 (failover Cloud Run).
4. Si es saturación: aumentar `--max-instances` en Cloud Run e investigar
   leak/N+1 en paralelo.

### 5.3 Data corruption

**Runbook detallado**: [DR_RUNBOOK.md](./DR_RUNBOOK.md)

Incluye: lecturas inconsistentes en Firestore, mismatch entre primary y
réplicas, drift entre Firestore y CloudSQL/Postgres (cuando exista),
borrado accidental masivo.

**Procedimiento rápido**:
1. **STOP writes** a la colección afectada (deshabilitar feature flag o
   poner el endpoint en mantenimiento).
2. Snapshot del estado actual (`gcloud firestore export` con
   `--collection-ids` filtrado).
3. Identificar último estado bueno conocido.
4. Restore selectivo (NO restore completo si solo una colección está dañada).
5. Validar integridad referencial.

Ver DR_RUNBOOK §5.3 para comandos.

### 5.4 Billing (especial: webpay return endpoint failures)

**Categoría crítica** porque toca dinero de usuarios y proveedores.

**Endpoint clave**: `POST /webpay/return` — recibe el callback de Transbank
con el resultado del pago. Failure modes:

| Síntoma | Causa probable | Mitigación |
|---|---|---|
| 500 sostenido en `/webpay/return` | Bug en parsing de payload Transbank | Rollback inmediato a la revisión Cloud Run anterior |
| Pagos confirmados por Transbank pero no marcados como paid en Firestore | Race condition en idempotency keys | Job de reconciliación manual: query Transbank por txns recientes y cruzar con `billing.invoices` |
| Doble cobro al usuario | Idempotency key colisión o re-intento mal manejado | STOP el endpoint, refund manual via Transbank dashboard, postmortem urgente |
| Usuario reporta cobro incorrecto | Discrepancia entre `total_clp` calculado y debitado | Pausar billing nuevo, verificar logs de la transacción específica, refund si confirmado |

**Reconciliación periódica**: existe un job programado que cruza
`billing.invoices` con los webhooks de Transbank/Khipu/Google Play cada 6h.
Si detecta drift, abre un issue P1.

**Reglas duras de billing**:
- Nunca borrar `billing.invoices` (append-only).
- Nunca modificar el monto de una invoice ya emitida (emitir nota de crédito).
- Refunds requieren autorización explícita del usuario por escrito.

**Stripe está fuera del scope**: en Sprint 19 se decidió no usar Stripe.
Los proveedores activos son Transbank (webpay), Khipu (transferencias) y
Google Play Billing (in-app subscriptions).

### 5.5 SLM offline (especial: Web Worker crashes)

El SLM (Small Language Model) corre offline en un Web Worker para
inferencia local. Failure modes:

| Síntoma | Causa probable | Mitigación |
|---|---|---|
| Web Worker no inicia (postMessage timeout) | Modelo no descargado / cache corrupto | Forzar re-descarga: limpiar IndexedDB del namespace `slm-cache` |
| Inference timeout (> 30s para una respuesta) | Modelo demasiado grande para el dispositivo | Fallback a Vertex AI / Gemini API (ver feature flag `slm.fallback_cloud`) |
| Crash del worker (OOM en mobile) | Insuficiente RAM (típico < 4GB) | Detectar via `navigator.deviceMemory`, deshabilitar SLM en dispositivos < 4GB |
| Output incoherente / hallucinations | Modelo dañado en transferencia | Verificar checksum del modelo descargado contra manifest |
| Bundle size SLM hace que la PWA falle install | Asset > límite Service Worker | Lazy-load del SLM (descarga on-demand, no en install) |

**Compromiso UX**: el SLM debe degradar silenciosamente. Si falla, el
fallback a Gemini en cloud (con consentimiento explícito del usuario para
enviar el prompt fuera del dispositivo) es transparente. La capa offline-only
nunca debe bloquear al usuario.

**Métricas a observar**:
- `slm.inference.duration_ms` (p50, p95)
- `slm.worker.crash_count`
- `slm.fallback_to_cloud_rate`
- `slm.model.download_failure_rate`

---

## 6. Escalation paths

```
┌──────────────────────────────────┐
│ Alerta / report inicial          │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Daho (CEO/CTO)                   │  ← primer respondedor SIEMPRE
│ contacto@praeventio.net          │
│ dahosandoval@gmail.com           │
└──────┬─────────────┬─────────────┘
       │             │
       │             ▼
       │      ┌─────────────────────────────┐
       │      │ Mutual ACHS                 │  ← cuando el incidente afecta
       │      │ (servicio prevencional      │     contractualmente a clientes
       │      │  Ley 16.744)                │     operacionales
       │      └─────────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ GCP Support                      │  ← cuando es claramente plataforma
│ Console → Support → Create Case  │     (no código de la app)
│ Severity P1/P2 según corresponda │
└──────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ Proveedores específicos          │  ← según la naturaleza del problema
│ - Transbank (webpay)             │
│ - Khipu                          │
│ - Sentry                         │
│ - Apple/Google App Store         │
└──────────────────────────────────┘
```

### 6.1 Cuándo escalar a GCP Support

- Errores 5xx generalizados sin un cambio reciente en código.
- Errores de IAM que aparecen sin haber tocado roles.
- Latencia anómala en servicios gestionados (Firestore, Cloud Run, KMS).
- Confirmación visible en `https://status.cloud.google.com`.

### 6.2 Cuándo escalar a la mutual ACHS

- El outage impide el funcionamiento de la plataforma de prevención
  durante una emergencia laboral activa.
- Necesidad de comunicar masivamente a clientes operacionales con quienes
  ACHS tiene relación previa.
- Asesoría regulatoria sobre Ley 16.744 / DS 109.

### 6.3 Cuándo escalar a Transbank Support

- Failures sostenidos en `/webpay/return`.
- Discrepancias de reconciliación que persisten > 24h.
- Cambios en el contrato de la API de Transbank que rompen el integration.

---

## 7. Post-incident review (versión completa)

El template de §4.3 es el mínimo viable. Para incidentes P0 con impacto
externo, agregar las siguientes secciones:

### 7.1 Timeline reforzado

Incluir además de los pasos: alertas que dispararon, alertas que NO
dispararon (gaps de monitoreo), comunicaciones a usuarios, decisiones
clave del IC.

### 7.2 Análisis de root cause con 5 Whys

```
1. ¿Por qué falló X?       → A
2. ¿Por qué A?              → B
3. ¿Por qué B?              → C
4. ¿Por qué C?              → D
5. ¿Por qué D?              → root cause
```

### 7.3 Contributing factors

Lista de factores que NO son root cause pero hicieron al incidente más
severo, más largo, o más difícil de detectar. Ejemplos:
- Alerta no llegó al canal correcto.
- Documentación desactualizada.
- Test que no cubría el caso edge.

### 7.4 Action items con owner y due date

Cada item debe ser:
- **Específico**: "agregar alerta de error rate en /webpay/return" en vez de "mejorar monitoreo".
- **Medible**: con criterio de aceptación.
- **Asignado**: con un único owner.
- **Con plazo**: due date concreto.

Items P0/P1 deben tener due date dentro de 30 días.

### 7.5 Prevención

Sección que responde: "¿qué cambio sistémico previene esta clase de
incidentes en el futuro?" Distinta de "action items": el item dice qué
hacer, prevención dice qué clase de problema se elimina.

Ejemplo:
- Action item: "Agregar test de regresión para parsing de Transbank payload."
- Prevención: "Establecer convención: cualquier endpoint externo debe tener
  contract test ejecutado en CI con payload real anonimizado."

---

## 8. Compliance y auditoría

Cada incidente registrado debe documentarse en:

| Sistema | Qué se registra | Quién lo registra |
|---|---|---|
| `docs/runbooks/post-mortems/` | Post-mortem completo | IC del incidente |
| ISMS (cuando exista) | Entry en registro de incidentes ISO 27001 A.5.24 | Daho |
| ANPD (Chile) | Reporte si hay brecha de datos personales (Ley 21.719 art. 50) | Daho dentro de 72h |
| Mutual ACHS | Comunicación si hay impacto contractual | Daho dentro de 24h |
| Cloud Audit Logs | Permanente vía sink `audit-logs-archive` (7 años) | Automático |

---

## 9. Rehearsals (simulacros)

Para mantener este runbook vivo:

| Cadencia | Tipo de simulacro |
|---|---|
| Mensual | Tabletop exercise: walk-through verbal de un escenario hipotético, sin tocar producción |
| Trimestral | DR rehearsal (ver DR_RUNBOOK §6) |
| Semestral | Emergency KMS rotation simulada (ver KMS_ROTATION §3, en proyecto staging) |
| Anual | Full-scale incident game day: incidente sintético con cronómetro real |

Cada simulacro genera un documento en `docs/runbooks/rehearsals/`.

---

## 10. Apéndices

- [DR_RUNBOOK.md](./DR_RUNBOOK.md) — disaster recovery
- [KMS_ROTATION.md](./KMS_ROTATION.md) — rotación de KMS keys
- [docs/security/incident-response.md](../security/incident-response.md) — incidentes de seguridad (procedimiento detallado)
- [docs/security/severity-rubric.md](../security/severity-rubric.md) — severidad para reportes externos
- [SECURITY.md](../../SECURITY.md) — política pública de divulgación responsable

---

## 11. Changelog del runbook

- **2026-05-03** — Versión inicial. Bucket Runbooks de Sprint 20 seventh wave.
  Cubre incident response maestro, severidad P0-P3, on-call deferred (single-dev),
  war room template, 5 categorías de incidente, escalation paths con anclaje a
  ACHS y normativa chilena (Ley 16.744, Ley 21.719).
