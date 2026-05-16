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

### A) Browser flow (recommended)

This uses the same browser-side MediaPipe code path as the runtime — embeddings
generated here are bit-identical to those the scanner computes at runtime, so
cosine similarity behavior is consistent.

1. Place reference JPEGs in `public/posters/` (see
   `public/posters/README.md` for spec).
2. Start the dev server: `npm run dev`
3. Open **`/dev/poster-seeder`** (gated by `PremiumFeatureGuard` — admin
   role required in prod).
4. Click **Generar embeddings**. The page iterates
   `POSTER_CATALOG_SEED`, loads each `referenceImageUrl`, runs the
   `ImageEmbedder` (MobileNetV3 small + `l2Normalize=true`), shows
   progress + a sanity check (cosine self-similarity should be very
   close to 1.0 for each successful poster).
5. Click **Descargar .ts** → downloads the new contents of
   `posterEmbeddings.generated.ts`.
6. Replace `src/services/ar/posterEmbeddings.generated.ts` in the repo
   with the downloaded file.
7. Commit + push. Next deploy, the scanner header will report
   `N/N afiches matcheables`.

**Implementation**: see `src/pages/DevPosterSeeder.tsx` + the route in
`src/routes/OperationsRoutes.tsx`. Zero additional deps — reuses the
matcher singleton from runtime, so the script and the app share the
same model and produce bit-identical embeddings.

### B) Node flow (CI-friendly) — DEFERRED

Uses `@tensorflow/tfjs-node` + the MobileNetV3 small SavedModel as
feature extractor.

**Status**: NOT implemented yet. Browser flow (A) is sufficient for
the current seed workflow (one-time + manual on poster update); a Node
flow would only help if we wanted to seed in CI on every poster JPG
change without operator interaction. Track in a future PR when there
is real demand.

**If implemented**, the Node flow would NOT produce bit-identical
embeddings to the MediaPipe browser path — TFJS-Node and MediaPipe
tasks-vision use slightly different feature extractors. The threshold
0.85 should still hold (similarity ranking is preserved) but the
absolute values won't match the browser-seed. Mixing browser-seeded
posters with node-seeded posters in the same catalog is therefore
discouraged.

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
