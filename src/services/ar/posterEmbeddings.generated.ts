// SPDX-License-Identifier: MIT
//
// Poster Embeddings — pre-computados offline vía `scripts/seed-poster-embeddings.ts`.
//
// Esto es un archivo "generated" (aunque editable a mano si necesario).
// Empieza como objeto vacío y se llena cuando el equipo de contenidos
// corre el seed script una vez que las imágenes de referencia están
// listas en `public/posters/`.
//
// El runtime hace merge de estos embeddings sobre los `PosterDefinition`
// del catálogo seed (ver `posterCatalog.ts:mergeEmbeddingsIntoCatalog`).
//
// IMPORTANTE: este archivo NO contiene secretos — los embeddings son
// vectores numéricos no-invertibles. Es seguro commitearlo al repo.
//
// Formato:
//   {
//     [posterId]: number[] // típicamente 1024 floats (MobileNetV3 small)
//   }

export const POSTER_EMBEDDINGS: Readonly<Record<string, readonly number[]>> = {
  // Empty by design. Run `scripts/seed-poster-embeddings.ts` para
  // poblarlo una vez que los assets en public/posters/ estén firmados
  // por el equipo de seguridad.
};
