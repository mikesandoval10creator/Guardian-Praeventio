# Mesh file MIME preservation

## Scope

`MeshRequestRouter` must carry the responder's local `Blob.type` through
`FileChunkPayload` and reconstruct the same bytes with the usable MIME.
`FileRequestPayload.mimeType` is an optional hint, not authority for the response.
This is an optional metadata extension; packet version, chunk size, priorities,
TTL, SOS handlers, signing and hash algorithms are unchanged.

Only the explicit passive preview allowlist is promoted. HTML, SVG, malformed,
empty, overly long and unknown declarations keep the existing
`application/octet-stream` download behavior. MIME is metadata, **not** byte
format validation, malware scanning or a new trust/authentication mechanism.

Legacy chunks without the field remain valid, including mixed legacy/modern
streams. Missing metadata never erases an explicit declaration. Contradictory
explicit declarations are ignored before their bytes are inserted. A failed byte
hash resets MIME alongside the existing hash/chunk state, permitting a clean
retry. Late duplicates still complete only once.

## Reproduction and automated coverage

Before the fix, a real sender/router/receiver test reconstructed a PDF fixture
with correct bytes but reported `application/octet-stream` instead of
`application/pdf` (named assertion failure, exit 1).

```sh
node node_modules/vite-plus/bin/vp test run --maxWorkers=2 src/services/mesh
node node_modules/eslint/bin/eslint.js src/services/mesh/meshPacket.ts src/services/mesh/meshRequestRouter.ts src/services/mesh/meshRequestRouter.mime.test.ts
```

The MIME tests use real chunking, SHA-256, reconstruction and JSON boundaries;
no chunker/hash/reconstructor mocks. They cover passive types, a misleading
request hint, absent legacy fields, mixed peers, active/invalid metadata,
conflicts/retries, hash-rejection reset, duplicate completion and HMAC coverage
of the new field. Media-typed byte fixtures test metadata transport, not a media
decoder for every declared format.

Node 24.22.1 / Vite+ 5.1.0 can report native `BLOBREADER` sites after the
suite even with exit 0; the observed count varies with GC timing. These warnings
are retained, not disabled or labeled zero leaks. A separate native async-hooks
probe observed one reader before GC
and zero after GC. There is no public Blob-reader close operation; this slice
does not replace Blob, force GC in production or change runner leak detection.

## Native browser evidence and limits

An isolated bundle of the production router, queue, chunker and hash functions
ran in Chrome 157.0.8103.78 on localhost:

- Real 70-byte PNG: `image/png`, identical SHA-256, one completion; the browser
  decoded the reconstructed object URL to a 1×1 image.
- Synthetic valid 431-byte PDF: `application/pdf`, identical SHA-256 and one
  completion. Native PDF viewer rendering was **not** asserted.
- Legacy PDF stream: `application/octet-stream`, identical bytes and one
  completion.
- No page errors or non-local requests; browser and HTTP server were closed.

This is a native-browser **module integration** probe, not full Guardian E2E or
physical BLE/Wi-Fi delivery. The existing `MeshProvider` file callbacks remain
placeholders (`localFileLookup` returns null; `onFileComplete` is empty); this
change does not claim that the full app's file-transfer/preview feature is wired.
Authentication, tenant rules, provisioning, native MTU and device/background
behavior require their own existing integration/device gates. No operational
SOS, production data or external service was activated.

A local TypeScript check using the actual project compiler options and the
changed roots/ambient declarations is scoped evidence only. Full project
Typecheck, Build, all applicable checks and Stryker core on the final SHA are
mandatory before merge.
