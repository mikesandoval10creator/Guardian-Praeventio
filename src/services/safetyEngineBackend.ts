import admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import { processGlobalSafetyAudit, calculateComplianceSummary } from "./geminiBackend.js";

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
    const nodes = await db.collection('nodes').where('projectId', '==', projectId).get();
    
    const projectData = {
        name: projectDoc.data()?.name,
        reports: reports.docs.map(d => d.data()),
        controls: controls.docs.map(d => d.data()),
        telemetry: telemetry.docs.map(d => d.data()),
        nodesSummary: nodes.docs.map(d => d.id)
    };
    
    // 2. Call AI logic
    const auditResult = await processGlobalSafetyAudit(projectId, projectData);
    const complianceSummary = await calculateComplianceSummary(projectId, nodes.docs.map(d => ({ id: d.id, ...d.data() })));
    
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
        console.error("Error auto-validating telemetry:", e);
        return null;
    }
};
