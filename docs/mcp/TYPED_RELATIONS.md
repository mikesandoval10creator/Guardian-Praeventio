# MCP — relaciones tipadas almacenadas (solo lectura)

`zk.listEdges` permite que un host MCP consulte tipos/dirección/peso/fechas
**ya persistidos** en el grafo. No convierte `connections[]` en relaciones
semánticas, no crea inversas ni sustituye el recorrido BFS existente. No llama
modelos, no necesita sampling y no ingiere respuestas externas.

## Activación explícita

El launcher `bin/mcp-server.mjs` exige simultáneamente:

1. Tenant en `PRAEVENTIO_MCP_TENANTS` (whitelist existente).
2. Par tenant/proyecto en `PRAEVENTIO_MCP_SAMPLING_PROJECTS` (allowlist de contexto
   existente; no exige usar sampling para esta lectura).
3. `PRAEVENTIO_MCP_TYPED_EDGES=1`, literalmente. Ausencia, `0`, `true`, espacios
   o errores tipográficos NO habilitan la tool.

Sin reader o proyectos configurados, la tool no aparece en `tools/list` y una
invocación directa se rechaza. En consumidores programáticos, inyectar
`readEdges` en `StdioAdapterConfig` constituye el opt-in equivalente. El reader
Firebase comprueba también su propia copia de whitelist y proyectos permitidos.

Ejemplo **solo de configuración** (IDs ficticios; reemplazar por los autorizados):

```bash
export PRAEVENTIO_MCP_TENANTS='tenant-x'
export PRAEVENTIO_MCP_SAMPLING_PROJECTS='[{"tenantId":"tenant-x","projectId":"project-x"}]'
export PRAEVENTIO_MCP_TYPED_EDGES=1
npm run mcp:start
```

El host llama `zk.listEdges` con estos argumentos, no con credenciales:

```json
{ "tenantId": "tenant-x", "projectId": "project-x", "limit": 25 }
```

`projectId` es obligatorio; `limit` debe ser entero entre 1 y 50 (default 25).
No se aceptan argumentos extra ni paths. Los IDs no se normalizan o reparan.

## Frontera y presupuesto de lectura

- Consulta `tenants/{tenantId}/zettelkasten_edges` con filtro `projectId ==`
  **antes** del límite. No realiza un escaneo tenant-wide para luego filtrar.
- Lee hasta `limit + 1` candidatos, procesa como máximo `limit`. El candidato
  extra señala `scanLimited`, no se interpreta como una página completa.
- Para cada arista válida verifica ambos extremos en
  `tenants/{tenantId}/zettelkasten_nodes`: documento existente, proyecto exacto,
  y tenant no contradictorio. Un tenant stamp ausente se confía únicamente por
  la colección tenant-scoped; nunca se acepta un stamp explícito ajeno.
- Cachea comprobaciones de extremos dentro de la solicitud: como máximo 100
  lecturas de documentos de nodos más 51 candidatos de arista. No lee título,
  descripción o metadata para construir el resultado. El SDK puede recuperar
  el documento completo internamente; la proyección no acredita minimización
  física de campos leídos ni elimina el coste normal de Firestore.
- Presupuesta seis intentos/minuto y una operación simultánea **por proceso**,
  compartidos con `prompts/get` y `legal.searchNormative`. No es cuota global
  distribuida ni autenticación individual.
- El payload JSON tiene tope de 64 KiB UTF-8 **antes del envelope MCP**.
  La respuesta se recorta con `scanLimited` si lo supera. El envelope añade
  overhead de serialización. No se promete cancelación remota del almacén.

## Resultado y límites de interpretación

La respuesta contiene `source: "stored-typed-edges"`, el scope solicitado,
`bounded: true`, `scanLimited`, `omitted` y `edges`.

Cada arista conserva literalmente `id`, `fromNodeId`, `toNodeId`, `type`,
`inverseType` y, si existen, `weight`, `validFrom`, `validUntil`, `decayFn` y
`decayHalfLifeMs`. El tipo y su inverso deben coincidir con el contrato
`EDGE_TYPES`/`EDGE_INVERSES`; se rechazan ID interno/documental discordante,
self-loop, peso no finito/fuera de rango y fechas inválidas/invertidas.

No expone `createdBy`, metadata arbitraria ni texto de los nodos. Esto **no es
anonimización**: los identificadores originales y las relaciones pueden ser
sensibles y el host debe aplicar su política de aprobación/retención.

`omitted` cuenta candidatos procesados y descartados por contrato o extremos
no disponibles en el scope, sin revelar sus IDs. No enumera todos los datos
rechazados ni los candidatos posteriores al límite. Un resultado vacío NO
prueba ausencia de relaciones. `scanLimited: false` tampoco certifica un grafo
completo o reconciliación de stores históricos: aristas legacy sin `projectId`,
endpoints presentes solo en otro store y tipos no canónicos no se incluyen.
No hay fallback global ni backfill automático.

La dirección es la almacenada; `inverseType` es una etiqueta, no otra arista
materializada. El peso/fechas son datos almacenados, no peso efectivo calculado,
prueba causal, vigencia normativa o certificación de que una barrera protege
realmente. El host debe citar los IDs presentes y distinguir registros de
suposiciones; ninguna lectura autoriza trabajo, activa emergencias o modifica
el sistema. La semántica y el backlog de productores/consumidores siguen siendo
trabajo separado.

Los fallos del almacén se devuelven como error, no éxito vacío; mensajes del
SDK, paths, IDs rechazados y credenciales no se propagan al cliente.

## Verificación reproducible

```bash
npm run test:ci -- src/server/mcp/typedEdgesReader.test.ts src/services/mcp/typedEdges.test.ts src/services/mcp/typedEdges.protocol.test.ts
npm run test:mcp-build
npm run verify:fresh
```

Los tests cubren query project-scoped antes del límite, prefijo masivo de datos
ajenos, contratos malformados, endpoints extranjeros/ausentes, deduplicación de
lecturas, tope UTF-8, opt-in exacto, presupuesto/concurrencia y errores redactados.
La prueba compilada usa SDK y stdio reales con reader/adapter productivos,
identidad/corpus de fixtures y sin llamadas de inferencia. No es evidencia de
IAM, corpus, revocación individual, transporte HTTP multiusuario o despliegue
productivos. La cuenta de almacenamiento debe ser read-only; las rules no
protegen una cuenta Admin por sí solas.
