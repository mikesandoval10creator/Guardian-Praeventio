# Differential parity: current TypeScript vs experimental graph WASM

This gate compares **executed algorithms**, not stored lab answers. The Node
suite imports `src/workers/forceGraphWorker.ts` from the current checkout using
the declared Node 24/26 native TypeScript support, calls its real
`runSimulation`, and compares it to the actual compiled Rust/WASM ABI. Neither
algorithm is reimplemented, edited, or activated by the test harness.

## Numerical contract (declared before running)

Preserve the existing lab tolerances: absolute `1e-6`, relative `1e-9`.
For every coordinate, require:

```text
abs(actual - reference) <= 1e-6 + 1e-9 * abs(reference)
```

Also require finite coordinates on both sides, exact node count and ID order,
matching XY/XYZ shape, unchanged input data, deterministic repeated ABI
calls on the same instance, and deterministic repeated TypeScript runs.
Negative controls reject finite coordinate drift, foreign IDs, truncated
output, non-finite values and unexpected Z. A further control deliberately
swaps axes and shifts a coordinate in **actual WASM output** and requires
rejection. These tolerances are **not** speed/adoption thresholds.

## Inputs and provenance

Twelve cases: empty, single-unseeded, two-seeded, coincident, warm-3d, dangling,
duplicate IDs, unseeded multi-node, mixed-degree, and the existing shared
100/1000/10000-node fixtures. The mixed-degree graph has a link with degree3
at both endpoints, exercising a non-unit link strength. Shared JSON inputs
were copied byte-for-byte from the historical
`force-graph-rust-parity-20261027` lab. Their SHA256/size/shape metadata is
versioned in `scripts/fixtures/force-graph/manifest.json` and verified by the
suite. That check guards committed input integrity, not independent historical
authentication: migration provenance is backed by separately preserved lab
hash evidence. No golden positions or frozen TypeScript reference is copied.

The run emits the current reference SHA256, actual WASM SHA256, fixed
tolerances and each case's maximum absolute coordinate error. Source bytes are
checked unchanged before/after the run. Historical lab results and sources are
preserved; this suite writes no output into the lab.

## Running / CI

```sh
npm run layout-wasm:build -- --clean
LAYOUT_WASM_REQUIRED=1 npm run test:layout-wasm
```

The canonical command now includes the parity suite, so the required full-stack
CI job executes it after compiling the artifact. Required mode fails without
bytes. Optional non-adoption runs may honestly skip the differential group
when WASM has not been built; the comparator and fixture guards still execute.
See `docs/runbooks/force-graph-client.md` for the established artifact/CSP lane.

## Limits

Passing this finite fixture matrix is not a proof for every graph, every
floating-point edge case, engine/browser or device. It proves numerical parity
on these cases against the **current** reference and dependency installation.
It does not measure a speed benefit, provide representative mobile evidence,
wire the product canvas to WASM, approve license distribution, complete a
feature-flag/rollback rollout, or close F3. TypeScript remains the default and
fallback. A reference change deliberately reruns the comparison; do not loosen
tolerances or copy old answers just to restore green.
