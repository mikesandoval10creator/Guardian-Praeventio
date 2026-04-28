import admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import { autoConnectNodes } from "./geminiBackend";

const API_KEY = process.env.GEMINI_API_KEY;

/**
 * Maximum number of recent nodes that will be passed to `autoConnectNodes`
 * when scoring connection candidates for a freshly-synced node. The cap
 * exists for two reasons:
 *
 *   1. Cost / latency. Each candidate node is dropped into the LLM prompt;
 *      with no cap a long-running project could push thousands of nodes
 *      and balloon both token usage and round-trip time.
 *   2. Quality. The most recent N edits in a project are usually the most
 *      semantically related (active topics, in-progress incidents). Older
 *      nodes still benefit from the existing `vector_store` similarity
 *      search via `searchRelevantContext` — auto-connect is a *suggestion*
 *      surface, not the source of truth.
 *
 * The 50-node window matches the comment in `syncManager.ts`'s old import
 * site of `autoConnectNodes` and keeps prompt size predictable.
 */
const AUTO_CONNECT_RECENT_LIMIT = 50;

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

  // 5. Auto-connect suggestions (Round 14 Task 6 — A2 dead-code finding).
  //
  // Previously `autoConnectNodes` was imported by `syncManager.ts` and never
  // invoked, so the LLM-derived edge suggestions were dead code. We now call
  // it from the server path (here) AFTER the embedding + Firestore + vector
  // store steps so the new node is fully indexed before we ask Gemini what
  // to wire it to. The suggestions are returned to the caller as an array
  // — we deliberately DO NOT auto-write them as connections:
  //
  //   • Auto-writing would inflate the per-node connection count toward
  //     the 200-edge `firestore.rules` cap without user consent and
  //     potentially link nodes from different projects via false-positive
  //     semantic matches.
  //   • Returning them as a payload lets a future UI consumer surface
  //     "Suggested connections" inline in the detail drawer (Round 15
  //     scope) where the user can accept/reject each.
  //
  // Best-effort posture: any failure here (Gemini quota, malformed JSON
  // from the model, missing API key) is swallowed and degrades to an
  // empty suggestion list. The primary sync write is already committed
  // by this point, so a suggestion failure must NOT roll back the node.
  let connectionSuggestions: string[] = [];
  try {
    if (API_KEY) {
      const recentSnapshot = await db
        .collection('nodes')
        .where('projectId', '==', nodeData.projectId || 'global')
        .orderBy('updatedAt', 'desc')
        .limit(AUTO_CONNECT_RECENT_LIMIT + 1) // +1 because we filter the new node out below
        .get();

      const recentNodes = recentSnapshot.docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((n: any) => n.id !== nodeId)
        .slice(0, AUTO_CONNECT_RECENT_LIMIT);

      if (recentNodes.length > 0) {
        const candidateIds = await autoConnectNodes(
          { id: nodeId, title: nodeData.title, type: nodeData.type, description: nodeData.description },
          recentNodes,
        );

        // Defensive: keep only suggestions that aren't already connected
        // (avoid surfacing stale suggestions to the UI) and that map to a
        // real candidate. The model occasionally hallucinates ids.
        const candidateIdSet = new Set(recentNodes.map((n: any) => n.id));
        const alreadyConnected = new Set<string>(Array.isArray(nodeData.connections) ? nodeData.connections : []);
        connectionSuggestions = (Array.isArray(candidateIds) ? candidateIds : [])
          .filter((id: any) => typeof id === 'string' && candidateIdSet.has(id) && !alreadyConnected.has(id));
      }
    }
  } catch (e) {
    // Don't fail the sync over a suggestion miss — log and move on.
    console.warn(`[NetworkBackend] autoConnectNodes failed for ${nodeId}:`, e);
    connectionSuggestions = [];
  }

  return { success: true, nodeId, connectionSuggestions };
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

  const failedOps = results
    .filter(r => r.status === 'error')
    .map(r => ({ id: r.id }));

  return {
    success: failedOps.length === 0,
    results,
    failedOps: failedOps.length > 0 ? failedOps : undefined,
  };
};
