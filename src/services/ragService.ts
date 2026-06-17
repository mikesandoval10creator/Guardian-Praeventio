import { GoogleGenAI } from "@google/genai";
import { fetchLawFromBCN, CRITICAL_LAWS } from "./bcnService.js";
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from '../utils/logger';
import { AI_MODEL_EMBEDDINGS } from '../config/aiModels.js';
import { MIN_SIMILARITY } from './rag/safeNormativeQuery.js';
import * as Sentry from '@sentry/core';

interface VectorDocument {
  id: string;
  title: string;
  content: string;
  embedding: number[];
}

let isInitialized = false;

const API_KEY = process.env.GEMINI_API_KEY;

const METADATA_PATH = '_metadata/rag_status';

/**
 * Checks if the RAG system is already initialized for a specific collection or global context.
 */
const getRagStatus = async (db: admin.firestore.Firestore, normativeId: string = 'global') => {
  const doc = await db.doc(`_metadata/rag_status_${normativeId}`).get();
  return doc.exists ? doc.data() : null;
};

const setRagStatus = async (db: admin.firestore.Firestore, normativeId: string = 'global', data: any) => {
  await db.doc(`_metadata/rag_status_${normativeId}`).set({
    ...data,
    updatedAt: FieldValue.serverTimestamp()
  });
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withExponentialBackoff = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> => {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      if (retries >= maxRetries || (error.status !== 429 && error.status !== 503)) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, retries);
      logger.warn(`Rate limited in RAG. Retrying in ${delay}ms... (Attempt ${retries + 1}/${maxRetries})`);
      await sleep(delay);
      retries++;
    }
  }
};

/**
 * Generates an embedding vector for a given text using Gemini's embedding model.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await withExponentialBackoff(() => 
    ai.models.embedContent({
      model: AI_MODEL_EMBEDDINGS,
      contents: text,
    })
  );
  
  return response.embeddings?.[0]?.values || [];
};

/**
 * Indexes a law into the vector store.
 */
export const indexLaw = async (law: any, vectorCollection: admin.firestore.CollectionReference) => {
  logger.debug(`Indexing law: ${law.titulo || law.idNorma}...`);
  if (!law.texto) return;

  // Chunk the text (~1000 chars per chunk)
  const chunks = law.texto.match(/.{1,1000}(\s|$)/g) || [];
  
  // Process in batches
  const batchSize = 5;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await Promise.all(batch.map(async (chunk: string, batchIndex: number) => {
      const actualIndex = i + batchIndex;
      const docId = `law-${law.idNorma}-chunk-${actualIndex}`;
      
      try {
        const embeddingArray = await generateEmbedding(chunk);
        const docData = {
          id: docId,
          lawId: law.idNorma,
          title: law.titulo,
          content: chunk.trim(),
          embedding: FieldValue.vector(embeddingArray),
          indexedAt: FieldValue.serverTimestamp()
        };
        
        await vectorCollection.doc(docId).set(docData);
      } catch (e) {
        logger.error(`Failed to embed chunk ${actualIndex} of law ${law.idNorma}`, e);
      }
    }));
    await sleep(1000);
  }
};

/**
 * Downloads and indexes a specific normative on demand.
 * Enforces a 6-month update rule.
 */
export const downloadSpecificNormative = async (normativeId: string, force: boolean = false) => {
  if (!admin.apps.length) return undefined;
  const db = admin.firestore();
  const vectorCollection = db.collection('vector_store');

  const status = await getRagStatus(db, normativeId);
  const now = Date.now();
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;

  if (!force && status && status.initialized) {
    const lastUpdate = status.updatedAt?.toDate()?.getTime() || 0;
    if (now - lastUpdate < sixMonthsMs) {
      logger.debug(`Normative ${normativeId} is up to date.`);
      return { success: true, message: "Normativa actualizada." };
    }
  }

  logger.debug(`Downloading normative ${normativeId} from BCN...`);
  const law = await fetchLawFromBCN(normativeId);
  if (law) {
    await indexLaw(law, vectorCollection);
    await setRagStatus(db, normativeId, { initialized: true });
    return { success: true, message: `Normativa ${normativeId} descargada e indexada comercialmente.` };
  }
  
  return { success: false, error: "No se pudo descargar la normativa." };
};

/**
 * Initializes the RAG system by fetching critical laws from BCN if not already indexed.
 */
export const initializeRAG = async () => {
  if (isInitialized) return;
  if (!admin.apps.length) return;
  // Sprint 28 (CI fix) — without GEMINI_API_KEY embedding throws; in CI
  // smoke we don't have the secret. Skip cleanly so logs stay readable.
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('initializeRAG skipped — GEMINI_API_KEY not configured.');
    return;
  }

  const db = admin.firestore();
  const vectorCollection = db.collection('vector_store');

  try {
    const status = await getRagStatus(db, 'global');
    if (status && status.initialized) {
      logger.debug("RAG System global context already initialized in Firestore.");
      isInitialized = true;
      return;
    }

    logger.debug("Global RAG context not found. Executing seed...");
    for (const criticalLaw of CRITICAL_LAWS) {
      await downloadSpecificNormative(criticalLaw.id);
    }
    
    await setRagStatus(db, 'global', { initialized: true });
    isInitialized = true;
    logger.debug(`Global RAG context initialized.`);
  } catch (error) {
    logger.error("Error initializing RAG system:", error);
  }
};

