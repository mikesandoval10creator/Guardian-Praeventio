# Scope justifications — for OAuth verification & Marketplace review

> **How to use this file:** when GCP Console asks "How will your app use this scope?", paste the corresponding block. Reviewers spend ~2 minutes per scope; lead with end-user benefit, not architecture.
> **Language:** Spanish-CL primary (matches our market and the consent dialog locale). English fallback included for the reviewer if they request translation.
> **Source-of-truth call sites:** `server.ts` lines 578-583 (Calendar/Fit OAuth, Fit deprecated), `server.ts` line 944 (Drive scope).

---

## Scope 1: `openid`

**Sensitivity:** Non-sensitive.

**Justificación (es-CL):**
Praeventio Guard usa `openid` como base estándar OAuth 2.0 / OIDC para autenticar al trabajador o supervisor cuando inicia sesión con su cuenta de Google Workspace de la empresa. Sin este scope no podemos verificar de manera segura que la persona que dice ser el "Prevencionista de la faena Mina X" efectivamente lo es. Es el cimiento de cualquier control de acceso por roles (RBAC) dentro de la plataforma — sin identidad verificada no podemos aplicar las reglas de Comité Paritario ni separar lo que ve el trabajador raso de lo que ve el experto SST.

**Justification (en):**
Standard OIDC identity assertion. Required to authenticate Workspace users into Praeventio Guard's role-based access (worker / supervisor / safety officer / committee member). No identity claims about the user are stored beyond the `sub` and verified email.

---

## Scope 2: `https://www.googleapis.com/auth/userinfo.email`

**Sensitivity:** Non-sensitive.

**Justificación (es-CL):**
Necesitamos el email verificado del usuario para mapear su cuenta Workspace a su registro en la empresa contratista (RUT, faena asignada, comité paritario al que pertenece). Esto permite que cuando el trabajador inicia sesión, vea solo los riesgos de SU faena y reciba notificaciones (capacitaciones ODI pendientes, próxima reunión del Comité Paritario DS 54) en su email corporativo. No enviamos email a ninguna lista de marketing — el email es operacional, ligado al rol SST de la persona.

**Justification (en):**
Verified email is the join key between Workspace identity and the user's worksite assignment, role, and committee membership. Used for transactional notifications only (overdue training reminders, mandatory DS 54 monthly committee meetings). Never used for marketing.

---

## Scope 3: `https://www.googleapis.com/auth/userinfo.profile`

**Sensitivity:** Non-sensitive.

**Justificación (es-CL):**
Pedimos el nombre y la foto del perfil del usuario para mostrar quién está reportando un IPER, quién firmó una capacitación ODI, y quién ingresó al "check-in" en una zona de riesgo. La trazabilidad de la persona es un requisito de auditoría SUSESO (Ley 16.744 art. 76) — no basta con un email, los inspectores piden ver "quién hizo qué" en formato humano. Si el usuario no tiene foto en Google, mostramos sus iniciales.

**Justification (en):**
Display name + avatar power the audit trail surfaced to SUSESO inspectors and internal safety committees: which worker signed the toolbox talk, who lifted the lockout-tagout, who reported the near-miss. Falls back to initials if no avatar is present.

---

## Scope 4: `https://www.googleapis.com/auth/calendar.events` (SENSITIVE)

**Sensitivity:** Sensitive — requires verification (5-15 business days).

**Justificación (es-CL):**
Praeventio Guard usa el calendario del trabajador o supervisor para AGENDAR automáticamente las reuniones legalmente requeridas por la normativa chilena de seguridad y salud en el trabajo:

- Reuniones mensuales del Comité Paritario de Higiene y Seguridad (DS 54 art. 24, obligatorias en faenas con más de 25 trabajadores).
- Capacitaciones ODI semestrales (Obligación de Informar los Riesgos, Ley 16.744 art. 21).
- Audiometrías PREXOR y exámenes ocupacionales (DS 594 / protocolos MINSAL).
- Revisiones de Management ISO 45001 anuales.
- Simulacros de evacuación trimestrales.

La aplicación PROPONE las fechas óptimas en base a: el calendario de la faena, días feriados chilenos, turnos del trabajador. El usuario REVISA y APRUEBA cada evento antes de que se cree. Solo creamos eventos relacionados con obligaciones de prevención de riesgos del rol del usuario — nunca leemos los eventos personales del trabajador, nunca leemos eventos de otras personas.

El scope `calendar.events` (no `calendar`) limita el acceso a creación y gestión de eventos; no da acceso a la lista completa de calendarios ni a configuración del usuario.

