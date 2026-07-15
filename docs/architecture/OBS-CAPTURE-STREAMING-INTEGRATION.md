# Estudio de arquitectura — captura/streaming tipo OBS en Guardian

> **Estado:** estudio (Review). NO implementar sin ADR previo (ver §7).
> Solo documenta cómo integraríamos captura y transmisión de video/imagen al
> pipeline de evidencia, monitoreo y capacitación que ya existe en el repo.

## 1. Por qué

Tres casos de uso reales del dominio piden video/imagen de mayor fidelidad que
la foto puntual actual:

- **Evidencia** de incidente/casi-incidente (cadena de custodia legal — Ley
  16.744, fiscalización DS 44/2024).
- **Monitoreo** en vivo de una faena o espacio confinado durante una maniobra
  crítica (supervisor remoto).
- **Capacitación**: reconstruir la lección de un incidente con material audiovisual.

Hoy el repo cubre solo la foto estática. Los anclajes existentes:

| Capacidad actual | Archivo |
|---|---|
| Foto de evidencia (captura + card + hook) | `src/services/photoEvidence/`, `src/server/routes/photoEvidence.ts`, `src/hooks/usePhotoEvidence.ts` |
| Bundle de evidencia de incidente | `src/services/incidentBundle/incidentEvidenceBundle.ts` |
| Flujo incidente → lección → capacitación | `src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts` |

Este estudio propone la capa de **captura y transporte de media** que alimentaría
esos mismos tres consumidores, sin reemplazarlos.

## 2. Separación de planos

Copiamos el modelo de OBS/WebRTC: **plano de control** ≠ **plano de datos**.

- **Plano de control** — el cliente pide/termina una sesión de captura. Va por
  una ruta Express nueva con `verifyAuth` + `assertProjectMember` (convención #6),
  que emite audit_logs y devuelve credenciales efímeras de ingest. NUNCA viaja
  media por aquí.
- **Plano de datos** — la media va del dispositivo a un **media gateway** por el
  transporte elegido según el caso (§3), no toca el proceso Express.

Motivo: el proceso Express es un único servicio (`server.ts`); meter frames de
video por ahí lo tumba. El gateway es un componente aparte, escalable de forma
independiente.

## 3. Transporte por caso de uso

| Caso | Transporte | Por qué |
|---|---|---|
| Evidencia (grabar y subir) | Captura local + subida diferida (multipart al gateway) | Tolerante a offline — el dispositivo puede estar sin red en faena. No necesita baja latencia. |
| Monitoreo en vivo | **WHIP** (WebRTC-HTTP Ingest) | Sub-segundo, estándar de navegador, sin plugins. |
| Enlace de campo robusto | **SRT** | Recupera pérdida de paquetes en redes celulares malas de minera remota. |
| Compat. legado OBS | **RTMP** | OBS Studio del PC de un supervisor puede emitir directo. |

Regla ponytail: **no** construimos las cuatro. Fase 0 es solo la primera fila
(evidencia diferida), que es la que reusa el 100% del pipeline actual.

## 4. Almacenamiento y cadena de custodia

- Media cifrada en reposo con **KMS** (misma rotación que PII/medical), particionada
  por `tenantId` (aislamiento multi-tenant, M-1).
- Nueva colección `evidence_media` (metadatos; el binario va a Storage bajo
  `tenants/{tid}/evidence/{id}`). Requiere: reglas default-deny + ≥5 rules-tests
  (owner-allow, non-member-deny, schema-violation, post-sign update-deny,
  server-field-spoof) + fila en `security_spec.md` (convención #4).
- **Cadena de custodia**: cada acceso/exportación escribe audit_logs con
  uid/tenant estampados por el servidor (invariante #3). Hash del binario al
  ingest, verificado al leer.

## 5. Cumplimiento (no negociable)

- **On-device #12**: si la captura incluye análisis biométrico (postura, EPP), el
  análisis corre en el dispositivo; solo sale el resultado, no los frames crudos.
- **ADR 0012 (no diagnóstico)**: el material de capacitación no puede etiquetar
  condición médica de una persona.
- **Vida gratis #11**: si el monitoreo en vivo respalda una función vida-safety
  (p. ej. vigilancia de espacio confinado durante rescate), NO se puede tier-gatear.
  El tier-gating aplica solo a conveniencia/escala (retención extendida, nº de
  streams concurrentes).
- **Retención (ADR 0024)**: la evidencia se archiva, no se hard-borra.

## 6. Fases

0. **Evidencia diferida** — captura local + subida al gateway + `evidence_media`
   + reglas/tests. Reusa photoEvidence/incidentEvidenceBundle. Sin baja latencia.
1. **Plano de control** — ruta de sesión + credenciales efímeras + audit.
2. **Monitoreo en vivo** — WHIP al gateway; visor de supervisor.
3. **Capacitación** — engancha `incidentLessonTrainingFlow` al material capturado.

## 7. Decisión pendiente (ADR)

Antes de escribir código de Fase 0 se necesita un ADR que fije:

1. **Gateway**: servicio propio (MediaMTX/LiveKit autohospedado en Cloud Run) vs.
   proveedor gestionado. Impacta costo GCP y soberanía del dato.
2. **Modelo `evidence_media`**: esquema de metadatos + política de retención por tier.
3. **Transporte de Fase 2**: confirmar WHIP como primero.

Recomendación: gateway autohospedado por soberanía del dato legal chileno, escalado
a-cero cuando no hay captura activa (evita el always-on que causó la fuga de costo GCP).
