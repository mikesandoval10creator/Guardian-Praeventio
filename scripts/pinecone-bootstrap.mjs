#!/usr/bin/env node
/**
 * pinecone-bootstrap.mjs — Bucket PP.5 (Sprint 25 gaps cleanup).
 *
 * One-time setup del índice Pinecone para RAG normativo. Uso:
 *
 *   PINECONE_API_KEY=pcsk_xxx GEMINI_API_KEY=AIza... \
 *     node scripts/pinecone-bootstrap.mjs
 *
 * Pasos:
 *   1. Crea (idempotente) el índice `praeventio-normativa` —
 *      dimension=768 (Gemini text-embedding-004), metric=cosine,
 *      serverless en aws/us-east-1 (free starter tier hasta 1M vectores).
 *   2. Espera a que el índice quede ready.
 *   3. Para cada chunk curado en CL_PACK (src/data/normativa/cl.ts):
 *        a) Genera embedding con Gemini text-embedding-004.
 *        b) Upsert al índice con id=`<country>-<regulation.id>` y
 *           metadata { country, title, reference, scope, url }.
 *   4. Imprime estadísticas finales del índice.
 *
 * Por qué Pinecone:
 *   - Vector search en hardware limitado del cliente (móviles/PC viejos)
 *     es prohibitivo. Pinecone serverless da 5x speed sin ops.
 *   - El tier starter es gratis hasta 1M vectores; CL+AR+BR+CO+MX+PE+ISO
 *     curated chunks suman ~50, deja headroom para LLM-synth (192 nodos).
 *   - El RAG fallback in-memory existente queda como fallback degradado
 *     cuando PINECONE_API_KEY no está configurada.
 *
 * Importante:
 *   - El Zettelkasten interno NUNCA se ingiere (decisión B2D API model).
 *   - Solo se suben los CL_PACK chunks curados públicos + LLM-synth.
 */

import { GoogleGenAI } from '@google/genai';

const INDEX_NAME = 'praeventio-normativa';
const EMBEDDING_DIM = 768; // Gemini text-embedding-004
const EMBEDDING_MODEL = 'text-embedding-004';
const PINECONE_REGION = { cloud: 'aws', region: 'us-east-1' };

async function loadPineconeSdk() {
  try {
    const mod = await import('@pinecone-database/pinecone');
    return mod.Pinecone;
  } catch {
    console.error(
      '[pinecone] @pinecone-database/pinecone no está instalado.\n' +
        '  Instalar: npm install @pinecone-database/pinecone',
    );
    process.exit(1);
  }
}

async function loadCountryPacks() {
  // Importamos los packs ya transpilados o crudos. Como el script corre
  // en Node sin TS, usamos `tsx` si está disponible. Para no agregar
  // una dep, replicamos la lista mínima de chunks acá: el .ts solo
  // exporta data plana sin TypeScript-only constructs en runtime.
  // Estrategia: spawn `tsx` si existe; sino, parseamos el .ts crudo.
  try {
    const { tsImport } = await import('tsx/esm/api');
    const mod = await tsImport('../src/data/normativa/cl.ts', import.meta.url);
    return [{ country: 'CL', pack: mod.CL_PACK }];
  } catch (err) {
    console.error(
      '[pinecone] No se pudo cargar src/data/normativa/cl.ts vía tsx.\n' +
        `  Error: ${err.message}\n` +
        '  Instalá `tsx` (ya está en devDependencies) y reintentá.',
    );
    process.exit(1);
  }
}

function chunksFromPack(country, pack) {
  return pack.regulations.map((reg) => ({
    id: `${country}-${reg.id}`,
    text: [
      reg.title,
      reg.reference,
      reg.scope,
    ].filter(Boolean).join('\n\n'),
    metadata: {
      country,
      title: reg.title,
      reference: reg.reference,
      scope: reg.scope,
      url: reg.url ?? '',
    },
  }));
}

async function embed(ai, text) {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  const vec = res.embeddings?.[0]?.values;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    throw new Error(
      `[pinecone] embedding shape inesperada: got ${vec?.length}, expected ${EMBEDDING_DIM}`,
    );
  }
  return vec;
}

async function ensureIndex(pc) {
  const list = await pc.listIndexes();
  const existing = list.indexes?.find((i) => i.name === INDEX_NAME);
  if (existing) {
    console.log(`[pinecone] índice ${INDEX_NAME} ya existe (status=${existing.status?.state}).`);
    return;
  }
  console.log(`[pinecone] creando índice ${INDEX_NAME} (dim=${EMBEDDING_DIM}, metric=cosine)…`);
  await pc.createIndex({
    name: INDEX_NAME,
    dimension: EMBEDDING_DIM,
    metric: 'cosine',
    spec: { serverless: PINECONE_REGION },
    waitUntilReady: true,
  });
  console.log(`[pinecone] índice ${INDEX_NAME} listo.`);
}

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[pinecone] Falta PINECONE_API_KEY en el entorno.');
    process.exit(2);
  }
  if (!geminiKey) {
    console.error('[pinecone] Falta GEMINI_API_KEY en el entorno (necesario para embeddings).');
    process.exit(2);
  }

  const Pinecone = await loadPineconeSdk();
  const pc = new Pinecone({ apiKey });

  await ensureIndex(pc);

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const packs = await loadCountryPacks();

  const allChunks = [];
  for (const { country, pack } of packs) {
    allChunks.push(...chunksFromPack(country, pack));
  }
  console.log(`[pinecone] ingesting ${allChunks.length} chunks…`);

  const index = pc.index(INDEX_NAME);
  const BATCH = 16;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const slice = allChunks.slice(i, i + BATCH);
    const vectors = [];
    for (const c of slice) {
      const values = await embed(ai, c.text);
      vectors.push({ id: c.id, values, metadata: c.metadata });
      process.stdout.write(`\r[pinecone] embed ${i + vectors.length}/${allChunks.length}   `);
    }
    await index.upsert(vectors);
  }
  process.stdout.write('\n');

  const stats = await index.describeIndexStats();
  console.log('[pinecone] stats post-ingest:', JSON.stringify(stats, null, 2));
  console.log('[pinecone] OK — bootstrap completado.');
}

main().catch((err) => {
  console.error('[pinecone] ERROR:', err.message ?? err);
  process.exit(1);
});
