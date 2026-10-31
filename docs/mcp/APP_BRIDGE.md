# MCP desde la aplicación — puente interno autenticado

## Qué funciona y dónde

El panel **MCP desde la aplicación** está montado en **Normativas** y **Base de
conocimiento**. Selecciona un proyecto, inicia sesión y pulsa **Conectar MCP del
proyecto**. No se consulta automáticamente al abrir la pantalla.

Cada solicitud recorre:

```text
React → POST /api/mcp/project → Firebase auth + membresía actual
      → Client SDK ↔ InMemoryTransport ↔ servidor MCP existente
      → tools/call o prompts/get → resultado/error visible
```

Es una conexión MCP interna real por SDK, con handshake y una pareja de sesiones
por solicitud. **La ruta HTTP es una API de aplicación, NO un endpoint MCP
Streamable HTTP ni una conexión con servidores externos.** No acepta URLs,
procesos stdio arbitrarios, credenciales LLM, JSON-RPC libre ni mutaciones.
No anuncia sampling: no ejecuta un modelo ni cambia de proveedor.

### Acciones disponibles

- **Catálogo**: `tools/list` filtrado a las tres herramientas soportadas y
  `prompts/list` real (seis acciones).
- **Ver registros por MCP**: `zk.listNodes`, hasta 12 registros del proyecto con
  tipo/título/descripción minimizados. Etiquetas/adyacencia se omiten en esta
  proyección; los arrays vacíos no acreditan que el nodo no tenga conexiones.
- **Ver relaciones por MCP**: `zk.listEdges`, hasta 25 aristas tipadas almacenadas,
  comprobando proyecto/tenant de ambos extremos. Sin inferir inversas o eficacia.
- **Consultar normativa por MCP**: `legal.searchNormative`, recuperador público
  léxico compartido, sin LLM/embeddings por consulta. No-match, truncamiento y
  falla de almacén siguen siendo estados distintos. Referencias no verificadas
  no acreditan vigencia, origen ni validez jurídica.
- **Preparar mensaje**: `prompts/get` con los seis builders canónicos de chat,
  BCN, asesoría ambiental, análisis estructural consultivo, materiales peligrosos
  y MINSAL. Requiere confirmar revisión del contexto y argumentos JSON válidos.
  El panel muestra el mensaje resultante; el usuario puede revisarlo/copiarlo
  manualmente a su host. **No es una respuesta generada.** La aprobación no
  sustituye consentimiento legal ni políticas de retención del host/modelo.

Los campos estructurales/materiales/cantidades los completa el usuario. Los
formatos mostrados son ejemplos editables, no mediciones del proyecto.

## Contrato HTTP acotado

Solo `POST /api/mcp/project`, `Content-Type: application/json` y header de
Firebase auth mediante el helper existente. Ejemplos de cuerpo:

```json
{"projectId":"project-id","action":"catalog"}
```
```json
{"projectId":"project-id","action":"searchNormative","query":"DS 44"}
```
```json
{"projectId":"project-id","action":"preparePrompt","name":"guardian.queryBCN","input":"[\"DS 44\"]","contextApproved":true}
```

También `action: listRecords` y `action: listRelations`, sin argumentos libres.
Campos extra (`tenantId`, URL, nombre de tool arbitrario, etc.) son errores 400.
`projectId` admite literalmente 1–200 caracteres ASCII alfanuméricos, `_` y `-`;
no se normaliza un valor inválido. No hay batching, paginación ni sesiones del
navegador reutilizadas. La respuesta identifica `protocol: mcp-sdk`,
`mode: internal-read-only`, la proyección y el resultado de la operación.

## Autoridad y minimización

- Firebase verifica identidad en el middleware productivo; el servicio lee
  `projects/{projectId}` y usa **ese mismo snapshot** para comprobar membresía
  (`members` o `createdBy`) y resolver `tenantId`. No usa un claim positivo stale
  de membresía ni el tenant introducido por el navegador.
- Un claim tenant explícito contradictorio se rechaza (403). El tenant ausente o
  inválido en el documento produce **409** sin lectura de nodos/aristas ni
  fallback a otro scope. El writer actual de proyectos estampa tenant/creator
  desde la identidad verificada (`projects.ts`); no se migran proyectos legacy
  sin stamp ni se adivina su tenant desde el ID.
