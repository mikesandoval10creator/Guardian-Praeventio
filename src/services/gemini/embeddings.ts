// Praeventio Guard — §12.5.1 split step 4: Gemini embeddings + semantic search.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Cuarta
// extracción del split. Contiene 3 funciones y 1 helper puro:
//
//   1. `cosineSimilarity(a, b)` — pure helper, sin red, totalmente testeable.
//   2. `generateEmbeddingsBatch(texts)` — batch embedding generation
//      con retry exponencial. Best-effort: errores individuales no
//      abortan el batch (empty vector en posición).
//   3. `autoConnectNodes(newNode, existing)` — pide al modelo qué nodos
//      existentes deben conectarse al nuevo (knowledge graph builder).
//   4. `semanticSearch(query, nodes, topK, projectId)` — hybrid filter
//      por projectId + ranking por cosine similarity.
//
// `cosineSimilarity` extraído como export NUEVO para que sea
// testeable + reusable desde otros módulos (analytics, dedup).

import { GoogleGenAI } from '@google/genai';
import type { RiskNode } from '../../types';
import { logger } from '../../utils/logger';
import { withExponentialBackoff } from './parsing';

const API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Cosine similarity entre dos vectores de igual dimensión.
 *
 * Devuelve valor en [-1, 1]. Si alguno es vector zero o tamaños
 * distintos, devuelve 0 (sentinela neutro, no NaN — porque NaN
 * propagaría en cualquier sort/threshold downstream).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dotProduct += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const generateEmbeddingsBatch = async (texts: string[]): Promise<number[][]> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  if (texts.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const embeddings: number[][] = [];

  for (const text of texts) {
    try {
      const response = await withExponentialBackoff(() =>
        ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: text,
        }),
      );
      embeddings.push(response.embeddings?.[0]?.values || []);
    } catch (e) {
      logger.error('Error generating embedding for text:', text, e);
      embeddings.push([]);
    }
  }
  return embeddings;
};

export const autoConnectNodes = async (
  newNode: Partial<RiskNode>,
  existingNodes: Partial<RiskNode>[],
): Promise<string[]> => {
  if (!API_KEY) return [];
  if (existingNodes.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const nodesContext = existingNodes
    .map((n) => `ID: ${n.id}, Title: ${n.title}, Type: ${n.type}`)
    .join('\n');

  const prompt = `
  You are an AI assistant helping to build a knowledge graph for occupational safety.
  A new node has been created:
  ID: ${newNode.id}
  Title: ${newNode.title}
  Type: ${newNode.type}
  Description: ${newNode.description || ''}

  Here are the existing nodes in the graph:
  ${nodesContext}

  Based on the semantic relationship and relevance, suggest which existing nodes this new node should be connected to.
  Return ONLY a JSON array of strings containing the IDs of the nodes to connect to.
  Example: ["node1", "node2"]
  If there are no relevant connections, return an empty array [].
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text || '[]');
    if (Array.isArray(result)) {
      return result;
    }
    return [];
  } catch (error) {
    logger.error('Error auto-connecting nodes:', error);
    return [];
  }
};

export const semanticSearch = async (
  query: string,
  nodes: Partial<RiskNode>[],
  topK: number = 3,
  projectId?: string,
): Promise<Partial<RiskNode>[]> => {
  // Hybrid: metadata filter first, then semantic similarity.
  const candidates = projectId
    ? nodes.filter((n) => (n as RiskNode & { projectId?: string }).projectId === projectId)
    : nodes;
  if (!API_KEY) return candidates.slice(0, topK);
  if (candidates.length === 0) return [];

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const queryResponse = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: query,
    });
    const queryEmbedding = queryResponse.embeddings?.[0]?.values;

    if (!queryEmbedding) return candidates.slice(0, topK);

    const nodesWithScores = candidates.map((node) => {
      const score =
        node.embedding && node.embedding.length > 0
          ? cosineSimilarity(queryEmbedding, node.embedding)
          : 0;
      return { node, score };
    });

    nodesWithScores.sort((a, b) => b.score - a.score);
    return nodesWithScores.slice(0, topK).map((n) => n.node);
  } catch (error) {
    logger.error('Error in semantic search:', error);
    return candidates.slice(0, topK);
  }
};
