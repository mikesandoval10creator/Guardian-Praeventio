# SUSESO DIAT/DIEP — plazos legales y sistema de recordatorios

> Sprint 28 follow-up · 2026-05-05

## Quién envía a la mutualidad

**LA EMPRESA**, no Praeventio. Por Ley 16.744 art. 76 + DS 101 art. 71
(DIAT) y DS 109 (DIEP), el empleador es el sujeto obligado a notificar a
la mutualidad / ISL correspondiente.

Praeventio Guard:

1. Genera el PDF folio-estampado y firmado (Bucket B6 — `folioGenerator`,
   `susesoCertificate`, `susesoService`).
2. Calcula la fecha límite legal.
3. **Recuerda** a la empresa (gerente/admin/supervisor del proyecto, más
   el trabajador afectado en DIAT) que el plazo está corriendo.
4. Registra cuándo la empresa marca el form como "enviado a la mutualidad"
   para detener los recordatorios.

Praeventio nunca debe afirmar (en UI, emails, push o reportes) que "envió"
el documento — ese deber legal es del empleador.

## Plazos legales por tipo de form

| Tipo  | Norma                  | Plazo                                    |
|-------|------------------------|------------------------------------------|
| DIAT  | DS 101 art. 71         | **5 días corridos** desde el accidente   |
| DIEP  | DS 109                 | **5 días corridos** desde la detección de la enfermedad profesional |

"Días corridos" = consecutivos calendario incluyendo fines de semana y
feriados. La función `computeLegalDeadline` aplica un offset exacto de
`5 * 24 * 60 * 60 * 1000` ms sobre `incidentDate`.

## Escalation visual

`SusesoDeadlineBadge` rinde un pill con color según los días restantes
hasta el plazo legal:

| Nivel    | Días restantes | Color    | Texto del pill                              |
|----------|----------------|----------|---------------------------------------------|
| green    | ≥ 5            | verde    | `DIAT — vence en N días`                    |
| yellow   | 3–4            | amarillo | `DIAT — vence en N días`                    |
| orange   | 1–2            | naranja  | `DIAT — vence en N días`                    |
| red      | 0              | rojo     | `DIAT — vence HOY`                          |
| overdue  | < 0            | rojo oscuro | `DIAT — vencido (envío manual urgente)`  |

Cuando `status === 'submitted_by_company'`, el pill cambia a teal
(`#4db6ac`) con el texto `✓ Enviado por la empresa` — el plazo deja de
ser relevante porque la obligación legal se cumplió.

## Recordatorios

El job `sendSusesoReminders` corre como tercer paso del cron unificado
`POST /api/maintenance/check-overdue` (gateado con
`verifySchedulerToken`, ~1 invocación / hora).

Para cada form `tenants/{tid}/suseso_forms/{formId}` con
`status !== 'submitted_by_company'` y `legalDeadline > now - 7d`:

1. Calcula `daysUntilDeadline` y `escalationLevel`.
2. Resuelve recipients:
   - gerente / admin / supervisor del proyecto (`projects/{p}/members`),
   - creador del form (`reportedBy.uid`),
   - en DIAT, también el trabajador afectado (`workerUid`) — con
     disclaimer "tu empresa debe enviar a [mutualidad]".
3. Idempotencia diaria: si ya se envió un recordatorio al mismo
   recipient para el mismo formId en el mismo día UTC, se omite.
4. Despacha push + email vía el `dispatcher` inyectado.
5. Append a `remindersSent[]` con timestamp + canal + recipientUid.
6. Escribe un `audit_logs` entry con `action: 'suseso.deadline.reminded'`.

Forms cuyo `legalDeadline` ya pasó hace **más de 7 días** se omiten — el
badge UI los muestra como `overdue`, pero ya no se spammea por push/email
(la empresa sabe que está en infracción).

## Marcar como enviado

Cuando el gerente / admin / supervisor sube el form al portal de la
mutualidad, presiona el botón **"Marcar como enviado"** en la UI, que
llama a:

```
POST /api/suseso/forms/:formId/mark-submitted
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{ "tenantId": "<tid>" }
```

El handler:

- Verifica auth con `verifyAuth`.
- Confirma que `req.user.role ∈ {admin, gerente, supervisor}`.
- Actualiza `status: 'submitted_by_company'` y `submittedByCompanyAt`
  en el doc de Firestore.
- Emite `audit_logs` con `action: 'suseso.form.marked_submitted'`.

A partir de ese punto el job de recordatorios **nunca volverá** a
notificar sobre ese form, y el badge UI se queda en el pill verde teal.
