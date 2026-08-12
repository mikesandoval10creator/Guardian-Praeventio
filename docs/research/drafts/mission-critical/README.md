# Estándares de alta industria para apps de misión crítica

> **Ticket Notion:** `3a3aa66d-73fe-8196-b5aa-de61e48f3641`
>
> **Investigación:** 2026-08-12
>
> **Método:** fuentes primarias canónicas + lectura directa del árbol de Guardian + revisión adversarial de cada hallazgo.
>
> **Alcance:** documentación de evidencia. No modifica comportamiento de producción, permisos, datos ni configuraciones externas.

## Dossier

| Documento                                                                              | Dominio                                               | Resultado                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Lifecycle móvil y permisos](./01-mobile-lifecycle-permissions.md)                | Android FGS, ejecución iOS, permisos y release stores | Android tiene los permisos base y la guía de ubicación; el trabajo restante comprobado es iOS nativo/runbook y validación real en dispositivo. |
| [02 — Notificaciones críticas y offline-first](./02-critical-notifications-offline.md) | FCM/APNs, outbox, idempotencia, resiliencia offline   | La base durable es sólida; quedan una asimetría APNs en el worker outbox y el canal CPHS pendiente.                                            |
| [03 — Observabilidad, accesibilidad y seguridad](./03-observability-a11y-security.md)  | SLO, WCAG, rendimiento, privacidad y disclosure       | Existen SLOs, redacción PII y auditoría WCAG; quedan adaptadores/operación de observabilidad, INP y piezas de compliance verificadas.          |

## Regla de lectura

Un hallazgo entra en uno de estos tres grupos. No deben confundirse al priorizar ni al declarar readiness:

1. **Brecha comprobada en código o runbook:** hay una ruta, configuración o declaración verificable que falta o es inconsistente.
2. **Gate externo de release:** Play Console, App Store Connect, Apple Developer Portal o un dispositivo físico son la autoridad. El repositorio puede preparar evidencia, pero no demostrar su estado final.
3. **Condición dependiente de ejecución:** no se añade un permiso ni se declara un bug solo porque una API podría requerirlo. Primero se ejecuta la ruta concreta en el sistema operativo/dispositivo objetivo.

## Hallazgos consolidados y priorizados

### P1 — seguridad y entrega que tiene ruta de implementación verificable

| ID  | Hallazgo                                                                                                             | Evidencia                                                                                                        | Siguiente paso seguro                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| N1  | El worker de `critical_alert_outbox` envía prioridad Android, pero no el bloque APNs crítico de la ruta SOS directa. | `src/server/triggers/backgroundTriggers.ts:714-721` vs. `src/server/routes/emergency.ts:180-195`; dossier 02 §5. | Diseñar y probar un constructor compartido de payload que preserve prioridad/sonido APNs y no afirme bypass sin entitlement real. |
| N2  | El worker de outbox deja el correo CPHS como `return false`.                                                         | `backgroundTriggers.ts:723-730`; dossier 02 §5.                                                                  | Conectar un adaptador de correo real o declarar explícitamente FCM como único canal y ajustar el contrato de entrega.             |
| O1  | Cloud Monitoring adapter continúa como stub; parte de los SLO no recibe métrica real.                                | `OBSERVABILITY.md:405-409`; dossier 03 §3 y §7.                                                                  | Implementar emisión de métricas y validar con un entorno GCP controlado antes de cambiar alertas.                                 |
| O2  | El cálculo batch de burn rate sigue pendiente.                                                                       | `MONITORING.md:252-253`; dossier 03 §7.                                                                          | Añadir job durable que calcule ventanas reales, con tests de borde de error-budget.                                               |

### P2 — calidad operacional y experiencia verificables

| ID  | Hallazgo                                                                             | Evidencia                                                            | Siguiente paso seguro                                                                                         |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Q1  | INP no está medido en la política de rendimiento.                                    | ausencia contrastada en `lighthouserc.json`; dossier 03 §4 y §7.     | Añadir medición de interacción representativa, sin sustituir métricas de campo por una sola prueba sintética. |
| Q2  | `PERFORMANCE.md` promete LCP/TBT más estrictos que los thresholds aplicados.         | `PERFORMANCE.md:54-55` vs. `lighthouserc.json:31,33`; dossier 03 §4. | Decidir y alinear contrato documental con enforcement, usando baseline reproducible.                          |
| Q3  | Sentry source-map upload y React ErrorBoundary siguen diferidos.                     | `OBSERVABILITY.md:393-402`; dossier 03 §3 y §7.                      | Implementar por separado, validando que ni sourcemaps ni eventos filtren PII.                                 |
| Q4  | A11Y-016 y focus trap de `AddDocumentModal` conservan trabajo pendiente documentado. | `docs/a11y/WCAG_findings.md:26,29`; dossier 03 §4 y §7.              | Resolver con pruebas de teclado/foco; no marcar WCAG como cerrado por el audit histórico.                     |

