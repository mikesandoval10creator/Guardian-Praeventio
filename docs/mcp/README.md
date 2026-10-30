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

## Acciones delegables mediante MCP prompts

Además del sampling opcional, el servidor implementa `prompts/list` y
`prompts/get`. **No requieren sampling**: Guardian prepara los mensajes con
los builders compartidos; el host MCP del usuario decide si los presenta o
los ejecuta con su propio modelo. No son respuestas generadas, no seleccionan
proveedor y no migran automáticamente los botones de la interfaz web.

El mismo opt-in `PRAEVENTIO_MCP_SAMPLING_PROJECTS` autoriza compartir contexto
para estos prompts; el nombre de la variable se conserva por compatibilidad.
Sin pares autorizados la lista está vacía y `prompts/get` rechaza la petición.
Cada llamada revalida tenant/proyecto antes de preparar hasta 12 registros de contexto,
excluye metadata/conexiones/embeddings, aplica redacción a campos de texto
y conserva los identificadores literales. La redacción **no anonimiza** nombres
ni garantiza ausencia de datos sensibles: revisión/aprobación del host requerida.

Los argumentos MCP son strings. `input` es un array JSON de argumentos:

| Prompt | `input` (contrato posicional) |
|---|---|
| `guardian.getChatResponse` | `[mensaje, contextoIgnorado?, historial?, detalle1a3?, dominio?]` |
| `guardian.queryBCN` | `[consulta]` |
| `guardian.getSafetyAdvice` | `[{temp?, uv?, airQuality?}]` |
| `guardian.calculateStructuralLoad` | `[estructura, cargas]` |
| `guardian.designHazmatStorage` | `[tipoAlmacenamiento, volumenPositivo, clasePeligro]` |
| `guardian.evaluateMinsalCompliance` | `[protocolo, contexto?, industria?]` |

Ejemplo `prompts/get` (IDs ilustrativos, no credenciales):

```json
{"name":"guardian.queryBCN","arguments":{"tenantId":"tenant-mineria-x","projectId":"project-x","input":"[\"ruido ocupacional\"]"}}
```

El contexto de chat se construye desde el proyecto autorizado; nunca se acepta
el slot legacy de contexto como evidencia de otro proyecto. Historial: máximo
8 mensajes, roles user/assistant/model; entradas tipadas y acotadas. Toda
salida preparada es **SOLO CONSULTIVO**: no diagnostica, no certifica capacidad
estructural ni cumplimiento, no autoriza trabajos y no dispara emergencias.
El resultado de un modelo externo no se ingiere ni persiste en este recorrido.
El host sigue siendo responsable de respetar esas instrucciones y de la
revisión del profesional competente; el texto del prompt no prueba seguridad
semántica de un modelo.

### Recuperación normativa interna

`legal.searchNormative(tenantId, query)` no necesita LLM ni sampling. Requiere
un tenant de la whitelist y devuelve extractos existentes de `vector_store`
mediante recuperación léxica determinista. El launcher la conecta; una factoría
embebida debe inyectar `retrieveNormative` para anunciar esta tool.

- Lee por rango de IDs `law-*`, proyecta solo campos necesarios (sin embedding)
  y limita a 201 documentos para detectar recorte; considera los primeros 200
  candidatos, devuelve como máximo 3 coincidencias por defecto.
- Exige ID `law-<lawId>-chunk-<n>` consistente y rechaza cualquier fila con
  `nodeId`, `projectId` o `tenantId`, aunque tenga apariencia normativa.
- Solo acepta chunks de hasta 1200 caracteres (el indexador existente usa 1000);
  no devuelve un prefijo que pueda omitir la evidencia que produjo el match.
- Devuelve IDs, extractos literales, términos coincidentes y `method: lexical`.
  `sourceStatus: indexed-unverified`: la URL BCN se deriva del ID, **no** prueba
  verificación web, autoría, actualidad o validez jurídica. La frontera de
  confianza sigue incluyendo al indexador y sus permisos de escritura.
- `scanLimited` advierte corpus recortado; un no-match no demuestra que la norma
  no exista. Esta búsqueda acotada **no equivale al recall vectorial** ni a una
  búsqueda completa del corpus. No genera fragmentos ni números legales.
- Sin coincidencias o con almacén no disponible se declara ausencia de evidencia; no
  hay fallback oculto a embeddings, Gemini o Vertex. Firestore permanece como
  almacenamiento existente, con su coste normal de lecturas.

Los builders selfhosted de chat, BCN y MINSAL usan esta misma recuperación
interna en lugar de generar embeddings para preparar contexto. La ingesta
legacy (`indexLaw`), otros consumidores de RAG y la UI aún pueden depender de
Google; este cambio no anuncia su retirada global.

`prompts/get` y `legal.searchNormative` comparten un presupuesto local de seis
intentos/minuto y una operación simultánea por proceso, separado del sampling.
No es cuota distribuida ni autenticación individual. No añade cancelación
remota al SDK Firestore: cancelar una solicitud del host no prueba que la
lectura ya enviada al almacén se haya abortado. No desplegar como servicio
HTTP multiusuario bajo este contrato stdio administrado.

## Consulta normativa desde la interfaz web

La página **Normativas** ofrece una búsqueda interna **experimental y opt-in**
de extractos con el mismo recuperador que `legal.searchNormative`. No ejecuta
MCP desde el navegador: `POST /api/normatives/search` requiere `verifyAuth`,
acepta exclusivamente `{ "query": "DS 44" }` (4–2000 caracteres, sin IDs de
tenant/proyecto) y lee únicamente el corpus público indexado. No consulta
registros del proyecto, no escribe datos ni usa LLM/embeddings/fallback Google.
La protección adicional es de seis intentos por minuto por UID y proceso,
además del límite global del API; no es una cuota distribuida. La consulta va
en el body, no en la URL; no se registra su texto y la respuesta es `no-store`.

La UI diferencia extractos, ausencia de coincidencias y fallo del almacén
(HTTP 503). Conserva IDs y textos, avisa de procedencia/vigencia no verificadas
y recorte del índice. Las URLs BCN se derivan del `lawId`, no se validan en la
web. Sin conexión sigue disponible la biblioteca local; esta búsqueda no funciona
offline. Cancelación/deadline de 20 segundos en el cliente no acredita aborto
remoto de una lectura Firestore ya enviada.

**Preparar solicitud MCP** muestra un objeto `prompts/get` revisable para
`guardian.queryBCN`. Requiere proyecto seleccionado y un tenant que el usuario
introduce explícitamente; no se adivina el tenant a partir del ID del proyecto.
Es solo preparación manual: no hay transporte MCP, inferencia, envío ni copia
automática al portapapeles. El usuario adapta/copia los argumentos en su host,
cuyo soporte para prompts debe comprobar. La UI no prueba que ese host esté
conectado, que el scope esté autorizado ni que el modelo haya respondido.

Al ejecutar la solicitud en el host, el servidor MCP conserva sus checks de
tenant/proyecto y opt-in del operador. Puede preparar registros del proyecto
para compartirlos con el modelo; la UI lo advierte y requiere revisión del
contexto en el host. Preparar IDs no concede acceso ni sustituye consentimiento.
No introducir claves ni datos personales en estos campos.

Abrir la página ya no dispara sugerencias generativas por industria. La capacidad
anterior se conserva bajo **Solicitar sugerencias IA heredada**, con aviso de
posible uso de Gemini según routing; las respuestas atrasadas se descartan al
cambiar de proyecto. Sincronizar/ingerir la biblioteca y otras funciones legacy
siguen fuera de la independencia demostrada por esta búsqueda.

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
