# Safety Poster Reference Images

This directory hosts the **reference images** used by the AR Poster Scanner
(`src/components/ar/ARPosterScanner.tsx`) to match camera frames against
known safety posters.

## Spec

- **Format:** JPEG (`.jpg`), quality ≥ 85
- **Size:** 1024×1024 px square recommended (matches MediaPipe ImageEmbedder
  input). Wider/taller is fine — the model will center-crop.
- **Lighting:** flat, even lighting. Avoid harsh shadows and glare. This is
  the **canonical** image; the camera-side embedder normalizes for ambient
  variation up to ~0.85 cosine similarity threshold.
- **Background:** match the printed poster (no need for a clean white
  background — the embedder considers the full image).

## Naming

Match the `id` from `src/services/ar/posterCatalog.ts:POSTER_CATALOG_RAW`:

| Poster ID                     | Filename                          |
| ----------------------------- | --------------------------------- |
| `epp_arnes_altura`            | `epp_arnes_altura.jpg`            |
| `extintor_pqs_uso`            | `extintor_pqs_uso.jpg`            |
| `loto_bloqueo_etiquetado`     | `loto_bloqueo_etiquetado.jpg`     |
| `manejo_manual_cargas`        | `manejo_manual_cargas.jpg`        |
| `evacuacion_incendio`         | `evacuacion_incendio.jpg`         |
| `espacio_confinado_entrada`   | `espacio_confinado_entrada.jpg`   |
| `reglas_cardinales`           | `reglas_cardinales.jpg`           |
| `hazmat_derrame_quimico`      | `hazmat_derrame_quimico.jpg`      |

## Seeding Embeddings

Once images are in place, run the embedding seed script to populate
`src/services/ar/posterEmbeddings.generated.ts`:

```bash
npm run seed:posters
```

This converts each `.jpg` to a 1024-float embedding via MediaPipe
ImageEmbedder and writes the result to the generated module. After running,
commit both the images and the generated file.

The runtime catalog (`POSTER_CATALOG_SEED`) automatically merges these
embeddings — no further changes needed for the scanner to start matching.

## License

Images placed here must be created in-house by the Praeventio safety
design team OR licensed CC-BY / public domain. **Do not** place
copyrighted poster templates without explicit license, even if they look
"standard."
