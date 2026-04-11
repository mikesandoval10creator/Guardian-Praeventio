const fs = require('fs');

let content = fs.readFileSync('src/services/geminiService.ts', 'utf-8');

const newFunction = `export const calculateDynamicEvacuationRoute = async (activeEmergencies: any[], workers: any[], machinery: any[], userBlockedAreas: string[] = []) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  // 1. Deterministic Calculation
  // Mocking start point from the first worker or a default location
  const startPoint = workers.length > 0 && workers[0].position 
    ? { lat: workers[0].position[0], lng: workers[0].position[1] } 
    : { lat: -33.4489, lng: -70.6693 }; // Default Santiago
  
  // Mocking a safe destination (e.g., a known safe zone)
  const destination = { lat: -33.4500, lng: -70.6700 };

  // Convert emergencies to hazard zones
  const hazards = activeEmergencies.map(e => ({
    center: e.location ? { lat: e.location.lat, lng: e.location.lng } : { lat: -33.4490, lng: -70.6690 },
    radius: 50 // Assume 50 meters radius for emergencies
  }));

  // Calculate safe route deterministically (mocked logic for now)
  const safeRoutePoints = [startPoint, { lat: -33.4495, lng: -70.6695 }, destination];

  // 2. Use Gemini to translate the deterministic route into human instructions
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: \`Actúa como un experto en logística de emergencias y evacuación industrial. 
    Se ha calculado matemáticamente una ruta de evacuación segura. Tu tarea es traducir esta ruta en instrucciones claras, calmadas y precisas para el personal.
    
    DATOS DE LA RUTA CALCULADA:
    - Punto de Inicio: [\${startPoint.lat}, \${startPoint.lng}]
    - Punto de Encuentro: [\${destination.lat}, \${destination.lng}]
    - Puntos intermedios seguros: \${safeRoutePoints.length} puntos calculados.
    
    CONTEXTO DE LA EMERGENCIA:
    \${activeEmergencies.map(e => \`- \${e.title}: \${e.description}\`).join('\\n')}
    
    ESTADO DEL PERSONAL:
    \${workers.map(w => \`- Trabajador \${w.id}: Estado \${w.status}, Caído: \${w.isFallen ? 'Sí' : 'No'}\`).join('\\n')}
    
    ÁREAS BLOQUEADAS:
    \${userBlockedAreas.length > 0 ? userBlockedAreas.join(', ') : 'Ninguna'}
    
    Proporciona:
    1. El nombre de la ruta más segura (basado en el destino).
    2. Un array de áreas o rutas bloqueadas.
    3. Tiempo estimado de evacuación (asume velocidad de caminata de 1.5 m/s).
    4. Nivel de prioridad/alerta (Rojo, Amarillo, Verde).
    5. Instrucciones paso a paso claras, precisas y calmadas para los trabajadores.
    6. Nombre del punto de encuentro óptimo.
    7. Coordenadas (lat, lng) del punto de inicio.
    8. Coordenadas (lat, lng) del punto de encuentro óptimo.\`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          rutaSegura: { type: Type.STRING },
          rutasBloqueadas: { type: Type.ARRAY, items: { type: Type.STRING } },
          tiempoEstimado: { type: Type.STRING },
          nivelAlerta: { type: Type.STRING, enum: ["Rojo", "Amarillo", "Verde"] },
          instrucciones: { type: Type.ARRAY, items: { type: Type.STRING } },
          puntoEncuentroNombre: { type: Type.STRING },
          startPoint: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ["lat", "lng"]
          },
          endPoint: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ["lat", "lng"]
          }
        },
        required: ["rutaSegura", "rutasBloqueadas", "tiempoEstimado", "nivelAlerta", "instrucciones", "puntoEncuentroNombre", "startPoint", "endPoint"]
      }
    }
  });

  return JSON.parse(response.text);
};`;

const startIndex = content.indexOf('export const calculateDynamicEvacuationRoute');
const endIndex = content.indexOf('};', startIndex) + 2;

content = content.substring(0, startIndex) + newFunction + content.substring(endIndex);

fs.writeFileSync('src/services/geminiService.ts', content);
console.log('geminiService.ts refactored successfully.');
