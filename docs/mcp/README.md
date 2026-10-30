# Praeventio Guardian — MCP Server

El proyecto expone su Zettelkasten **read-only** vía **Model Context
Protocol** (MCP) para que Claude Desktop, Gemini CLI, ChatGPT MCP y
otros clientes puedan consultar el grafo de conocimiento del tenant.

## Tools expuestas

Read-only por contrato:

- `zk.getNode(tenantId, nodeId)` — devuelve un nodo por id
- `zk.listNodes(tenantId, { projectId?, type?, severity?, limit? })` —
  lista con filtros
- `zk.expandSubgraph(tenantId, rootNodeId, depth)` — BFS limitado
  (depth max 3, nodos max 200)

### Análisis con el modelo del usuario (MCP sampling)

`zk.analyzeProject(tenantId, projectId, question)` solicita una generación al
**cliente MCP**, no a un proveedor configurado en Guardian. El cliente elige
modelo, endpoint y credenciales (o un modelo local sin API key). Guardian no
recibe esa clave y este recorrido no importa Gemini/Vertex ni usa un fallback
a esos proveedores. Requiere un cliente que anuncie `sampling`; configurar un
servidor MCP en un cliente no demuestra por sí solo soporte de sampling.

Está **apagado por defecto**. El operador habilita pares concretos de
`tenantId`/`projectId`, además de la whitelist de tenants existente:

```bash
export PRAEVENTIO_MCP_SAMPLING_PROJECTS='[{"tenantId":"tenant-mineria-x","projectId":"project-x"}]'
```

El cliente debe permitir al usuario revisar/aprobar el intercambio y elegir
su modelo según su propia política. No se debe habilitar aprobación automática
de contenido sensible. El opt-in del operador es configuración de acceso, no
prueba de consentimiento regulatorio ni autenticación individual.

- Solo lectura y salida `advisory: true`; no activa decisiones ni certifica seguridad.
- Máximo 12 registros del proyecto; títulos/descripciones acotados, sin metadata,
  embeddings ni conexiones. Los nodos sin proyecto o con scope ajeno se excluyen.
- Cada solicitud pide como máximo 768 tokens de salida, `includeContext: none`,
  deadline de sampling 30 s, una generación simultánea y seis intentos por minuto
  por proceso MCP. El coste real y la aprobación pertenecen al cliente del usuario;
  estos límites no son una cuota global distribuida.
- Se rechazan respuestas vacías, no textuales, excesivas o con citas inexistentes
  en el contexto. Verificar IDs **no demuestra la veracidad** de la interpretación.
- Sin contexto, devuelve un resultado explícito sin invocar el modelo. Si el cliente
  rechaza la generación o no ofrece sampling, no cambia a otro proveedor.
- Las tres tools de lectura anteriores siguen disponibles sin sampling.

**Alcance:** integración stdio administrada por un operador con cuenta de datos
read-only. No es aún un endpoint MCP HTTP multiusuario ni una pantalla BYOK web.
Las llamadas Gemini del resto de la aplicación no se eliminan con este slice.
La configuración de proveedor y sus claves viven en el cliente MCP del usuario;
MCP no convierte automáticamente todos los protocolos de inferencia en uno solo.

**NO** se exponen tools de mutación. El MCP server NUNCA puede
escribir al Zettelkasten — el contrato es enforced en `MCP_TOOLS`
de `src/services/mcp/zettelkastenServer.ts`.

## Citation policy

El server inyecta `ZK_CITATION_POLICY` como `instructions` del
MCP server. El cliente LLM debe citar nodos por id en sus
respuestas. Si el cliente ignora la política, no es culpa del
server — la responsabilidad de la citation está documentada en
la doc de la tool.

## Configuración

### 1. Service Account de Firebase

Crea una SA en GCP con permisos mínimos:

- `roles/datastore.viewer` (solo lectura Firestore)

Descarga el JSON a `~/.config/praeventio/sa.json` (o donde
prefieras).

### 2. Lista de tenants accesibles

El server requiere un whitelist explícito de tenants vía env var:

```bash
export PRAEVENTIO_MCP_TENANTS="tenant-mineria-x,tenant-construccion-y"
```

**Sin esta var, el server NO arranca.** Es la única defensa
upstream para evitar que un MCP client lea tenants ajenos.

### 3. Build TypeScript

El entrypoint es JavaScript puro pero importa los módulos
TypeScript compilados de `dist-mcp/`, independiente del build web:

```bash
# Una sola vez antes de configurar Claude Desktop:
npm run build:mcp
```

`npm run mcp:start` y `npm run mcp:dev` compilan antes de arrancar.
Para conectar un cliente por stdio usando npm, usa
`npm --silent run mcp:start`: los banners de npm no deben llegar al
canal JSON-RPC. La configuración con `node` de abajo evita esos banners;
requiere ejecutar `npm run build:mcp` después de actualizar el código.

### 4. mcp.json (Claude Desktop)

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "praeventio-zk": {
      "command": "node",
      "args": ["/abs/path/to/repo/bin/mcp-server.mjs"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/abs/path/to/sa.json",
        "PRAEVENTIO_MCP_TENANTS": "tenant-mineria-x"
      }
    }
  }
}
```

### 5. Verificar conexión

Inicia Claude Desktop. En el prompt:

```
@praeventio-zk listar nodos del tenant tenant-mineria-x tipo RISK
```

Claude debería invocar `zk.listNodes` y devolver los riesgos del
tenant, citando los node ids.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| Server arranca pero no responde | stdio transport pollutado por console.log; usa console.error |
| `tenant not in accessible list` | `PRAEVENTIO_MCP_TENANTS` no incluye el tenant solicitado |
| `permission-denied` Firestore | Service Account sin `roles/datastore.viewer` |
| Modelos no aparecen en Claude | Cliente no leyó MCP_TOOLS; revisa logs del proceso |

## Seguridad

- **Read-only por contrato.** Las tools NO pueden mutar Firestore.
- **Tenant scoping.** Cada request verifica el tenant contra la
  whitelist. Un cliente comprometido NO puede saltar a otro tenant.
- **Service Account principle of least privilege.** Solo
  `roles/datastore.viewer` — sin permisos de escritura ni de
  configuración.
- **Datos compartidos.** No se presupone que un nodo esté libre de datos personales:
  títulos/descripciones pueden contenerlos. El operador debe autorizar el scope y
  minimizar los datos; el usuario debe revisar la solicitud de sampling en su cliente.
  No habilitar proyectos médicos ni aprobación automática de contenido sensible.
- **Logs a stderr.** El stdio transport usa stdout — TODO log va a
  stderr para no contaminar el protocolo.

## Tests

- `src/services/mcp/zettelkastenServer.test.ts` — tools logic
- `src/services/mcp/zettelkastenStdioAdapter.test.ts` — adapter SDK
- `src/server/mcp/zkFirebaseReadAdapter.test.ts` — Firestore adapter
  con mock in-memory
