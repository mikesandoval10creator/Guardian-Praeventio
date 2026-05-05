# Reportes regulatorios — Chile

Tabla resumen de los formularios oficiales que el sistema genera (PDF) o envía
(API) para cumplir las obligaciones de Ley 16.744 y normas conexas.

| Formulario | Marco legal | Cuándo emitirlo | Destinatario | Plazo legal | Generador (cliente) | Envío automático |
| --- | --- | --- | --- | --- | --- | --- |
| **DS 109** | DS 109/1968 MINSEGPRES + Ley 16.744 art. 7 | Calificación de **enfermedad profesional**: hay diagnóstico clínico que se sospecha relacionado con agente ocupacional. | COMPIN o Mutualidad de Empleadores | Plazo de calificación 30 días tras evaluación médica | `src/utils/ds109Certificate.ts` (`generateDs109Pdf`) | No (revisión presencial). |
| **DS 67** | DS 67/1999 MINTRAB + Ley 16.744 art. 76 | Notificación de **accidente del trabajo** a la mutual asociada. | Mutualidad (ACHS / IST / Mutual CChC / ISL) | **24 horas** desde el accidente | `src/utils/ds67Notification.ts` (`generateDs67Pdf`) | No (canal mutual). |
| **DS 76** | DS 76/2007 MINTRAB + Ley 16.744 art. 66 bis | Acreditación de **empresa contratista** en faena (especialmente minera). | Empresa principal (mandante) + Mutualidad | Antes del inicio de faena, archivado 5 años | `src/utils/ds76MiningContractor.ts` (`generateDs76Pdf`) | No. |
| **DIAT** | Ley 16.744 art. 76 + Circular SUSESO 3656/2021 | Declaración Individual de **Accidente del Trabajo**. | SUSESO (vía mutual) | 24 horas | Vista en `src/pages/SusesoReports.tsx` | Sí — `SusesoApiClient.submitDiat()` |
| **DIEP** | Ley 16.744 art. 76 + Circular SUSESO 3656/2021 | Declaración Individual de **Enfermedad Profesional**. | SUSESO (vía mutual) | 24 horas tras diagnóstico | Vista en `src/pages/SusesoReports.tsx` | Sí — `SusesoApiClient.submitDiep()` |
| **ROI** | Ley 16.744 + Circular SUSESO siniestralidad | Reporte periódico de **siniestralidad** (accidentabilidad + gravedad). | SUSESO | Anual / trimestral | Vista en `src/pages/SusesoReports.tsx` | Sí — `SusesoApiClient.submitRoi()` |

## SUSESO API — `src/services/sii/susesoApiClient.ts`

Cliente HTTP fino sobre `fetch`. Auth: `Authorization: Bearer <SUSESO_API_KEY>`
+ header `X-Employer-Rut: <RUT>`. URL base por defecto:
`https://api.suseso.cl/v1` (verificar contra documentación vigente antes de
producción).

Variables de entorno:

- `SUSESO_API_KEY` — credencial entregada por SUSESO al integrarse.
- `SUSESO_EMPLOYER_RUT` — RUT del empleador (con dígito verificador).
- `SUSESO_API_URL` — opcional, override del endpoint.

Si las variables no están configuradas, `SusesoApiClient.fromEnv()` retorna
`null` y la UI deshabilita el botón "Enviar a SUSESO" en `SusesoReports`.

### Estados de envío

- `pending` — folio asignado, aún no procesado por SUSESO.
- `received` — recibido conforme.
- `rejected` — rechazado; `reason` contiene el motivo.

### Persistencia

Cada envío exitoso se guarda en Firestore en
`projects/{projectId}/susesoSubmissions` con `{ reportType, incidentId, folio,
submittedAt, status }` para trazabilidad.

## DS 67 vs DIAT — diferencia

Ambos cubren accidentes del trabajo, pero:

- **DS 67** = notificación interna a la **mutualidad** (papel + portal mutual).
- **DIAT** = declaración formal en el **portal SUSESO**.

En la práctica el empleador emite ambos: el DS 67 al servicio de urgencia /
mutual al momento del accidente, y la DIAT en el portal SUSESO dentro de las
24 horas. El sistema los maneja como flujos paralelos.

## DS 76 vs DS 67/109 — alcance

- **DS 67 / DS 109** son por **trabajador** (un evento de salud).
- **DS 76** es por **contrato** (acreditación de la cuadrilla contratista
  completa), y se renueva al inicio de cada nuevo contrato o faena.
