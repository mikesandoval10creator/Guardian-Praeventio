import admin from "firebase-admin";
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

let pinecone: Pinecone | null = null;
try {
  if (process.env.PINECONE_API_KEY) {
    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }
} catch (error) {
  console.error("Failed to initialize Pinecone in networkBackend:", error);
}

/**
 * Generates an embedding for a text.
 */
const getEmbedding = async (text: string): Promise<number[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const model = ai.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
};

/**
 * Upserts a safety node both to Firestore and Pinecone for unified RAG.
 * Also handles bidirectional connections with admin privileges.
 */
export const syncNodeToNetwork = async (nodeData: any, authorUid: string) => {
  const db = admin.firestore();
  
  // 1. Generate Embedding if not provided
  if (!nodeData.embedding || (Array.isArray(nodeData.embedding) && nodeData.embedding.length === 0)) {
    const textToEmbed = `${nodeData.title} ${nodeData.description} ${nodeData.tags?.join(' ') || ''}`;
    nodeData.embedding = await getEmbedding(textToEmbed);
  }

  const nodeId = nodeData.id || db.collection('nodes').doc().id;
  const nodeRef = db.collection('nodes').doc(nodeId);

  // 2. Save to Firestore
  const finalData = {
    ...nodeData,
    id: nodeId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    "metadata.authorId": authorUid,
    "metadata.syncedAt": admin.firestore.FieldValue.serverTimestamp()
  };
  
  await nodeRef.set(finalData, { merge: true });

  // 3. Sync to Pinecone for "El Guardián" (RAG)
  if (pinecone && process.env.PINECONE_INDEX_NAME) {
    try {
      const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
      await index.upsert([{
        id: nodeId,
        values: nodeData.embedding,
        metadata: {
          text: `${nodeData.title}: ${nodeData.description}`,
          type: nodeData.type,
          projectId: nodeData.projectId || 'global',
          title: nodeData.title
        }
      }]);
      console.log(`[NetworkBackend] Node ${nodeId} upserted to Pinecone.`);
    } catch (e) {
      console.error(`[NetworkBackend] Failed to upsert to Pinecone:`, e);
    }
  }

  // 4. Handle Bidirectional Connections
  if (nodeData.connections && Array.isArray(nodeData.connections)) {
    for (const targetId of nodeData.connections) {
      const targetRef = db.collection('nodes').doc(targetId);
      const targetDoc = await targetRef.get();
      
      if (targetDoc.exists) {
        const currentConnections = targetDoc.data()?.connections || [];
        if (!currentConnections.includes(nodeId)) {
          // Add back-link using Admin SDK (bypasses rules)
          await targetRef.update({
            connections: admin.firestore.FieldValue.arrayUnion(nodeId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    }
  }

  return { success: true, nodeId };
};

/**
 * Processes a batch of sync operations (set, update, delete) on nodes.
 * Ensures consistent RAG (Pinecone) state and admin-level cross-linking.
 */
export const syncBatchToNetwork = async (operations: any[], authorUid: string) => {
  const db = admin.firestore();
  const results = [];

  for (const op of operations) {
    try {
      if (op.type === 'set' || op.type === 'update') {
        const res = await syncNodeToNetwork(op.data, authorUid);
        results.push({ id: op.id, status: 'success', res });
      } else if (op.type === 'delete') {
        const nodeId = op.id;
        // 1. Delete from Firestore
        await db.collection('nodes').doc(nodeId).delete();
        // 2. Delete from Pinecone
        if (pinecone && process.env.PINECONE_INDEX_NAME) {
          const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
          await index.deleteOne(nodeId);
        }
        results.push({ id: nodeId, status: 'deleted' });
      }
    } catch (e: any) {
      console.error(`[NetworkBackend] Error in batch op for ${op.id}:`, e);
      results.push({ id: op.id, status: 'error', error: e.message });
    }
  }

  return { success: true, results };
};