/**
 * Searches the vector database for the most relevant context given a query.
 *
 * Delegates to the no-hallucination guardrail `safeNormativeQuery`
 * (`src/services/rag/safeNormativeQuery.ts`, TODO.md §12.2.3) instead of
 * returning a hardcoded "Ley 16.744 ..." string. For a risk-prevention app
 * the SLM/Gemini must NEVER be handed invented legal text it can then cite
 * as authority. `safeNormativeQuery`:
 *   - applies a COSINE similarity threshold (MIN_SIMILARITY = 0.75); a best
 *     score below that yields a canonical "no tengo información verificada"
 *     message rather than low-confidence text;
 *   - returns a canonical "RAG no disponible" message when the system is not
 *     initialized — NOT a hardcoded legal snippet the model could embellish.
 *
 * The returned string is always safe to inject into a downstream LLM prompt:
 * on a verified hit it's the real `[Fuente: ...]` snippet, otherwise it's the
 * canonical user-facing message (which explicitly tells the model not to
 * fabricate). The `safeNormativeQuery` module is imported lazily to avoid a
 * static import cycle (it dynamically imports `generateEmbedding` from this
 * very module) and to keep the cold-start path clean.
 */
export const searchRelevantContext = async (query: string, topK: number = 3): Promise<string> => {
  try {
    const { safeNormativeContextOrFallback } = await import('./rag/safeNormativeQuery.js');
    const { injectable } = await safeNormativeContextOrFallback(query, topK);
    return injectable;
  } catch (error) {
    logger.error("Error searching context:", error);
    // Fail safe: a canonical no-verified-context message, never invented law.
    return (
      `No tengo información verificada sobre "${query}" en mi base normativa ` +
      `en este momento. Consulta leychile.cl o un asesor jurídico calificado. ` +
      `No generaré texto normativo desde cero.`
    );
  }
};

/** Server-only AI-answer cache for queryCommunityKnowledge — see the rule
 *  `match /community_knowledge_cache` (read,write: if false). This is NOT the
 *  public `community_glossary` (curated terms, anonymously readable). */
const COMMUNITY_CACHE_COLLECTION = 'community_knowledge_cache';

/**
 * Interceptor for AI generation requests — an industry-scoped cache of generic
 * normative answers, keyed by embedding similarity.
 *
 * PRIVACY (disconnection hunt #2/#3, 2026-06-16): this previously read AND wrote
 * the PUBLIC, anonymously-readable `community_glossary` (firestore.rules
 * `read: if true`, consumed client-side by UniversalKnowledgeContext) and
 * persisted the raw `prompt` — which interpolates the worker's free-text IPERC
 * risk description (gemini/risk.ts). So any tenant, or any anonymous client, in
 * the same industry could read another tenant's operational free-text. Two fixes:
 *   1. Cache lives in the SERVER-ONLY `community_knowledge_cache` (no client/
 *      anonymous read path) and the raw `prompt` is NO LONGER stored — only the
 *      embedding (for similarity) + the generic response + industry are kept.
 *   2. Score-gate (#3, mirrors safeNormativeQuery #930): the nearest neighbour
 *      is returned ONLY when its COSINE similarity ≥ MIN_SIMILARITY; otherwise a
 *      semantically unrelated cached answer could be served as authoritative in
 *      a life-safety IPERC context. The positional findNearest form does not
 *      expose the distance, so we use the object form with distanceResultField.
 */
export const queryCommunityKnowledge = async (
  prompt: string,
  industry: string,
  geminiFallback: () => Promise<string>,
): Promise<string> => {
  if (!admin.apps.length) {
    return await geminiFallback();
  }

  const db = admin.firestore();
  const cacheCollection = db.collection(COMMUNITY_CACHE_COLLECTION);

  try {
    const queryEmbedding = await generateEmbedding(prompt);

    // Nearest cached answer in the same industry, WITH its real similarity score.
    const results = await cacheCollection
      .where('industry', '==', industry)
      .findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(queryEmbedding),
        limit: 1,
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance',
      })
      .get();

    if (!results.empty) {
      const top = results.docs[0].data();
      // COSINE distance in [0,2] (0 == identical); similarity = 1 - distance/2.
      const distance = typeof top.distance === 'number' ? top.distance : 2;
      const score = Math.max(0, Math.min(1, 1 - distance / 2));
      if (score >= MIN_SIMILARITY) {
        logger.debug(
          `[RAG Interceptor] Cache hit (score ${score.toFixed(3)}) for industry: ${industry}`,
        );
        return top.response;
      }
      logger.debug(
        `[RAG Interceptor] Nearest cached answer below threshold ` +
          `(score ${score.toFixed(3)} < ${MIN_SIMILARITY}) for industry: ${industry}; regenerating.`,
      );
    } else {
      logger.debug(`[RAG Interceptor] Cache miss for industry: ${industry}. Calling Gemini...`);
    }

    // Generate fresh, then cache. We deliberately do NOT persist the raw
    // `prompt` (worker free-text PII) — only the embedding + generic response.
    const aiResponse = await geminiFallback();
    await cacheCollection.add({
      response: aiResponse,
      industry,
      embedding: FieldValue.vector(queryEmbedding),
      createdAt: FieldValue.serverTimestamp(),
    });

    return aiResponse;
  } catch (error) {
    // Fail-soft to Gemini, but make the failure DISCOVERABLE: the most likely
    // cause is a missing Firestore composite vector index for
    // community_knowledge_cache, which would silently bypass the cache on every
    // call (Gemini hit every time) with no user-facing error. Surface it in
    // Sentry so ops can create the index instead of paying for it invisibly.
    logger.error('[RAG Interceptor] Error:', error);
    Sentry.captureException(error, { tags: { area: 'rag.communityKnowledgeCache' } });
    return await geminiFallback();
  }
};
