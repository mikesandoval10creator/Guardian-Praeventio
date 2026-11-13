# ADR 0034 — Credenciales IoT tenant-scoped en almacenamiento server-only

- Status: Proposed
- Date: 2026-11-13
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: ADR-0015, Notion `3cdaa66d-73fe-81be-a4c9-edd00842ca98`, `security_spec.md`, `firestore.rules`

## Context

`tenants/{tenantId}` es legible por miembros del tenant. El endpoint de rotación guardaba allí `iotSecret`, una clave HMAC que permite autenticar telemetría. Además, el catch-all de lectura para subcolecciones tenant alcanzaba `tenants/{tenantId}/iot_devices/{deviceId}.secret`: el emulador confirmó que un miembro podía leer y listar esa colección. Firestore rules no redacta campos de un documento; el secreto debe vivir fuera de los documentos legibles o la ruta debe quedar explícitamente server-only.

La ingestión necesita el secreto en claro para verificar HMAC-SHA256. Un hash unidireccional no es sustituto funcional; Secret Manager sería una alternativa más fuerte, pero requiere ciclo de vida/IAM por tenant y una integración nueva. El ticket permite una colección server-only y el backend ya usa Admin SDK para rotación e ingestión.

## Invariantes y drivers

- Un miembro del tenant no puede leer ni escribir claves tenant ni claves por dispositivo desde Firebase client SDK.
- El Admin SDK continúa verificando HMAC canónico y el endpoint de rotación sigue siendo admin-only y entrega la clave solo en la respuesta autorizada.
- No registrar ni incluir valores de claves en auditoría, métricas, errores, consola o reportes.
- La transición no rompe telemetría de tenants aún no backfilled; el fallback legacy es temporal y no produce logs por muestra. El inventario se obtiene con el dry-run.
- Nunca ejecutar el backfill en producción sin autorización específica, dry-run revisado y verificación posterior.

## Opciones consideradas

### A — Mantener el secreto en `tenants/{tenantId}`

Rejected. La lectura de tenant es documento-completo; Firestore rules no permiten ocultar solo `iotSecret`.

### B — Secret Manager por tenant

Más aislamiento frente a lecturas de Firestore, pero exige gestionar IDs/versions de secretos, permisos de lectura del servicio, creación/rotación por tenant y una migración de back-end. Queda como alternativa futura si el modelo de amenaza incluye compromiso del service account.

### C — `tenant_iot_secrets/{tenantId}` server-only (propuesta)

El backend guarda y lee la clave con Admin SDK; rules niega explícitamente todo acceso cliente. La colección queda fuera del documento tenant legible. `tenants/{tid}/iot_devices` se excluye del catch-all y queda server-only porque sus rutas actuales son exclusivamente de servidor.

## Proposed decision

Adoptar C para las claves HMAC tenant-scoped:

1. `telemetry.ts` lee primero `tenant_iot_secrets/{tenantId}.iotSecret`.
2. Mientras haya datos legacy, el backend puede leer `tenants/{tenantId}.iotSecret` como fallback server-side sin log por muestra; el dry-run reporta los documentos pendientes sin imprimir claves.
3. `rotate-secret` escribe el nuevo secreto en la colección server-only y elimina el campo legacy del documento tenant en una escritura atómica.
4. `migrate-tenant-iot-secrets.cjs` soporta dry-run por defecto y transacción por tenant; conflictos se saltan sin sobrescribir. `--apply` requiere proyecto y confirmación explícitos.
5. Rules niega `tenant_iot_secrets/*` y excluye `iot_devices` del catch-all tenant-read. El Admin SDK mantiene la lectura de MQTT/telemetría.
6. El fallback legacy se elimina en un cambio posterior solo después de verificar que no queda ningún campo `iotSecret` en tenant roots.

## Seguridad, amenazas y consecuencias

- Elimina lectura de claves por miembros del tenant una vez desplegadas las rules y completado el backfill.
- El service account que ejecuta el backend aún puede leer secretos; IAM mínimo y auditoría de acceso siguen siendo controles necesarios.
- Durante la ventana entre despliegue y backfill, los secretos legacy que sigan en tenant roots continúan siendo legibles por miembros. Por eso este cambio no basta para declarar el hallazgo cerrado ni Guardian listo para producción.
- El servidor entrega una clave nueva únicamente al admin autorizado; la auditoría registra tenant/actor, nunca el valor.
- Conflicto entre destino y legacy exige revisión manual: el script no sobrescribe una clave distinta ni borra la copia antigua.

## Migración y rollback

- Primero desplegar el lector new-first + fallback y las rules; no ejecutar el script contra producción desde esta sesión.
- Ejecutar dry-run para el proyecto y alcance explícitos; revisar contadores/conflictos sin exportar claves.
- Tras autorización operativa independiente, aplicar por tenant o `--all`; el script elimina el legacy field dentro de la misma transacción que copia la clave.
- Ejecutar dry-run otra vez: `wouldMigrate=0`, `wouldClearLegacy=0`, `conflicts=0` es condición para retirar el fallback en una fase posterior.
- Después del backfill, no volver a una revisión que solo lea `tenants/{id}.iotSecret`. Preferir roll-forward; reintroducir claves en documentos legibles exigiría una decisión de riesgo explícita.

## Verification gates

- Firestore Emulator: miembros no leen/listan ni escriben `tenant_iot_secrets` o `iot_devices`; los resultados usan solo claves sintéticas.
- Router tests: rotación no conserva `iotSecret` en el documento tenant, HMAC sigue aceptando la clave protegida y el secreto no aparece en auditoría.
- Migración: dry-run no modifica; apply copia/deletes atómicamente; repetición es idempotente; discrepancias se reportan sin valor de clave.
- Production verification and Notion closure remain pending until an explicitly authorized backfill/readback is complete.
