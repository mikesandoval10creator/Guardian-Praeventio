import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "crypto";
import dotenv from "dotenv";
import { initializeRAG } from "./src/services/ragService.js";
import admin from "firebase-admin";
import fs from 'fs';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Initialize Firebase Admin
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
} catch (error) {
  console.warn("Firebase Admin initialization failed. Auth middleware may not work without credentials.", error);
}

// Initialize Pinecone
let pinecone: Pinecone | null = null;
try {
  if (process.env.PINECONE_API_KEY) {
    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    console.log("Pinecone initialized successfully.");
  } else {
    console.warn("PINECONE_API_KEY not found. Vector database features will be disabled.");
  }
} catch (error) {
  console.error("Failed to initialize Pinecone:", error);
}

// Read Firebase Config once at startup
let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (error) {
  console.error("Failed to read firebase-applet-config.json at startup:", error);
}

const app = express();
const PORT = 3000;

const sessionSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && !sessionSecret) {
  throw new Error("FATAL ERROR: SESSION_SECRET is not defined in production environment.");
}

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: sessionSecret || "fallback-secret-do-not-use-in-production",
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === "production", 
    sameSite: 'none',
    httpOnly: true 
  }
}));

// Firebase Auth Middleware
const verifyAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying auth token:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Custom Claims Endpoint (El Haki del Rey)
app.post("/api/admin/set-role", verifyAuth, async (req, res) => {
  const { uid, role } = req.body;
  const callerUid = (req as any).user.uid;

  try {
    // Verify caller is a master admin
    const callerRecord = await admin.auth().getUser(callerUid);
    if (callerRecord.customClaims?.role !== 'master_admin') {
      return res.status(403).json({ error: "Forbidden: Requires master_admin role" });
    }

    // Set custom claim
    await admin.auth().setCustomUserClaims(uid, { role });
    res.json({ success: true, message: `Role ${role} assigned to user ${uid}` });
  } catch (error) {
    console.error("Error setting custom claims:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Ask Guardian Endpoint (El Cerebro Externo)
app.post("/api/ask-guardian", verifyAuth, async (req, res) => {
  const { query, projectId } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let context = "";

    // If Pinecone is available, fetch relevant context
    if (pinecone && process.env.PINECONE_INDEX_NAME) {
      try {
        // 1. Generate embedding for the query
        const embedResponse = await ai.models.embedContent({
          model: "text-embedding-004",
          contents: query,
        });
        const queryEmbedding = embedResponse.embeddings?.[0]?.values;

        if (queryEmbedding) {
          // 2. Query Pinecone
          const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
          const queryResponse = await index.query({
            vector: queryEmbedding,
            topK: 5,
            includeMetadata: true,
            filter: projectId ? { projectId: { $eq: projectId } } : undefined
          });

          // 3. Build context string
          context = queryResponse.matches
            .map(match => match.metadata?.text || '')
            .join('\n\n');
        }
      } catch (pcError) {
        console.error("Pinecone query error:", pcError);
        // Continue without context if Pinecone fails
      }
    }

    // Generate response using Gemini
    const prompt = `
      Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard.
      Tu propósito es proteger la vida humana, analizar normativas (leyes chilenas como DS 594, Ley 16.744) y gestionar riesgos.
      Responde de forma profesional, vigilante y altamente técnica pero accionable.
      
      Contexto recuperado de la base de datos de conocimiento (si aplica):
      ${context}

      Consulta del usuario:
      ${query}
    `;

    // Use SSE for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3.1-pro", // Using Pro for the RAG engine
      contents: prompt,
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Error in /api/ask-guardian:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PDF Generation Endpoint (El Cuarto de Máquinas)
app.post("/api/reports/generate-pdf", verifyAuth, async (req, res) => {
  const { incidentId, title, content } = req.body;
  
  try {
    const PDFDocument = (await import('pdfkit')).default;
    
    // Create a document
    const doc = new PDFDocument();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reporte-${incidentId || 'general'}.pdf`);
    
    // Pipe the PDF into the response
    doc.pipe(res);
    
    // Add content to the PDF
    doc.fontSize(25).text(title || 'Reporte Praeventio Guard', 100, 100);
    doc.moveDown();
    doc.fontSize(12).text(`Generado el: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text(content || 'Contenido del reporte...');
    
    // Finalize the PDF and end the stream
    doc.end();
    
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Internal server error during PDF generation" });
  }
});

// OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.body.read'
].join(' ');

// API Routes
app.get("/api/auth/google/url", (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;
  
  const state = crypto.randomBytes(16).toString('hex');
  (req.session as any).oauthState = state;
  
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: state
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;

  if (!state || state !== (req.session as any).oauthState) {
    return res.status(403).send("Invalid state parameter (CSRF protection)");
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || "",
        client_secret: GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    
    // In a real app, store these in a database linked to the user
    // For this demo, we'll send them back to the client via postMessage
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'GOOGLE_AUTH_SUCCESS', 
                tokens: ${JSON.stringify(tokens)} 
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Autenticación exitosa. Sincronizando con Praeventio Guard...</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Auth Callback:', error);
    res.status(500).send("Error during authentication");
  }
});

// Proxy for Google Calendar API to avoid CORS
app.post("/api/calendar/sync", async (req, res) => {
  const { tokens, challenges } = req.body;
  
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: "No access token provided" });
  }

  try {
    const results = [];
    for (const challenge of challenges) {
      const event = {
        summary: `Desafío Praeventio: ${challenge}`,
        description: 'Objetivo de seguridad y salud en el trabajo planificado desde Praeventio Guard.',
        start: {
          dateTime: new Date().toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
          timeZone: 'UTC',
        },
      };

      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      const data = await response.json();
      results.push(data);
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error syncing with Google Calendar:', error);
    res.status(500).json({ error: "Failed to sync with Google Calendar" });
  }
});

// Proxy for Google Fit API
app.post("/api/fitness/sync", async (req, res) => {
  const { tokens } = req.body;
  
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: "No access token provided" });
  }

  try {
    const endTime = Date.now();
    const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.heart_rate.bpm' },
          { dataTypeName: 'com.google.step_count.delta' }
        ],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startTime,
        endTimeMillis: endTime
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Fit API error:', errorText);
      return res.status(response.status).json({ error: "Failed to fetch Google Fit data" });
    }

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error syncing with Google Fit:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Google Drive Integration
app.get("/api/drive/auth/url", (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;
  
  const state = crypto.randomBytes(16).toString('hex');
  (req.session as any).driveOauthState = state;
  
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state: state
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get("/api/drive/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;

  if (!state || state !== (req.session as any).driveOauthState) {
    return res.status(403).send("Invalid state parameter (CSRF protection)");
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || "",
        client_secret: GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'DRIVE_AUTH_SUCCESS', 
                tokens: ${JSON.stringify(tokens)} 
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Autenticación de Google Drive exitosa. Puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Drive Auth Callback:', error);
    res.status(500).send("Error during authentication");
  }
});

// ERP Integration (SAP/Defontana Mock)
app.post("/api/erp/sync", verifyAuth, async (req, res) => {
  const { erpType, action, payload } = req.body;
  
  // En un entorno real, aquí se harían peticiones REST seguras a SAP o Defontana
  // usando credenciales almacenadas en variables de entorno (process.env.SAP_API_KEY)
  
  try {
    console.log(`[ERP Sync] Type: ${erpType}, Action: ${action}`);
    
    // Simular latencia de red
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    res.json({ 
      success: true, 
      message: `Sincronización con ${erpType} exitosa`,
      data: {
        syncId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status: 'completed'
      }
    });
  } catch (error) {
    console.error(`Error syncing with ERP (${erpType}):`, error);
    res.status(500).json({ error: "Error de sincronización con ERP" });
  }
});

// IoT Webhook Ingestion Endpoint
app.post("/api/telemetry/ingest", async (req, res) => {
  const { secretKey, type, source, metric, value, unit, status, projectId } = req.body;

  const expectedSecret = process.env.IOT_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("IOT_WEBHOOK_SECRET is not configured on the server.");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (secretKey !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized: Invalid secret key" });
  }

  if (!type || !source || !metric || value === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    if (!firebaseConfig) {
      console.error("Firebase config not loaded at startup.");
      return res.status(500).json({ error: "Server configuration error" });
    }
    
    // Construct Firestore REST API URL
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/telemetry_events`;

    // Format payload for Firestore REST API
    const firestorePayload = {
      fields: {
        secretKey: { stringValue: secretKey },
        type: { stringValue: type },
        source: { stringValue: source },
        metric: { stringValue: metric },
        value: { doubleValue: Number(value) },
        unit: { stringValue: unit || "" },
        status: { stringValue: status || "normal" },
        projectId: { stringValue: projectId || "global" },
        timestamp: { timestampValue: new Date().toISOString() }
      }
    };

    const response = await fetch(firestoreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(firestorePayload)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Firestore REST API error:', errorData);
      throw new Error(`Firestore error: ${response.status}`);
    }

    res.json({ success: true, message: "Telemetry event ingested successfully" });
  } catch (error) {
    console.error('Error ingesting telemetry:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Seed Glossary Endpoint
app.post("/api/seed-glossary", async (req, res) => {
  try {
    const { runSeed } = await import('./src/services/seedBackend.js');
    await runSeed();
    res.json({ success: true, message: "Community glossary seeded successfully" });
  } catch (error: any) {
    console.error('Error seeding glossary:', error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Gemini API Proxy
const ALLOWED_GEMINI_ACTIONS = [
  'generateEmbeddingsBatch',
  'autoConnectNodes',
  'semanticSearch',
  'analyzeFastCheck',
  'predictGlobalIncidents',
  'analyzeRiskWithAI',
  'analyzePostureWithAI',
  'generateEmergencyPlan',
  'analyzeSafetyImage',
  'generateISOAuditChecklist',
  'generatePTS',
  'generatePTSWithManufacturerData',
  'generateEmergencyScenario',
  'generateRealisticIoTEvent',
  'processDocumentToNodes',
  'simulateRiskPropagation',
  'enrichNodeData',
  'analyzeRootCauses',
  'queryBCN',
  'getChatResponse'
];

app.post("/api/gemini", verifyAuth, async (req, res) => {
  const { action, args } = req.body;
  
  if (!ALLOWED_GEMINI_ACTIONS.includes(action)) {
    return res.status(403).json({ error: `Forbidden: Action ${action} is not allowed` });
  }

  try {
    const geminiBackend = await import('./src/services/geminiBackend.js');
    if (typeof geminiBackend[action as keyof typeof geminiBackend] === 'function') {
      const result = await (geminiBackend[action as keyof typeof geminiBackend] as Function)(...args);
      res.json({ result });
    } else {
      res.status(400).json({ error: `Action ${action} not found` });
    }
  } catch (error: any) {
    console.error(`Error in Gemini API Proxy for ${action}:`, error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Initialize RAG system asynchronously
initializeRAG().catch(console.error);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
