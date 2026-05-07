import admin from "firebase-admin";
import { GoogleGenAI, Type } from "@google/genai";
import { processGlobalSafetyAudit, calculateComplianceSummary } from "./geminiBackend.js";
import { logger } from '../utils/logger';

const API_KEY = process.env.GEMINI_API_KEY;

export const performProjectSafetyHealthCheck = async (projectId: string) => {
    const db = admin.firestore();
    
    // 1. Fetch project data
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) return null;
    
    const reports = await db.collection('projects').doc(projectId).collection('reports').limit(10).get();
    const controls = await db.collection('projects').doc(projectId).collection('controls').get();
    const telemetry = await db.collection('telemetry_events').where('projectId', '==', projectId).limit(20).get();

    // Bridge read across the three Zettelkasten paths (legacy `nodes`,
    // top-level `zettelkasten_nodes`, and tenant-scoped
    // `tenants/{tid}/zettelkasten_nodes`). The split was introduced
    // incrementally (Sprint 11 → Sprint 28) without a sync writer, so a
    // single-path read silently misses new knowledge from the canonical
    // POST /api/zettelkasten/nodes endpoint. Until the data-migration
    // job lands, the read side merges all three by id (last-write-wins).
    const [legacyNodesSnap, zkNodesSnap, scopedNodesSnap] = await Promise.all([
      db.collection('nodes').where('projectId', '==', projectId).get(),
      db.collection('zettelkasten_nodes').where('projectId', '==', projectId).get(),
      db.collectionGroup('zettelkasten_nodes').where('projectId', '==', projectId).get(),
    ]);

    const mergedNodes = new Map<string, { id: string; [k: string]: unknown }>();
    for (const snap of [legacyNodesSnap, zkNodesSnap, scopedNodesSnap]) {
      for (const d of snap.docs) {
        mergedNodes.set(d.id, { id: d.id, ...d.data() });
      }
    }
    const nodesArray = Array.from(mergedNodes.values());

    const projectData = {
        name: projectDoc.data()?.name,
        reports: reports.docs.map(d => d.data()),
        controls: controls.docs.map(d => d.data()),
        telemetry: telemetry.docs.map(d => d.data()),
        nodesSummary: nodesArray.map(n => n.id)
    };

    // 2. Call AI logic
    const auditResult = await processGlobalSafetyAudit(projectId, projectData);
    const complianceSummary = await calculateComplianceSummary(projectId, nodesArray);
    
    // 3. Store result in a "health_checks" collection for historical tracking
    const healthCheckRef = db.collection('projects').doc(projectId).collection('health_checks').doc('latest');
    const result = {
        ...auditResult,
        compliance: complianceSummary,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await healthCheckRef.set(result);
    
    return result;
};

export const autoValidateTelemetry = async (telemetryEvent: any) => {
    if (!API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    // Simple anomaly detection
    const prompt = `
        Analiza el siguiente evento de telemetría industrial y determina si representa un riesgo inminente o una anomalía que requiera atención inmediata.
        Evento: ${JSON.stringify(telemetryEvent)}
        
        Responde con un JSON:
        { "isAnomalous": boolean, "threatLevel": "None"|"Low"|"Medium"|"High", "reason": "string", "suggestedAction": "string" }
    `;
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        
        return JSON.parse(response.text);
    } catch (e) {
        logger.error("Error auto-validating telemetry:", e);
        return null;
    }
};

export const predictGlobalIncidents = async (context: string, envContext: string) => {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    const prompt = `
        Analiza el panorama GLOBAL de riesgos para la organización Praeventio.
        
        Contexto operacional (Riesgos Activos):
        ${context}
        
        Contexto Ambiental (Telemetría/Clima/Sismos):
        ${envContext}
        
        Como el "Guardián Supremo", identifica tendencias sistémicas que podrían llevar a incidentes múltiples o fallas en cadena.
    `;

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    globalRiskScore: { type: Type.NUMBER },
                    systemicAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
                    forecast48h: { type: Type.STRING },
                    strategicRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["globalRiskScore", "systemicAlerts", "forecast48h"]
            }
        }
    });

    return JSON.parse(response.text);
};
