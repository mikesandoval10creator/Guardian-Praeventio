# Guardian Praeventio — auditoría de realidad

Fecha: 2026-09-13  
Repositorio: `fix/referee-preview-validation`  
Commit auditado: `b0ba47d1`  
APK/emulador: `com.praeventio.guard`, `emulator-5554`, Android Emulator  
Estado global: **PARCIAL — no end-to-end**

## Regla de evidencia

- **Verificado**: observado en el emulador o producido por un comando autoritativo.
- **Parcial**: hay evidencia de montaje/una parte del flujo, pero falta una transición, side effect o rama.
- **Registrado como deuda**: Notion/código lo declara; no se presenta como bug runtime confirmado sin reproducirlo.
- **Bloqueado**: no se puede probar sin cuenta, permiso, red, datos operativos o infraestructura autorizada.

No se activaron `CRISIS MODE`, `Man Down`, `REPORTAR NEAR MISS`, envíos de alertas ni acciones que modifiquen datos operativos reales.

## Resultados ejecutables

| Capa | Resultado | Evidencia |
|---|---|---|
| TypeScript | PASS | `npm run typecheck`, exit 0 |
| Build Vite | PASS | `node node_modules/vite/bin/vite.js build`, exit 0; generó `dist/sw.js` y precache de 669 entradas |
| Smoke | PASS | `npm run smoke`: 1 archivo, 2 tests |
| Tests críticos aislados | PASS con deuda | 11 archivos, 122/122 tests; 2 async leaks en IA resiliente y `Driving.reportPersisted` |
| Suite completa | NO CONCLUYENTE/BLOQUEADA | `npm test` agotó 420 s; no declarar verde |
| Build completo | NO LIMPIO | `prebuild` depende de assets/variables; regeneró `.well-known` sin fingerprint/PGP cuando faltan valores. Los cambios fueron revertidos y el repo quedó limpio |
| Repo | LIMPIO | `git status --short --branch` sin cambios tras revertir artefactos generados |

## Código: propósito declarado y realidad observable

### Acceso y navegación

`AppRoutes.tsx` declara 124 rutas en operaciones, riesgos, emergencias, salud, compliance, IA y capacitación. La ruta normal monta `LandingPage`/`Login`; `demo=true` existe como rama de demostración, pero no equivale a autorización ni a datos productivos.

En el emulador:

- `/login` monta.
- Se observan `GUARDIAN PRAEVENTIO`, `IDENTITY & AWARENESS`, `BIOMETRIC PROTECTION` y `Sign in with Google`.
- No existe formulario local.
- El intento de abrir Google delegó en onboarding de Chrome; se cerró sin agregar cuenta ni credenciales.
- No se validó autenticación ni rutas privadas.

**Conclusión**: login montado; autenticación end-to-end bloqueada por consentimiento de cuenta.

### Arranque y permisos

Ya verificado en la sesión de emulador:

- `com.praeventio.guard/.MainActivity` arranca y vuelve a primer plano.
- Ubicación precisa/aproximada: `granted=true` en la última consulta.
- Cámara, micrófono/audio y notificaciones: `granted=false`.
- Health Connect: `availability: Available`.
- Sin `FATAL EXCEPTION`, ANR ni `SecurityException` en los logs revisados.

Falta validar ramas concedida/revocada/parcial de cámara, audio, Bluetooth y notificaciones sin aprobar permisos sensibles de forma arbitraria.

### Emergencias y vida-safety

Observado en el emulador:

- Plan de emergencia.
- Protocolos de incendio, terremoto, derrame químico y primeros auxilios.
- Tarjeta médica local.
- Estado de Man Down sin activarlo.
- Alertas recientes.
- Simulacros programados.
- Estado de cumplimiento.
- Panel de normativas.
- Evacuación A*: sin gemelo digital no inventa ruta y exige geometría real.

En código, `EmergencyContext` contiene clasificación offline/server-error y fallback mesh; `EmergencySimulator` declara simulación local/offline, pero su botón de emergencia real no fue pulsado por seguridad.

**Conclusión**: contenido base y fail-safe A* verificados; no están probados delivery, ACK backend, fan-out, push/deep-link, Man Down real, fallback humano ni resolución.

### Offline, persistencia y sincronización

Observado:

- SQLite offline consultable.
- `pending_sync` se consulta sin error y quedó vacío.

Código/tests:

- `offlineStorage` cubre singleton, cifrado, upsert, filtrado por proyecto, cola, black box y breadcrumbs.
- `offlineCrypto` prueba cifrado autenticado y detección de tampering.
- Existen consumidores concurrentes y drenaje al volver online.

No probado en el emulador: dos escritores concurrentes reales, CREATE/UPDATE/DELETE, reintentos, duplicados, conflictos, pérdida/recuperación de red y cola con PII en todos los módulos.

### IA y fallbacks

Código declara:

- Escalera SLM local → RAG → online.
- Respuesta offline para voz/Knowledge.
- Análisis on-device de EPP antes de enrichment cloud.
- Simulación de emergencia offline.

Tests aislados relevantes pasan, pero queda un async leak en `ResilientAiAssistantPanel`. No se validó en el APK la calidad, límites, prompt injection, minimización PII, timeout ni fallback real de IA.