- `getNode` y BFS no se exponen por este puente. La fachada solo permite la
  proyección project-scoped; `zk.getNode`, `zk.expandSubgraph` y sampling siguen
  disponibles, cuando corresponda, por el servidor stdio existente, sin cambio.
- Campos de texto usan el redactor canónico antes de truncar. IDs y citas se
  preservan: pueden ser sensibles. **No es anonimización** ni garantía contra
  nombres/secretos arbitrarios o reidentificación.
- No se modifican nodos/aristas. Se intenta un evento de auditoría estándar con
  operación/proyecto/identidad y sin pregunta, argumentos, resultados o mensajes.
  Es best-effort: `auditRecorded: false` se muestra como advertencia, no éxito
  falsamente auditado. Esto no demuestra persistencia de auditoría productiva.
- `Cache-Control: no-store` también precede auth/rate-limit dentro del router.
  El parser JSON global y el servidor conservan sus propios límites de transporte.

## Disponibilidad, límites y rollback

- JSON lógico decodificado de entrada ≤32 KiB UTF-8, además de los límites por
  campo (consulta ≤2000 caracteres y array JSON de argumentos ≤16000).
- Resultado lógico de operación ≤256 KiB UTF-8 **antes** del envelope de la API;
  no es una garantía del tamaño exacto HTTP/envelope MCP.
- Seis intentos/minuto por UID verificado, un trabajo pendiente por UID y cuatro
  por instancia de router/proceso, también al abrir sesiones SDK nuevas. Sin
  cuota distribuida ni promesa de capacidad bajo carga. El catálogo consume un
  intento; el panel no hace polling ni reintentos automáticos.
- Deadline HTTP 15 s, solicitudes SDK 12 s y UI 20 s (incluye autenticación).
  Timeout/desconexión aborta solicitudes SDK; el slot se conserva hasta que la
  tarea realmente termina para no permitir fan-out tras un timeout. No se afirma
  cancelación remota de Firestore. Infra atascada puede mantener slots ocupados.
- Cambiar proyecto, editar o quedar offline descarta respuestas pendientes. El
  temporizador libera UI aun si autenticación tarda y se limpia al desmontar.
- Kill switch de servidor: **`PRAEVENTIO_MCP_APP_DISABLED=1`** literal devuelve
  503 sin acceso a datos. No apaga biblioteca/búsqueda nativa anterior ni stdio.
  El puente interno está detrás de auth/membresía y acción explícita; no se abre
  un listener MCP ni un proveedor externo al importar o montar el panel.
- Revertir el commit o usar el kill switch revierte esta superficie; no hay
  backfill, migración, credenciales ni datos de negocio que restaurar por el slice.

## Verificación y límites de evidencia

```bash
npm run test:ci -- src/server/routes/mcpApp.test.ts src/components/mcp/McpProjectPanel.test.tsx src/services/mcp src/server/mcp src/pages/Normatives.native.test.tsx src/pages/KnowledgeBase.test.tsx
npm run test:mcp-build
npm run verify:fresh
```

Las pruebas de la ruta usan cliente/servidor SDK reales, los builders, readers y
membresía canónicos, sustituyendo identidad/documentos/audit sink por fixtures.
Cubren las seis preparaciones, consultas reales por SDK, tenant contradictorio,
proyecto ajeno/sin stamp, input inválido, kill switch, cuota entre sesiones,
auditoría no confirmada y deadline con storage pendiente sin liberar el lock.
Las de UI cubren montaje sin llamadas, permisos/error, proyecto stale, auth
pendiente, recuperación del deadline y limpieza de timers al desmontar.

El probe Chromium móvil ejecuta **la página productiva Normatives y el panel**,
HTTP y SDK reales, adaptadores/retriever productivos y pertenencia canónica; usa
identidad/Firestore/corpus/auditoría y hooks del shell anterior como fixtures.
Ejercita catálogo, registros minimizados, relaciones, normativa, prompt visible,
403 por proyecto ajeno y 429 por cuota. No reemplaza el SDK con respuestas fake.
No demuestra la aplicación completa, Firebase IAM productivo, corpus real, un
host MCP externo, inferencia comercial ni producción/despliegue. Eso conserva
sus gates separados; tampoco elimina globalmente Google de otros consumidores.
