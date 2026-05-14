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
  (depth max 5, nodos max 200)

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
TypeScript compilados de `dist/`:

```bash
# Una sola vez antes de configurar Claude Desktop:
npm run build:mcp
```

(Si todavía no existe el script: corre `npx tsc -p tsconfig.mcp.json`
o `tsx bin/mcp-server.mjs` para dev sin build previo.)

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
- **No PII exposure.** Los nodos del Zettelkasten son metadata de
  seguridad (riesgos, EPP, normativas). NO contienen datos médicos
  ni de identificación personal (esos viven en colecciones
  separadas con encryption envelope KMS).
- **Logs a stderr.** El stdio transport usa stdout — TODO log va a
  stderr para no contaminar el protocolo.

## Tests

- `src/services/mcp/zettelkastenServer.test.ts` — tools logic
- `src/services/mcp/zettelkastenStdioAdapter.test.ts` — adapter SDK
- `src/server/mcp/zkFirebaseReadAdapter.test.ts` — Firestore adapter
  con mock in-memory
