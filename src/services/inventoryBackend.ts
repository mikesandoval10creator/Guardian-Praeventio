import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const optimizePPEInventory = async (currentStock: any[], consumptionHistory: any[], headcountByRisk: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un analista de cadena de suministro especializado en EPP.
    
    Inventario Actual:
    ${JSON.stringify(currentStock)}
    
    Historial de Consumo:
    ${JSON.stringify(consumptionHistory)}
    
    Dotación por Riesgo (Trabajadores):
    ${JSON.stringify(headcountByRisk)}
    
    Calcula:
    1. Productos en riesgo de quiebre de stock en los próximos 15 días.
    2. Órdenes de compra sugeridas con justificación basada en la criticidad del riesgo.
    3. Alternativas de productos si hay quiebre de stock.
    
    Respuesta en JSON:
    {
      "criticalStockOuts": [
        { "item": "string", "daysRemaining": number, "logic": "string" }
      ],
      "suggestedOrders": [
        { "item": "string", "quantity": number, "priority": "Crítica" | "Normal" }
      ],
      "optimizations": ["string"]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criticalStockOuts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING },
                daysRemaining: { type: Type.NUMBER },
                logic: { type: Type.STRING }
              },
              required: ["item", "daysRemaining", "logic"]
            }
          },
          suggestedOrders: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                priority: { type: Type.STRING }
              },
              required: ["item", "quantity", "priority"]
            }
          },
          optimizations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["criticalStockOuts", "suggestedOrders", "optimizations"]
      }
    }
  });

  return JSON.parse(response.text);
};
