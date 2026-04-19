import { GoogleGenAI } from "@google/genai";
import { fetchLawFromBCN, CRITICAL_LAWS } from "./bcnService.js";
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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
      console.warn(`Rate limited in RAG. Retrying in ${delay}ms... (Attempt ${retries + 1}/${maxRetries})`);
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
      model: "text-embedding-004",
      contents: text,
    })
  );
  
  return response.embeddings?.[0]?.values || [];
};

/**
 * Indexes a law into the vector store.
 */
export const indexLaw = async (law: any, vectorCollection: admin.firestore.CollectionReference) => {
  console.log(`Indexing law: ${law.titulo || law.idNorma}...`);
  if (!law.texto) return;

  // Chunk the text (~1000 chars per chunk)
  const chunks = law.texto.match(/.{1,1000}(\s|$)/g) || [];
  
  // Process in batches
  const batchSize = 5;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await Promise.all(batch.map(async (chunk, batchIndex) => {
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
        console.error(`Failed to embed chunk ${actualIndex} of law ${law.idNorma}`, e);
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
  if (!admin.apps.length) return;
  const db = admin.firestore();
  const vectorCollection = db.collection('vector_store');

  const status = await getRagStatus(db, normativeId);
  const now = Date.now();
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;

  if (!force && status && status.initialized) {
    const lastUpdate = status.updatedAt?.toDate()?.getTime() || 0;
    if (now - lastUpdate < sixMonthsMs) {
      console.log(`Normative ${normativeId} is up to date.`);
      return { success: true, message: "Normativa actualizada." };
    }
  }

  console.log(`Downloading normative ${normativeId} from BCN...`);
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

  const db = admin.firestore();
  const vectorCollection = db.collection('vector_store');

  try {
    const status = await getRagStatus(db, 'global');
    if (status && status.initialized) {
      console.log("RAG System global context already initialized in Firestore.");
      isInitialized = true;
      return;
    }

    console.log("Global RAG context not found. Executing seed...");
    for (const criticalLaw of CRITICAL_LAWS) {
      await downloadSpecificNormative(criticalLaw.id);
    }
    
    await setRagStatus(db, 'global', { initialized: true });
    isInitialized = true;
    console.log(`Global RAG context initialized.`);
  } catch (error) {
    console.error("Error initializing RAG system:", error);
  }
};

/**
 * Searches the vector database for the most relevant context given a query.
 * Uses Firestore native Vector Search.
 */
export const searchRelevantContext = async (query: string, topK: number = 3): Promise<string> => {
  if (!isInitialized || !admin.apps.length) {
    // Fallback if not initialized
    return "Contexto legal: Ley 16.744 sobre accidentes del trabajo y enfermedades profesionales.";
  }

  try {
    const queryEmbedding = await generateEmbedding(query);
    const db = admin.firestore();
    const vectorCollection = db.collection('vector_store');
    
    // Perform native vector search in Firestore
    const results = await vectorCollection
      .findNearest('embedding', FieldValue.vector(queryEmbedding), {
        limit: topK,
        distanceMeasure: 'COSINE'
      })
      .get();
    
    if (results.empty) {
      return "No se encontró contexto legal relevante.";
    }

    return results.docs.map(doc => {
      const data = doc.data();
      return `[Fuente: ${data.title}]\n${data.content}`;
    }).join("\n\n");
  } catch (error) {
    console.error("Error searching context:", error);
    return "Error al recuperar contexto legal.";
  }
};

/**
 * Interceptor for AI generation requests.
 * Checks community_glossary first. If not found, calls Gemini and saves the result.
 */
export const queryCommunityKnowledge = async (
  prompt: string, 
  industry: string, 
  geminiFallback: () => Promise<string>
): Promise<string> => {
  if (!admin.apps.length) {
    return await geminiFallback();
  }

  const db = admin.firestore();
  const glossaryCollection = db.collection('community_glossary');

  try {
    const queryEmbedding = await generateEmbedding(prompt);
    
    // Search for highly matching response in the same industry
    const results = await glossaryCollection
      .where('industry', '==', industry)
      .findNearest('embedding', FieldValue.vector(queryEmbedding), {
        limit: 1,
        distanceMeasure: 'COSINE'
      })
      .get();

    if (!results.empty) {
      console.log(`[RAG Interceptor] Cache hit for industry: ${industry}`);
      return results.docs[0].data().response;
    }

    console.log(`[RAG Interceptor] Cache miss for industry: ${industry}. Calling Gemini...`);
    // Fallback to Gemini
    const aiResponse = await geminiFallback();

    // Save to community_glossary
    await glossaryCollection.add({
      prompt,
      response: aiResponse,
      industry,
      embedding: FieldValue.vector(queryEmbedding),
      createdAt: FieldValue.serverTimestamp()
    });

    return aiResponse;
  } catch (error) {
    console.error("[RAG Interceptor] Error:", error);
    // If anything fails (e.g. vector search not indexed), fallback to Gemini
    return await geminiFallback();
  }
};
