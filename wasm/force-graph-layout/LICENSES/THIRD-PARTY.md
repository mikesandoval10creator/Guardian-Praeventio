# Auditoría de licencias de terceros — módulo force-graph-layout

Verificado físicamente contra los textos en disco (registro local de cargo y
LICENSES/ de este directorio) el 2026-10-28.

| Componente | Versión | Licencia | Evidencia |
|---|---|---|---|
| d3-force (algoritmo adaptado) | 2010-2021 Mike Bostock | **ISC** | `LICENSES/d3-force.LICENSE` (texto literal ISC: "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee") |
| d3-quadtree (Barnes–Hut adaptado) | 2010-2021 Mike Bostock | **ISC** | `LICENSES/d3-quadtree.LICENSE` (mismo texto ISC) |
| serde | 1.0.229 (clavada en `Cargo.lock`) | MIT OR Apache-2.0 | `~/.cargo/registry/src/*/serde-1.0.229/{LICENSE-MIT,LICENSE-APACHE}` |
| serde_json | 1.0.154 (clavada en `Cargo.lock`) | MIT OR Apache-2.0 | `~/.cargo/registry/src/*/serde_json-1.0.154/{LICENSE-MIT,LICENSE-APACHE}` |

## Notas

- El comentario de atribución original del laboratorio decía "BSD-3-Clause";
  los textos de licencia reales de d3-force y d3-quadtree son **ISC**. El
  comentario del fuente fue corregido acorde al texto físico de la licencia.
  La licencia de d3 permite uso, modificación y redistribución con o sin fee,
  conservando el aviso de copyright y de permiso.
- La auditoría inicial cubría solo las dos dependencias directas. No equivalía
  al grafo completo: el lock también contiene dependencias transitivas y de
  compilación. El inventario ampliado siguiente corrige ese alcance.
- Este módulo **no se distribuye ni activa** con el producto todavía. Antes de
  cualquier activación productiva queda pendiente la revisión independiente de
  esta auditoría y de la licencia del binario combinado.

## Inventario completo del lock (fuentes y herramientas de compilación)

`cargo-license-inventory.json` registra nombre, versión, expresión SPDX literal,
checksum de cada archivo `.crate` y hashes/tamaños de sus avisos. Los textos
completos viven en `crates/<nombre>-<versión>/`; se conservan ambas alternativas
cuando hay `OR`, sin elegir una licencia por el titular. **Unicode-3.0 es una
obligación adicional (`AND`), no una alternativa a MIT/Apache.**

- itoa 1.0.18 — MIT OR Apache-2.0
- memchr 2.8.3 — Unlicense OR MIT (incluye COPYING y UNLICENSE)
- proc-macro2 1.0.107 — MIT OR Apache-2.0
- quote 1.0.47 — MIT OR Apache-2.0
- serde 1.0.229 — MIT OR Apache-2.0
- serde_core 1.0.229 — MIT OR Apache-2.0
- serde_derive 1.0.229 — MIT OR Apache-2.0
- serde_json 1.0.154 — MIT OR Apache-2.0
- syn 3.0.9 — MIT OR Apache-2.0
- unicode-ident 1.0.27 — (MIT OR Apache-2.0) AND Unicode-3.0
- zmij 1.0.23 — MIT

### Verificación reproducible, sin red

`python scripts/audit-force-graph-licenses.py --check` (Python >=3.11; en Linux
`python3`) ejecuta Cargo metadata `--locked --offline`, exige cobertura exacta
del lock, verifica el SHA256 de cada archivo `.crate` contra Cargo.lock y
compara sus textos de aviso con el cache extraído y las copias versionadas.
No depende de la presencia de `.cargo-checksum.json`: algunos caches no lo
incluyen. Los archivos tar se leen en memoria; nunca se extraen al filesystem.

La suite canónica `test:layout-wasm` comprueba siempre lock/cobertura/copias y
el `AND Unicode-3.0`. Con `LAYOUT_WASM_REQUIRED=1` también exige Python/Cargo y
la auditoría viva offline más pruebas adversariales. Falta de runtime, cache,
paquete, aviso o checksum válido = fallo, no skip. El modo opcional no presume
que ejecutó la auditoría viva. El job requerido de adopción prepara el cache
con su etapa de fetch locked ya existente y configura explícitamente Python
3.12 con `actions/setup-python` fijado a un commit inmutable; el contrato YAML
verifica ese runtime y su posición antes del audit. No se añaden paquetes pip
ni descargas a los tests. Se soporta el layout estándar registry/src +
registry/cache indicado por metadata (también bajo otro CARGO_HOME); fuentes
Git/path/vendor/mirrors fuera de ese contrato requieren auditoría explícita.

Para una primera generación tras revisar las fuentes:
`python scripts/audit-force-graph-licenses.py --write`. El script rechaza
sobrescribir avisos distintos o un inventario incompatible; los cambios de
lock requieren una reauditoría explícita, no regeneración automática para
obtener verde. `.gitattributes` local desactiva conversión de bytes de avisos.

### Límites de la conclusión

Se inventaría todo el grafo Cargo, incluidos macros usados en el host; **no se
infiere que todos estén embebidos en el WASM**. No cubre por extensión el
sysroot/stdlib de Rust, LLVM/lld, avisos del compilador ni una aprobación legal
del binario combinado. Se preservan aparte los avisos ISC de d3 anteriores.
El repositorio tiene licencia MIT, pero Cargo.toml de este crate no declara
`license`: el inventario registra ese null sin asignar una licencia nueva ni
relicenciar las adaptaciones ISC. La metadata de empaquetado y la revisión
independiente del artefacto final siguen pendientes. `distributionApproved`
permanece false; TypeScript sigue default/fallback y F3 no se cierra aquí.
