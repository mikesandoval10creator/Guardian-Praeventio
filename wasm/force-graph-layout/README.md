# force-graph-layout — módulo WASM experimental del layout del KnowledgeGraph

Puerto Rust de la dinámica 2D de `src/workers/forceGraphWorker.ts`
(quadtree/Barnes–Hut, carga repulsiva, enlaces con sesgo por grado, centrado,
colisiones, enfriamiento, amortiguación, generador determinista). El algoritmo
adapta **d3-force** y **d3-quadtree** (Copyright Mike Bostock, **ISC** — ver
`LICENSES/`).

**Este módulo no está activado en el producto.** `KnowledgeGraph` sigue usando
el worker TypeScript por defecto; la ruta WASM solo se usa mediante inyección
explícita de un `createWasmWorker` de confianza (opt-in) y con
`wasmEnabled: true`. Ver `docs/runbooks/force-graph-client.md` para el contrato
de fallback/cancelación.

## Provenance

Copia de distribución del crate del laboratorio
`M:/Guardian Praeventio/labs/force-graph-rust-parity-20261027/rust/` (sesión
2026-10-27). Se conserva el nombre del paquete
(`force_graph_fixture_probe`) para no romper la trazabilidad con los artefactos
y hashes del laboratorio (`evidence-manifest.json` allí). Único cambio de
fuente respecto del laboratorio: la atribución de licencia del comentario
cabecera corregida a ISC (el texto físico de la licencia es ISC, no
BSD-3-Clause).

Verificación funcional del laboratorio (11 casos diferenciales vs el
`runSimulation()` real + benchmark Workers reales en Chromium) permanece
válida: `src/workers/forceGraphWorker.ts` es byte-idéntico entre el snapshot
del laboratorio (`9cc92be3`) y este checkout (verificado con
`git diff --quiet 9cc92be3 origin/main -- src/workers/forceGraphWorker.ts`).

## Construcción reproducible

Prerrequisitos: Rust **1.99.1** (clavado en `rust-toolchain.toml`) con target
`wasm32-unknown-unknown`. Sin red: usa el registro local con `--offline
--locked` contra el `Cargo.lock` commiteado.

```bash
npm run layout-wasm:build          # desde la raíz del repo
# o directamente:
node scripts/build-force-graph-wasm.mjs
```

El script compila `--release --target wasm32-unknown-unknown --locked
--offline`, calcula SHA-256 del `.wasm` y lo copia versionado por hash a
`dist/force-graph-layout-<sha256>.wasm` (gitignored) junto con
`dist/build-report.json`. La determinisidad se demuestra reconstruyendo desde
cero y comparando el SHA-256; el módulo NO se commitea al repo: la fuente + el
lock + el pin de toolchain son la fuente de verdad.

## ABI

Exports de `src/bin/force_graph_layout.rs` (módulo WASM sin WASI, sin
imports):

| Export | Firma | Semántica |
|---|---|---|
| `memory` | `WebAssembly.Memory` | memoria lineal (crece bajo demanda; el límite duro por instancia es gate pendiente) |
| `graph_alloc(len: usize) -> *mut u8` | reserva `len` bytes para la entrada JSON |
| `graph_free(ptr, len)` | libera un bloque reservado por `graph_alloc` |
| `graph_layout(ptr, len) -> u64` | ejecuta la simulación sobre el JSON en `ptr..ptr+len`; devuelve `(length << 32) \| address` del JSON de salida en memoria lineal |

Entrada: `{nodes:[{id,x?,y?,z?}],links:[{source,target}],iterations?,dim?}`.
Salida: `[{id,x,y,z?}]` en el mismo orden de `nodes`. Contratos de error y
límites del loader experimental (2 MiB entrada, 8 MiB salida, 128 MiB memoria)
residen en el adapter del laboratorio; la aplicación productiva y su factory
son el gate de adopción.

## Auditoría de licencias

`LICENSES/THIRD-PARTY.md`: d3-force y d3-quadtree (ISC), serde y serde_json
(MIT OR Apache-2.0). Los textos físicos están en `LICENSES/` y en el registro
local de cargo. Revisión independiente pendiente antes de cualquier
distribución binaria.

## Gates de adopción pendientes

1. ~~Fuente/build/asset reproducible + auditoría de licencias~~ (este slice;
   la revisión independiente de la auditoría continúa pendiente).
2. Límite duro de memoria por instancia (hoy: contención vía loader, no por el
   módulo).
3. E2E del consumidor/canvas bajo CSP y bundling desplegados.
4. Revisión independiente del código y de la evidencia.
5. Rollback operacional con flag/versionado probado y mediciones
   representativas móvil/navegador.

Rollback actual: quitar el `layoutClient` inyectado (o `wasmEnabled: false`)
restaura el worker TypeScript; borrar/retirar el asset del módulo no afecta el
producto porque nada lo carga por defecto.