**Justification (en):**
Praeventio creates calendar events that are LEGALLY REQUIRED under Chilean occupational safety law (DS 54, Ley 16.744): monthly safety committee meetings, semi-annual hazard briefings (ODI), audiometric exams, ISO 45001 management reviews, evacuation drills. The app proposes dates optimized against worksite calendar + Chilean holidays + worker shifts; the user approves each event before creation. We do not read the user's personal events, only events we create. The narrower `calendar.events` scope (vs. full `calendar`) limits us to event-level operations.

**Demo flow for reviewer:** sign in as a worker → navigate to "Calendario Predictivo" → click "Generar agenda anual" → app proposes 12 monthly committee meetings + 2 ODI sessions + 4 evacuation drills → worker clicks "Aprobar y agendar" → events appear on Google Calendar.

---

## Scope 5: `https://www.googleapis.com/auth/drive.file` (per-file)

**Sensitivity:** Documented by Google as non-sensitive when used as designed (per-file access, no broader Drive read).

**Justificación (es-CL):**
Cuando un prevencionista genera un PDF de auditoría ISO 45001, un informe IPER (Identificación de Peligros y Evaluación de Riesgos) o un acta del Comité Paritario, Praeventio Guard guarda esos archivos en una carpeta del Drive del usuario. ¿Por qué? Porque (a) la empresa contratista necesita respaldar esos documentos en su propia infraestructura para auditorías SUSESO y (b) el inspector SUSESO puede llegar sin aviso y pedir ver el "Plan de Prevención de Riesgos firmado del último año" — tener el PDF en Drive del cliente garantiza acceso aunque Praeventio Guard esté caído.

CRÍTICAMENTE: el scope `drive.file` es per-archivo. Solo accedemos a archivos que NUESTRA app crea — el sistema operativo de Google no nos deja leer ni un solo archivo del Drive del trabajador que Praeventio no haya generado. Esta es una garantía técnica, no una promesa contractual.

**Justification (en):**
Praeventio writes generated reports (ISO 45001 audits, IPER hazard registers, committee minutes) to the user's Drive so the contracting company has a redundant copy for SUSESO inspections (Chilean labor inspector audits). The `drive.file` scope is per-file: Google's API limits us to files our app created — we cannot read, list, or modify any other file in the user's Drive. This is a technical guarantee enforced by Google's infrastructure, not a contractual promise.

**Demo flow for reviewer:** sign in → run "Generar informe IPER" → click "Guardar copia en mi Drive" → file appears in `/Praeventio/Informes/2026/IPER-FaenaX-2026-04.pdf` → confirm in Drive UI. Then attempt to access an unrelated file (e.g. user's personal Google Doc) — API returns 403, as expected.

---

## DEPRECATED — DO NOT SUBMIT THESE SCOPES

The following Google Fit scopes appear in legacy `server.ts:580-582` but are being removed before Marketplace submission. Listed here for our own audit trail.

### `https://www.googleapis.com/auth/fitness.activity.read`
### `https://www.googleapis.com/auth/fitness.heart_rate.read`
### `https://www.googleapis.com/auth/fitness.body.read`

**Status:** DEPRECATED. The Google Fit REST API sunsets **2026-12-31**. Praeventio Guard is migrating to:
- **Android:** Health Connect (on-device, no OAuth scope, no server intermediary).
- **iOS:** HealthKit (on-device, no OAuth scope; requires `NSHealthShareUsageDescription` Info.plist entry, not a Google Workspace scope).

The endpoint `/api/fitness/sync` already emits `Sunset: Wed, 31 Dec 2026 23:59:59 GMT` headers (RFC 8594) for any client still using it. See `HEALTH_CONNECT_MIGRATION.md` and `IMPACTO.md` § 2.

Submitting these scopes would (a) be rejected by Google because Fit OAuth is in deprecation, (b) require us to defend a use case for data we are explicitly moving on-device for privacy reasons.

---

## Reviewer cheat sheet (for the Praeventio team to send to Google support if needed)

- **Domain:** praeventio.net (verified in Search Console).
- **App backend:** Node.js Express, deployed Cloud Run, region `southamerica-west1` (Santiago).
- **Data residency:** Firestore CL (default), Vertex AI ready for `southamerica-west1` migration (`VERTEX_MIGRATION.md`).
- **Encryption:** OAuth tokens envelope-encrypted with Cloud KMS rotable keys (`KMS_ROTATION.md`).
- **Compliance frameworks invoked:** Ley 19.628 (Chile data protection, current), Ley 21.719 (Chile data protection, effective 2026), ISO 45001, Ley 16.744 (Chile labor accident insurance), DS 54, DS 40, DS 594.
- **Test account for reviewer:** create a Workspace test user under praeventio.net/marketplace-reviewer-2026 and email credentials to dev-contact when Google requests them.
