# Seed Poster Embeddings — runbook

The AR Poster Scanner (`src/components/ar/ARPosterScanner.tsx`) compares
camera frames against pre-computed embeddings of each safety poster. This
runbook describes how to generate those embeddings.

## Why offline seeding?

The runtime matcher (`src/services/ar/posterMatcher.ts`) uses the same
MediaPipe `ImageEmbedder` model whether we're embedding a poster
*reference* image or a *camera frame*. The model is deterministic — given
the same input it produces the same output. By computing reference
embeddings ONCE offline:

1. We avoid downloading the reference JPEGs to every device that runs the
   scanner (~2-5 MB per poster × N posters = real bandwidth on faena
   networks).
2. The scanner can match against the full catalog with zero extra HTTP
   requests.
3. The reference embeddings are tiny (1024 floats ≈ 4 KB per poster
   serialized).

## Prerequisites

1. Reference JPEGs in `public/posters/<poster_id>.jpg` (see
   `public/posters/README.md` for spec).
2. MediaPipe model present at
   `public/models/mediapipe/embedder/mobilenet_v3_small.tflite` OR fall
   back to the Google Storage CDN URL.

## Running

Two flows are supported — pick the one that matches your environment.

### A) Browser flow (recommended for the first seed)

This uses the same browser-side MediaPipe code path as the runtime. No
Node-side ML deps needed.

1. Start the dev server: `npm run dev`
2. Open `/dev/poster-seeder` (gated to admin in production; in dev opens
   directly).
3. Click **Generate embeddings**. The page iterates `POSTER_CATALOG_RAW`,
   loads each `referenceImageUrl`, runs the embedder, and emits a JSON
   blob.
4. Download the blob → it's the new `posterEmbeddings.generated.ts`
   contents.
5. Replace `src/services/ar/posterEmbeddings.generated.ts` and commit.

> **NOTE:** `/dev/poster-seeder` is not yet implemented — track in
> `dev/ar-poster-seeder` follow-up. Until then, use flow B.

### B) Node flow (CI-friendly)

Uses `@tensorflow/tfjs-node` + the MobileNetV3 small SavedModel
(equivalent feature extractor — embeddings are not bit-identical to
MediaPipe's but cosine similarity ranks similarly enough for the 0.85
threshold to hold).

```bash
# One-time install
npm install --no-save @tensorflow/tfjs-node @tensorflow-models/mobilenet sharp

# Generate
node scripts/seed-poster-embeddings.mjs

# Output: src/services/ar/posterEmbeddings.generated.ts (overwritten)
```

> **NOTE:** `scripts/seed-poster-embeddings.mjs` is not yet committed —
> the script depends on the deciding which feature extractor to use
> (MediaPipe-Node bindings have a different surface than the browser
> tasks-vision package). Track in `dev/ar-poster-seeder` follow-up.

## Verification

After regenerating the embeddings:

```bash
# Catalog should report N matchable posters where N = number of seeded entries
npx vitest run src/services/ar/posterCatalog.test.ts
```

The scanner UI shows `N/M afiches matcheables` in the header. When N = M,
all posters in the catalog will trigger animations.

## Rotation policy

Re-seed when:

- A poster image changes (new design, layout update)
- The MediaPipe model version updates (`mobilenet_v3_small` → newer)
- The l2_normalize / quantize options change in the embedder config

The runtime cosine similarity threshold (`0.85` default) should not
require re-seeding — it just adjusts how strict the matcher is.
