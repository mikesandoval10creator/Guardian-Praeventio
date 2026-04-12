import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { generateEmbedding } from "./ragService.js";

const API_KEY = process.env.GEMINI_API_KEY;

const INDUSTRIES = ["Construcción", "Minería", "Forestal"];

const generateInitialDataForIndustry = async (industry: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  console.log(`Generating initial data for industry: ${industry}`);

  // 1. Generate IPERC Matrix
  const ipercPrompt = `Analiza los riesgos más críticos y comunes en la industria: ${industry}.
    Proporciona un análisis IPERC (Identificación de Peligros, Evaluación de Riesgos y Controles) general para esta industria.
    Incluye:
    1. Nivel de criticidad (Alta, Media, Baja).
    2. Lista de recomendaciones inmediatas.
    3. Lista de controles a implementar (Jerarquía de Controles).
    4. Normativa aplicable (ej. DS 594, Ley 16.744).`;

  console.log(`Calling Gemini for IPERC (${industry})...`);
  const ipercResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: ipercPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          criticidad: { type: "STRING", enum: ["Alta", "Media", "Baja"] },
          recomendaciones: { type: "ARRAY", items: { type: "STRING" } },
          controles: { type: "ARRAY", items: { type: "STRING" } },
          normativa: { type: "STRING" }
        },
        required: ["criticidad", "recomendaciones", "controles", "normativa"]
      }
    }
  });

  const ipercResult = ipercResponse.text;

  // 2. Generate PTS
  const ptsPrompt = `Actúa como un experto en prevención de riesgos.
    Genera un Procedimiento de Trabajo Seguro (PTS) estándar y crítico para la industria: ${industry}.
    
    El documento debe ser estructurado, profesional y utilizar formato Markdown.
    Incluye secciones como Objetivos, Alcance, Responsabilidades, EPP Requerido, Paso a Paso, y Medidas de Control.`;

  console.log(`Calling Gemini for PTS (${industry})...`);
  const ptsResponse = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: ptsPrompt,
  });

  const ptsResult = ptsResponse.text;

  // Save to community_glossary
  const db = admin.firestore();
  const glossaryCollection = db.collection('community_glossary');

  console.log(`Generating embeddings and saving to Firestore (${industry})...`);
  
  const ipercEmbedding = await generateEmbedding(ipercPrompt);
  await glossaryCollection.add({
    prompt: ipercPrompt,
    response: ipercResult,
    industry,
    embedding: FieldValue.vector(ipercEmbedding),
    createdAt: FieldValue.serverTimestamp(),
    type: 'IPERC_SEED'
  });

  const ptsEmbedding = await generateEmbedding(ptsPrompt);
  await glossaryCollection.add({
    prompt: ptsPrompt,
    response: ptsResult,
    industry,
    embedding: FieldValue.vector(ptsEmbedding),
    createdAt: FieldValue.serverTimestamp(),
    type: 'PTS_SEED'
  });

  console.log(`Finished seeding for ${industry}`);
};

export const cleanupUserApiKeys = async () => {
  if (!admin.apps.length) {
    console.error("Firebase Admin not initialized. Cannot run cleanup.");
    return;
  }

  const db = admin.firestore();
  const usersCollection = db.collection('users');
  
  try {
    const snapshot = await usersCollection.get();
    let count = 0;
    
    const batch = db.batch();
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.user_gemini_api_key || data.geminiApiKey) {
        batch.update(doc.ref, {
          user_gemini_api_key: FieldValue.delete(),
          geminiApiKey: FieldValue.delete()
        });
        count++;
      }
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`Cleaned up API keys from ${count} user documents.`);
    } else {
      console.log("No user API keys found to clean up.");
    }
  } catch (error) {
    console.error("Error cleaning up user API keys:", error);
  }
};

export const runSeed = async () => {
  if (!admin.apps.length) {
    console.error("Firebase Admin not initialized. Cannot run seed.");
    return;
  }

  await cleanupUserApiKeys();

  for (const industry of INDUSTRIES) {
    try {
      await generateInitialDataForIndustry(industry);
    } catch (error) {
      console.error(`Error seeding industry ${industry}:`, error);
    }
  }
  console.log("Seeding complete.");
};
