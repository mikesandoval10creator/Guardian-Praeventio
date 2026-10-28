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
- No se incluyen otros crates: `Cargo.toml` declara únicamente `serde` y
  `serde_json` (con `derive`); el árbol completo del lock es auditable.
- Este módulo **no se distribuye ni activa** con el producto todavía. Antes de
  cualquier activación productiva queda pendiente la revisión independiente de
  esta auditoría y de la licencia del binario combinado.
