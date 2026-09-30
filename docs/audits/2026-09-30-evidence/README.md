# Guardian — evidencia de fronteras y deuda técnica (2026-09-30)

## Alcance y versión

Código de referencia: `c6c0a2bcd9f35167a1fee919a749ac1aa625e72e` (HEAD local y origin/main al iniciar). Revisión directa, sin subagentes. Se consultó el README remoto mediante GitHub API y se contrastó su contenido con el checkout; se corrigió documentación en una rama/worktree aislada.

Este informe es un **snapshot de evidencia**, no otra cola de estados. El estado vivo y los criterios de cierre están en Notion Alpha 41. No se modificaron fuentes productivas, credenciales, datos operacionales, ledger ni emergencias. Los cambios locales preexistentes del checkout principal se preservaron.

## Hallazgos confirmados y tickets

### H1 — visitantes del proyecto anterior

- Fuente: `src/pages/Visitors.tsx:497-499`; `src/hooks/useActiveVisitors.ts:51-79`.
- La página solo actualiza `localVisitors` cuando hay datos no nulos. Si B responde con error, conserva la lista de A; también se reproduce pasando por «sin proyecto».
- Las sondas usan el componente real y un hook simulado. Un error `forbidden` sintético no demuestra acceso indebido aceptado por servidor.
- Control positivo independiente: el hook aborta la solicitud previa y no acepta su respuesta tardía. Esto no limpia automáticamente el estado duplicado en la página.
- Estado de esta revisión: **sin fix**. Cierre: datos y acciones ligados a identidad/proyecto; regresiones A→B→A, null, error/offline; integración autorizada con permisos negativos y readback.
- Ticket: [Visitors](https://app.notion.com/p/Audit-2026-09-30-P1-Visitors-conserva-visitas-del-proyecto-A-al-cambiar-a-B-o-pasar-por-sin-proyec-3ebaa66d73fe814c80c5f90cb6751afe).

### H2 — modal MOC fuera de su proyecto

- Fuente: `src/pages/OperationalChanges.tsx:202-232`.
- El modal retiene un cambio de A; al confirmar después de seleccionar B, el transporte simulado recibe `B` y `change.id` de A.
- No se demostró aceptación/mutación backend. Hay que contrastar todos los handlers de transición, no inferir bypass a partir del cliente.
- Estado: **sin fix**. Cierre: invalidar/bloquear la acción cuando cambia identidad/ámbito, verificar el proyecto del cambio y probar approve/reject/revert/verify, doble envío y auditoría.
- Ticket: [Modal MOC](https://app.notion.com/p/Audit-2026-09-30-P1-MOC-modal-de-A-sobrevive-al-cambio-de-proyecto-y-env-a-B-con-changeId-de-A-3ebaa66d73fe81c0a573e395b436fb5a).

### H3 — contrato de rol MOC incompatible con contexto

- Fuente: `src/pages/OperationalChanges.tsx:87-97`; `src/contexts/FirebaseContext.tsx:6-18`.
- La página lee `user.customClaims.role`, pero el contexto expone `userRole`. Un usuario con `userRole=prevencionista` sin ese campo en `User` pierde el botón de aprobar en la sonda.
- Es un defecto de disponibilidad/permisos UI; no demuestra elevación de privilegios en backend.
- Estado: **sin fix**. No reemplazar ciegamente por un rol global: acordar el contrato de membresía por proyecto y verificarlo contra el servidor.
- Ticket: [Rol MOC](https://app.notion.com/p/Audit-2026-09-30-P1-MOC-deriva-rol-de-user-customClaims-y-omite-userRole-del-contexto-3ebaa66d73fe8188a45ce70908fbf929).

### H4 — fixture de historial dependiente del calendario

- Fuente: `src/server/routes/shiftHandover.history.test.ts:116-138`; filtro `src/server/routes/shiftHandover.ts:350-367`.
- El caso inserta fechas absolutas de julio/agosto y consulta `history?days=90`; el primer registro deja de estar dentro de la ventana conforme avanza el reloj.
- Ejecución actual: 4 PASS / 1 FAIL. Misma configuración original con `Date.now` fijado a `2026-08-15T12:00:00Z`: 5 PASS.
- **Corrección de la explicación anterior:** este caso usa **90 días**, no el default de 30. No se demostró pérdida de historial real.
- Estado: **sin fix**. Cierre: fixtures relativos o reloj controlado/restaurado, límites de ventana y orden/401/403; no ampliar retención para ocultar el fallo.
- Ticket: [Historial/reloj](https://app.notion.com/p/Audit-2026-09-30-P2-shiftHandover-history-fixture-absoluto-caduca-frente-al-filtro-days-90-3ebaa66d73fe8172b687ddbdf9713caa).

### H5 — datos clínicos reaparecen tras cambio de identidad

- Fuente: `src/pages/HealthVaultViewer.tsx:111-125,245-297`.
- El efecto limpia estado al cambiar `user`/grant, pero la operación asíncrona `openVault` puede terminar después y publicar `state=open` con registros de la identidad previa.
- Dos reproducciones con datos sintéticos: logout antes de respuesta de registros; cambio a B mientras su identidad aún se verifica. Ambas vuelven a mostrar el registro sintético de A.
- Es exposición residual en el cliente. **No demuestra que backend autorice al usuario B a leer datos de A.**
- Controles positivos: las suites existentes prueban sesiones/destinatario/revocación y rutas autenticadas en un entorno con mocks; 94 PASS. No se ejecutó la integración excluida de emulador ni autenticación real.
- Estado: **sin fix**. Cierre: invalidar generación de identidad/grant y cancelar solicitudes; comprobar vigencia después de cada await y antes de renderizar; logout, usuario/grant nuevo, revocación, expiración, unmount/error; integración con datos sintéticos y permisos negativos.
- Ticket: [Health Vault/identidad](https://app.notion.com/p/Audit-2026-09-30-P1-HealthVaultViewer-respuesta-tard-a-vuelve-a-mostrar-registros-tras-logout-o-ca-3ebaa66d73fe81c8bd07cc5066105fba).

## Registro en Notion

Se consultó la base viva paginada y se contrastaron títulos/specs relevantes antes de crear los cinco tickets anteriores. Cada creación se verificó con lectura de la página exacta: título, Spec y estado `Spec'd`. Cuatro prioridad `high`, historial prioridad `med`; ninguno se cerró ni se presentó como corregido. «Parcial» en el campo E2E solo indica evidencia parcial; aquí se explicita que las reproducciones usan mocks y falta E2E real.

No se aplicaron estados de cierre a tickets históricos ni se interpretó `Cancelled` como implementación.

## Resultados: ejecuciones separadas, NO sumar

Resultados por archivo/aserción en [results-summary.json](./results-summary.json).

| Ejecución | Resultado | Qué prueba / qué no prueba |
|---|---|---|
| Health Vault existente, 6 archivos | 94 / 94 PASS | Casos UI/servicios/handlers con mocks; no servidor/Firebase ni Android reales |
| Archivo de sondas, 4 archivos | 25 / 25 PASS | Mezcla de controles/baselines y reproducciones de defectos; **NO 25 correcciones** |
| Historial con reloj actual | 4 PASS / 1 FAIL | Fixture calendario reproduce deuda de prueba |
| Historial con reloj fijo | 5 PASS | Diagnóstico diferencial; no certifica producción |
| Helpers/policy de la pasada anterior, 4 archivos | 24 / 24 PASS | Cálculos y política unitarios; no integración ni cartografía operativa |

Las sondas archivadas contienen 9 casos heredados de HealthVaultViewer y 5 heredados de Visitors, además de las sondas de esta investigación. Solapan con las suites de producto: no inflar la cobertura sumándolas.

Salida literal de las ejecuciones recientes:

```text
HEALTH_EXISTING_EXIT=0
OPERATIONAL_RECONFIRMED_EXIT=0
PORTABLE_AUDIT_EXIT=0
HISTORY_CURRENT_EXIT=1
HISTORY_FROZEN_EXIT=0
```

## Reproducir las sondas

Desde un checkout con dependencias instaladas:

```bash
npx vitest run --config docs/audits/2026-09-30-evidence/vitest.config.mjs
```

El runner es opt-in y mantiene las expectativas de los **defectos observados**. Los archivos están fuera de `src` y no se incorporan a la suite normal como contratos deseables. Cuando se corrija un ticket, convertirlo en regresión del comportamiento seguro dentro de la suite productiva; esta reproducción histórica puede entonces fallar legítimamente.

Para archivar desde un worktree sin dependencias, el runner admite `GUARDIAN_AUDIT_SOURCE_ROOT=<checkout con dependencias>`; documentar el SHA de ese checkout. Esta revisión ejercitó ese modo contra el SHA de referencia. No se probó una instalación nueva con `npm ci`.

Para el diagnóstico de H4 se reutilizó `vitest.config.ts` sin cambiar su contrato: include del único archivo histórico y setup adicional con `vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-15T12:00:00Z'))`. No se alteró el código productivo ni las expectativas originales.

## Superficies y variantes: conservar el alcance

La [matriz de superficies](./surface-variants.csv) conserva el inventario de la investigación anterior: 209 archivos × 11 ejes = 2 299 filas. En esta pasada se revalidó el SHA-256 de cada archivo inventariado; sin diferencias frente al snapshot de referencia. **No son 2 299 tests ejecutados ni 2 299 defectos.**

Los estados de ledger allí son históricos. Una referencia de Obsidian o un hash presente no equivale a lectura completa ni funcionamiento. Cada fila debe reconciliar evidencia anterior, indicar N/A con motivo cuando no corresponda, y enlazar el ticket canónico si hay una carencia validada. No se promovió el ledger.

Pendientes de cobertura explícitos, no nuevos defectos afirmados:

- Landing/Login/Splash y wrappers: acceso indirecto, retorno/login y cambio de shell.
- Health Vault: identidad real, emulador de reglas, destinatario/revocación y transiciones de sesión/grant.
- Montajes globales: limpieza de listeners, background/proceso muerto, sincronización y entrega; una declaración JSX no acredita sensores ni consumidor final.
- Planos/mapas/clima: componente realmente montado, origen/edad/incertidumbre de datos y permisos de ubicación; no atribuir el mock legacy a la ruta actual.
- Activos/EPP/mantenimiento, firma/documentos y Zettelkasten: preservar recorridos ya investigados y extender hasta persistencia/readback y consumidor real.
- Integraciones legales/ERP/Drive/IoT: aceptación y recuperación desde destino real, no solo documento generado o mock.
- Android físico/OEM: build trazable, permisos, suspensión/Doze, proceso muerto, notificaciones, almacenamiento/outbox y BLE/GPS donde corresponda. Esta revisión no aporta esa evidencia.

## Deuda histórica del README que no se debe olvidar

El README anterior listaba TLS pinning, notificaciones/full-screen, aislamiento handler-by-handler, protección de ramas, firma/secretos de release y fallos de deploy. Se preservan aquí como **antecedentes a reconciliar con Notion y código actual**, no como defectos actuales revalidados ni tickets nuevos por duplicación. No se consideraron corregidos al retirar conteos/aseveraciones antiguas del README. Consultar los runbooks de build/firma, GitHub Actions y las auditorías históricas de Obsidian para revalidarlos.

También se corrigieron problemas documentales confirmados: enlaces locales inexistentes, un comando `graphify:update` ausente de `package.json`, configuración Firebase versionada confundida con credencial privada, una lista mínima de entorno que no reflejaba el validador de producción y métricas históricas presentadas como estado actual.

## Orden propuesto para corregir, sin recortar

1. Fronteras de identidad/proyecto y privacidad (H5, H1, H2/H3): regresiones de contrato antes del cambio.
2. Determinismo de prueba H4 y pruebas de límites/errores.
3. Persistencia/lectura de vuelta y permisos negativos en entornos de integración autorizados.
4. Completar variantes de las demás verticales con la matriz y evidencia acumulada.
5. Build Android trazable, pruebas físicas y requisitos vigentes de tienda, sin dar por aprobada publicación ni declarar listo con pendientes.

No se necesitó consultar Jev para estos resultados: proceden de lectura y ejecución directa. Una decisión tipada no sustituiría la prueba del defecto ni la validación física.
