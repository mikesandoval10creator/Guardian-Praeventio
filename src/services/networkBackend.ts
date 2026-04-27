import admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

/**
 * Generates an embedding for a text.
 */
const getEmbedding = async (text: string): Promise<number[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const result = await ai.models.embedContent({ model: "text-embedding-004", contents: text });
  return result.embeddings?.[0]?.values ?? [];
};

/**
 * Upserts a safety node both to Firestore and the vector store for unified RAG.
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

  // 2. Save to Firestore (Nodes collection)
  const finalData = {
    ...nodeData,
    id: nodeId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    "metadata.authorId": authorUid,
    "metadata.syncedAt": admin.firestore.FieldValue.serverTimestamp()
  };
  
  // Remove embedding from the main node document if we want to keep it light, 
  // but usually it's better to keep it for local filtering or if we don't mind the size.
  // However, for Vector Search, it MUST be in the collection where findNearest is called.
  await nodeRef.set(finalData, { merge: true });

  // 3. Sync to Firestore Vector Store for "El Guardián" (RAG)
  try {
    const vectorStoreRef = db.collection('vector_store').doc(`node-${nodeId}`);
    await vectorStoreRef.set({
      id: `node-${nodeId}`,
      nodeId: nodeId,
      title: nodeData.title,
      content: `${nodeData.title}: ${nodeData.description}`,
      embedding: admin.firestore.FieldValue.vector(nodeData.embedding),
      type: nodeData.type,
      projectId: nodeData.projectId || 'global',
      indexedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`[NetworkBackend] Node ${nodeId} synced to Firestore Vector Store.`);
  } catch (e) {
    console.error(`[NetworkBackend] Failed to sync to Firestore Vector Store:`, e);
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
        // 2. Delete from Vector Store
        await db.collection('vector_store').doc(`node-${nodeId}`).delete();
        
        results.push({ id: nodeId, status: 'deleted' });
      }
    } catch (e: any) {
      console.error(`[NetworkBackend] Error in batch op for ${op.id}:`, e);
      results.push({ id: op.id, status: 'error', error: e.message });
    }
  }

  return { success: true, results };
};