### Conducción, permisos críticos y operaciones

El código expone `Driving`, `WorkPermits`, `LOTO`, zonas restringidas, trabajadores, inspecciones y mantenimiento. La superficie existe, pero el flujo autenticado y los side effects no se pudieron recorrer sin cuenta/datos.

Notion registra específicamente deuda sobre:

- `SafeDriving`: ruta/clima/checklist/controles estáticos o sin handler.
- `DrivingSafety`: mutación de perfil ajeno y scoring inválido.
- `WorkPermits`: UI que no llama `validate-critical`, atestaciones obligatorias ausentes y `pending_approval` no visible.
- `LOTO`: release sin validar energías y role gate insuficiente.
- mantenimiento: tareas sin cierre desde la lista y errores convertidos en vacío.

Estos puntos quedan como **deuda registrada pendiente de reproducción**, no como confirmación runtime del APK.

## Notion Alpha 41 — consulta actual

Se redescubrió y consultó la data source real:

`395aa66d-73fe-81d8-b0e0-000bb3d42d5e`  
Versión API: `2025-09-03`  
Total consultado: **1.724 páginas**

### Estado global

- `Spec'd`: 697
- `Cancelled`: 608
- `Verified`: 244
- `Merged`: 96
- `Ya-real (auditoría)`: 31
- `In-progress`: 21
- `Backlog`: 17
- `Done`: 3
- `Ya-real`: 1
- Estados de PR activos adicionales: 5 páginas
- Una página sin Status

### Estado E2E

- `Falta`: 157
- `Parcial`: 14
- `Sin auditar`: 4
- `Stub`: 1
- `Completa`: 26
- `Completo`: 2
- `Listo`: 1
- 1.518 páginas sin Estado E2E explícito

### Áreas relevantes

- Vidas: 1.138 páginas; 481 `Spec'd`, 90 `Verified`, 10 `Merged`, 7 `In-progress`, 7 `Ya-real (auditoría)`, 1 `Backlog`, 541 `Cancelled`.
- Operaciones: 137; 99 `Spec'd`, 12 `Verified`, 6 `Merged`, 2 `In-progress`, 2 `Backlog`.
- Seguridad: 76; 39 `Spec'd`, 9 `Verified`, 6 `Merged`, 4 `Ya-real (auditoría)`, 3 `In-progress`, 1 `Backlog`.
- IA: 36; 13 `Spec'd`, 4 `Verified`, 3 `Ya-real (auditoría)`.
- Offline: 2; uno auditado y uno merged.
- Salud: 6; 3 `Verified`, 1 `Merged`, 1 auditado, 1 `Backlog`.

La regla de Daniel para declarar producción/Play Store exige todos los tickets en `{Verified, Merged, Done, Ya-real}` y ningún pendiente fuera de ese conjunto. El inventario actual no cumple esa condición; por tanto, **no está lista para producción/Play Store ni para declarar E2E completo**.

## Brechas prioritarias que sí cambian la seguridad

1. Man Down nativo/FGS, doble detector, countdown, ubicación utilizable, idempotencia y ACK/resolución.
2. Entrega de alertas: ACK backend, channel crítico, cold start, deep-link y deduplicación.
3. Offline: serialización SQLite, binding usuario/tenant, PII, estado CREATE/UPDATE y conflictos.
4. Gates de permisos y privacidad: geofence, workers, readiness/fatiga, audit trail y WebAuthn.
5. Permisos de trabajo/LOTO: validación crítica, atestaciones, energías y roles.
6. Conducción: datos reales, score/fatiga, controles operables, persistencia idempotente.
7. IA: fallback independiente de red, límites de PII/inyección y errores que no se presenten como vacío saludable.
8. Test health: eliminar async leaks y aislar el timeout de la suite global.

## Qué falta para llegar a E2E

- Proveer una cuenta de prueba autorizada o un entorno demo oficialmente soportado; no usar cuenta personal ni seleccionar Google sin autorización.
- Reinstalar/ejecutar el APK correspondiente al commit auditado y conservar un identificador de build.
- Preparar datos sintéticos de tenant/proyecto/trabajador; nunca datos operativos reales.
- Ejecutar pruebas por dominio con precondición, acción, evidencia UI/ADB/Firestore y cleanup.
- Probar ramas sin permisos/concedidos/revocados/parciales por separado.
- Ejecutar Firebase rules/emulators y pruebas nativas FGS/WorkManager para vida-safety.
- Corregir el pipeline para que `prebuild` sea fail-closed o no mutante cuando falten certificados/PGP.
- Resolver los 2 async leaks y aislar la suite global que supera 420 s.
- Reconciliar cada hallazgo contra su ticket exacto de Notion; no cerrar tareas amplias por arreglar una pantalla estrecha.

## Estado final de esta ronda

**PARCIAL, con evidencia sólida de compilación y de varios flujos base, pero bloqueada para autenticación y para side effects críticos.** La certeza útil alcanzada es precisamente esta: el producto tiene una superficie real de 124 rutas, los cimientos compilan, parte de vida-safety/offline está implementada y testeada, pero la deuda de Notion sigue conteniendo trabajo E2E y P0/P1 suficiente para impedir una declaración de completitud. No se modificó lógica de producto ni datos operativos.
