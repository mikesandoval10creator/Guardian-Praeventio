import { GoogleGenAI } from "@google/genai";
import { fetchLawFromBCN, CRITICAL_LAWS } from "./bcnService";

// In a real production environment, you would use a Vector Database like Pinecone, Milvus, or Firestore Vector Search.
// For this architecture, we are simulating the local vector store but using real embeddings from Gemini.
interface VectorDocument {
  id: string;
  title: string;
  content: string;
  embedding: number[];
}

let localVectorStore: VectorDocument[] = [];
let isInitialized = false;

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Generates an embedding vector for a given text using Gemini's embedding model.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: text,
  });
  
  return response.embeddings?.[0]?.values || [];
};

/**
 * Calculates the cosine similarity between two vectors.
 */
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Initializes the RAG system by fetching critical laws from BCN and generating embeddings.
 * This should ideally be done in a backend cron job and stored in a real Vector DB.
 */
export const initializeRAG = async () => {
  if (isInitialized) return;
  console.log("Initializing RAG System with BCN data...");
  
  try {
    // For demonstration, we'll only fetch the first law to avoid long initialization times in the frontend.
    // In production, fetch all and chunk them appropriately.
    const law = await fetchLawFromBCN(CRITICAL_LAWS[0].id);
    if (law && law.texto) {
      // Chunk the text (simplified chunking)
      const chunks = law.texto.match(/.{1,1000}/g) || [];
      
      for (let i = 0; i < Math.min(chunks.length, 5); i++) { // Limit to 5 chunks for demo
        const chunk = chunks[i];
        const embedding = await generateEmbedding(chunk);
        localVectorStore.push({
          id: `${law.idNorma}-chunk-${i}`,
          title: law.titulo,
          content: chunk,
          embedding
        });
      }
    }
    isInitialized = true;
    console.log("RAG System Initialized.");
  } catch (error) {
    console.error("Failed to initialize RAG:", error);
  }
};

/**
 * Searches the vector database for the most relevant context given a query.
 */
export const searchRelevantContext = async (query: string, topK: number = 3): Promise<string> => {
  if (!isInitialized) {
    // Fallback if not initialized
    return "Contexto legal: Ley 16.744 sobre accidentes del trabajo y enfermedades profesionales.";
  }

  try {
    const queryEmbedding = await generateEmbedding(query);
    
    // Calculate similarities
    const results = localVectorStore.map(doc => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    // Take top K
    const topResults = results.slice(0, topK);
    
    return topResults.map(r => `[Fuente: ${r.title}]\n${r.content}`).join("\n\n");
  } catch (error) {
    console.error("Error searching context:", error);
    return "Error al recuperar contexto legal.";
  }
};
