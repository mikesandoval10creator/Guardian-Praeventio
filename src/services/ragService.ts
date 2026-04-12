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
 * Initializes the RAG system by fetching critical laws from BCN and generating embeddings.
 * Stores them in Firestore for persistence using native Vector Search.
 */
export const initializeRAG = async () => {
  if (isInitialized) return;
  console.log("Initializing RAG System with BCN data...");
  
  if (!admin.apps.length) {
    console.warn("Firebase Admin not initialized. Skipping RAG initialization.");
    return;
  }

  const db = admin.firestore();
  const vectorCollection = db.collection('vector_store');

  try {
    // Check if we already have vectors in Firestore
    const snapshot = await vectorCollection.limit(1).get();
    if (!snapshot.empty) {
      console.log("RAG System already initialized in Firestore.");
      isInitialized = true;
      return;
    }

    console.log("No vectors found in Firestore. Generating from BCN...");
    // Fetch all critical laws
    for (const criticalLaw of CRITICAL_LAWS) {
      console.log(`Fetching law: ${criticalLaw.name}...`);
      const law = await fetchLawFromBCN(criticalLaw.id);
      if (law && law.texto) {
        // Chunk the text (simplified chunking, ~1000 chars per chunk)
        const chunks = law.texto.match(/.{1,1000}(\s|$)/g) || [];
        
        // Process in batches to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          await Promise.all(batch.map(async (chunk, batchIndex) => {
            const actualIndex = i + batchIndex;
            const docId = `${law.idNorma}-chunk-${actualIndex}`;
            
            try {
              const embeddingArray = await generateEmbedding(chunk);
              const docData = {
                id: docId,
                title: law.titulo,
                content: chunk.trim(),
                embedding: FieldValue.vector(embeddingArray)
              };
              
              // Save to Firestore
              await vectorCollection.doc(docId).set(docData);
            } catch (e) {
              console.error(`Failed to embed chunk ${actualIndex} of law ${law.idNorma}`, e);
            }
          }));
          // Small delay between batches
          await sleep(1000);
        }
      }
    }
    
    isInitialized = true;
    console.log(`RAG System Initialized and saved to Firestore.`);
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
