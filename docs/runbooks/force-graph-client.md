# KnowledgeGraph layout client

## Default and rollback

`KnowledgeGraph` uses `createForceGraphLayoutClient()` by default. That client
creates the existing TypeScript worker. No Rust/WASM binary, environment flag,
remote URL or new provider is activated by this change.

An explicitly supplied `layoutClient` prop is the opt-in seam. Removing it (or
constructing a client with `wasmEnabled: false`) restores the TypeScript route.
A configured WASM client requires BOTH `wasmEnabled: true` and a trusted
`createWasmWorker` factory. Shipping and enabling that factory/module is a
separate adoption gate, not an implicit effect of this bridge.

## Ownership and cancellation

Each precompute request owns one Worker. A graph change, dimension change or
unmount aborts the request and terminates its worker. Already-aborted work does
not allocate a Worker. The client accepts only one active request per instance;
additional requests reject with `layout_busy`. There is no global pool or queue.
Abort releases the slot synchronously so React effect cleanup can immediately
start the replacement request without waiting for an old promise's microtask.
A completion from an obsolete request must never seed the new graph.

The component preserves the renderer's inline simulation if precompute fails,
and does not overwrite coordinates already set by the renderer. It logs a
fixed warning rather than worker error details. This is layout only: no graph
membership, risk meaning, authorization, persistence or safety decision changes.

## Fallback and compatibility

An eligible, opted-in WASM attempt gets a 2-second default deadline; failure,
invalid output or timeout terminates that worker before trying TypeScript once.
TypeScript gets a 10-second default deadline. An abort never starts fallback.
A second failure rejects, leaving the renderer's inline simulation in place.
Deadline overrides must be finite, positive and at most 30 seconds.

Only the experimental path is bounded to 10,000 nodes, 50,000 links, 600 integer
ticks, 1024-character node IDs, finite seed coordinates within absolute 1e9 and
2 MiB serialized payload. Payloads outside those experimental limits still use
TypeScript with the same full node/link set: they are not truncated or silently
dropped. Inputs are snapshotted before dispatch. The worker retains its existing
iteration normalization and dangling-link behavior.

Responses are validated for exact node count/order/IDs, finite XY and dimension
shape before seeding. Worker exceptions and explicit error messages become fixed
codes; raw messages do not enter the result or the UI warning.

## Verification

```text
npm run test:ci -- src/components/shared/KnowledgeGraph.layout.test.tsx src/workers/forceGraphClient.test.ts src/workers/forceGraphWorker.test.ts src/pages/RiskNetwork.test.tsx --detectAsyncLeaks
npm run verify:fresh
npm run build
```

The component regression reproduced a real prior bug: the previous worker was
reused on graph changes, so a response for the old graph could reach the next
listener. The lifecycle regression failed before the fix. Renderer mocking in
that test isolates React orchestration; it is not evidence of GPU rendering or
mobile performance.

A separate Chromium probe compiled the actual product client and worker, then
exercised TypeScript default, real experimental WASM parity, missing module,
malformed response, timeout, abort, backpressure and an untruncated 10,001-node
legacy graph. Its temporary server/harness/results stay outside the repository
under the dated force-graph Rust laboratory. This browser probe uses injected
factories and does not substitute for a built-app E2E or Android/OEM validation.

## Remaining adoption gates

Reproducible WASM source/build/asset distribution and license audit; hard module
memory bound; consumer/canvas E2E under deployed CSP and bundling; independent
review; operational flag/rollback and representative mobile/browser measurements.
Do not call this bridge a Rust rollout or a production-readiness certificate.
