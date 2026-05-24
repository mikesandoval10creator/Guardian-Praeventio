# Pre-packaged SLM models

This directory holds the SLM binaries that ship **inside the app bundle**
so the runtime works without ever touching HuggingFace.

When a model descriptor in `src/services/slm/registry.ts` declares a
`prePackagedPath`, the runtime fetches that same-origin path FIRST,
before any cache lookup or HuggingFace download. The file must:

1. Live at the exact path declared in the registry.
2. Match the `expectedSha256` declared in the registry.
3. For split-bundle models (Phi-3), companion files live in the SAME
   directory addressed by their relative `filename` basename.

## Release pipeline checklist

Per model with `prePackagedPath` set:

```bash
# 1. Download from HuggingFace
curl -L "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx" \
  -o public/models/qwen-2.5-0.5b/model_q4f16.onnx

# 2. Verify the SHA-256 matches the registry
sha256sum public/models/qwen-2.5-0.5b/model_q4f16.onnx
# Expected: b11c1dd99efd57e6c6e5bc4443a019931a5fbd5dd500d48644d8225f5ce0b2cb

# 3. Commit
git add public/models/qwen-2.5-0.5b/
git commit -m "feat(release): pre-package Qwen 2.5 0.5B SLM (483 MB)"
```

## Size budget

| Model | Size | Suitable for |
|-------|------|--------------|
| Qwen 2.5 0.5B (q4f16) | 483 MB | Android Asset Pack (Play Asset Delivery, install-time) + iOS asset catalog |
| Phi-3 mini (q4 split) | 2.72 GB | NOT bundle-friendly — keep as HF download path |
| Gemma 2 2B (gated) | 1.4 GB | NOT bundle-friendly + gated license |
| MiDaS-small (depth ML) | ~30 MB | **Bundle-friendly** — drop at `public/models/midas/midas-small.onnx` |

## MiDaS depth estimator (§Fase D.1)

The Digital Twin pipeline (`src/services/digitalTwin/onDeviceReconstruction/`)
automatically upgrades from heuristic depth (brightness/edge) to **real
monocular depth ML inference** when the MiDaS ONNX model is present.

```bash
# Drop the model here:
mkdir -p public/models/midas
curl -L "https://huggingface.co/Intel/dpt-hybrid-midas/resolve/main/onnx/model.onnx" \
  -o public/models/midas/midas-small.onnx
```

When the file is missing, `tryCreateMidasEstimator()` returns `null` and
the pipeline degrades gracefully to the brightness/edge heuristic. No
runtime error — the Digital Twin still works, just with lower-quality
depth structure. This means dev environments without the model file ship
fine; only production builds need the file copied at release time.

## Why not commit the binary to git?

The `.onnx` files are LFS-tracked or excluded via `.gitignore`. They get
copied at CI release time from a verified mirror. Committing 483 MB to
git would bloat the repo and force every dev to clone hundreds of MB
they don't need for unrelated work.

In dev mode the file is absent → the runtime falls back to HuggingFace
(or the IndexedDB cache from a previous launch). Production builds run
a release-step that fetches + verifies + drops the binary here before
`npm run build`.

## Workbox precache

The service worker should be configured to precache `/models/**/*.onnx`
+ `/models/**/*.onnx_data` so the very first launch caches them locally
without re-fetching on each navigation. See `vite.config.ts` PWA plugin
config.