### P2/P3 — entregables iOS y compliance que exigen frontera explícita

| ID  | Hallazgo                                                                                                                                                                     | Clasificación                                                              | Evidencia                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| I1  | El proyecto iOS nativo no está versionado; el runbook no incluye `NSLocationAlwaysAndWhenInUseUsageDescription` ni diseño de `UIBackgroundModes: location` para lone-worker. | Brecha de runbook/entrega iOS.                                             | `IOS_BUILD.md:4,160,177`; dossier 01 §5.                                                                   |
| I2  | El silent push para recuperar Guardian en iOS está descrito, pero no hay handler nativo verificable.                                                                         | Brecha arquitectónica iOS.                                                 | `src/services/foregroundService/guardianForegroundService.ts:10-14`; dossier 01 §5.                        |
| C1  | Portabilidad GDPR estándar, rutas de notificación de brechas, cookie consent por jurisdicción y validación legal local están pendientes.                                     | Brechas de compliance, algunas requieren asesoría jurídica.                | `docs/privacy-compliance-matrix.md:71-79`; dossier 03 §5 y §7.                                             |
| C2  | La clave PGP de disclosure aún es una plantilla y `security.txt` no tiene `Encryption:` activo.                                                                              | Brecha de disclosure; requiere una clave real y procedimiento de custodia. | `SECURITY.md:17-25`, `public/.well-known/pgp-key.asc`, `public/.well-known/security.txt:4`; dossier 03 §5. |

## Correcciones de la revisión adversarial

Estas hipótesis iniciales se descartaron o reclasificaron al contrastarlas con el árbol actual. No son deuda abierta:

| Hipótesis descartada                                                | Evidencia contraria                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Faltan permisos Android mínimos para FGS `health`.                  | `READ_HEART_RATE` ya está declarado (`AndroidManifest.xml:131`) y la documentación Android admite esa alternativa. La necesidad de permisos de background depende de una lectura de sensores/Health Connect que debe demostrarse en dispositivo. |
| Falta guiar a Android 11+ hacia Ajustes para ubicación persistente. | `src/services/geofence/permissionUXDecision.ts:144-150` ya emite la guía `Permitir siempre`; el hook consumidor es `useGeofencePermissions.ts`.                                                                                                  |
| No existe política pública de privacidad.                           | `public/privacy.html:1-18` existe y declara canonical `https://praeventio.net/privacy.html`. Queda comprobar HTTP 200 en el despliegue, no crear otro documento.                                                                                 |
| No existe lista pública de subprocesadores.                         | `public/subprocessors.html:1-17,54-95` existe y es enlazada desde la política. La matriz que dice lo contrario está desactualizada.                                                                                                              |
| No existe `security.txt`.                                           | `public/.well-known/security.txt` existe. Lo pendiente es publicar una clave PGP válida y activar su referencia `Encryption:`.                                                                                                                   |

## Gates que no se pueden certificar desde git

Antes de publicar un artefacto móvil, la autoridad de evidencia es externa:

- **Play Console:** declaración de FGS y formulario Data Safety, ambos contrastados contra el AAB final.
- **Android físico (API 34–36):** inicio del FGS, ubicación y la eventual lectura health durante una jornada real/simulada.
- **Apple Developer / App Store Connect:** provisioning profile, entitlements, App Privacy Details y política pública desplegada.
- **iPhone físico/TestFlight:** ubicación `Always`, background location, APNs normal/silent/critical y recuperación bajo presión de memoria.

## Fuentes primarias

Cada dossier conserva citas textuales, método de obtención, fecha de consulta y URL canónica. Las principales incluyen Android Developers, Google Play Console Help, Apple Developer, Firebase Cloud Messaging/Firestore, Google SRE, W3C WCAG 2.2 y web.dev.

## Límites

- Esta investigación no reemplaza una revisión legal local ni una verificación contra consolas de tienda.
- FCM/APNs son canales de notificación; el estado durable y auditable debe permanecer en el backend/outbox.
- Ningún apartado de este dossier equivale a “listo para producción”. La readiness sigue gobernada por los tickets canónicos de Notion y la evidencia de release correspondiente.
