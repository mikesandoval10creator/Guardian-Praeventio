# Gaussian splat validation (Rust/WASM)

First slice of the Digital Twin ingestion ticket. **Not loaded by the application.** No Firebase, network, or renderer integration. `validationWorker.ts` handles one capture off the UI thread: the caller supplies a trusted compiled module and transfers the input buffer; a successful reply transfers the validated bytes back. The caller owns cancellation and worker termination. Node tests exercise this entrypoint in a separate thread with a Web Worker API adapter; they do not certify the deployed browser or CSP.

Accepts one raw little-endian `.splat` layout: 32 bytes per record (position XYZ and linear scales XYZ as six float32s, four RGBA bytes, four WXYZ rotation bytes centered at 128). Layout reference: [raw splat converter](https://github.com/antimatter15/splat/blob/main/convert.py); no third-party source copied and no Cargo dependencies. This is structural validation of the selected layout, not file provenance or authorization. PLY, compressed formats and scene reconstruction are out of scope.

The TypeScript bridge consumes a trusted, compiled module. The host copies bytes into a single borrowed buffer and gets a record count or a typed rejection. Oversized input is rejected before allocating or copying. The 4 MiB input cap is a conservative first-slice limit (131,072 records), not a measured mobile budget. The VM hard ceiling is 16 MiB. The Rust module imports no host capabilities. Worker termination, capped streaming downloads, authorized object retrieval, and actual rendering remain downstream responsibilities. Never fetch or render an artifact on the strength of this validator alone.

From this directory, with Node 24 and the pinned Rust toolchain:

```sh
cargo fmt --check
cargo clippy --target wasm32-unknown-unknown --locked --offline -- -D warnings
cargo build --release --target wasm32-unknown-unknown --locked --offline
node --test tests/*.test.mjs
```

The synthetic fixture is constructed from explicit fields by the tests. The `.wasm` lives under ignored `target/`, not in the application bundle. A future opt-in consumer must prove authorization, valid geometry on-screen, stale-request cancellation, CSP and rollback before activation.

## Local Chromium regression

After building the WASM as above, run from the repository root:

```sh
npm ci
npx playwright install chromium
NODE_ENV=production node wasm/gaussian-splat/tests/browser/run.mjs
```

The isolated Vite build exercises the default module worker and preparation pipeline in Chromium. A loopback Express server runs the application's CSP middleware in production mode and serves both the bundle and the build's WASM. The test checks that rejected bytes leave the canvas unchanged, accepted bytes render, and removing the splat restores the original canvas. This is a manual regression test, not the Guardian app bundle, a deployed CSP check, or evidence of authenticated capture access.
