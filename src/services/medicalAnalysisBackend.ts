// Praeventio Guard — TODO.md §12.5.1: medical analysis backend split.
//
// Extracted from `geminiBackend.ts` (líneas 2913-3061) como parte del
// god-file split. Contiene los 4 endpoints médicos especializados:
//   - analyzeMedicalInjury — análisis de lesiones por zona corporal
//   - differentialDiagnosis — diagnóstico diferencial ocupacional
//   - checkDrugInteractions — interacciones medicamentosas
//   - generateMedicalIllustration — imágenes Gemini 2.0 image-gen
//
// Sigue el patrón ADR 0012: NUNCA reemplaza juicio médico, agrega
// disclaimer en `differentialDiagnosis` "no sustituye juicio clínico".
//
// El facade `geminiBackend.ts` re-exporta estos via
// `export * from './medicalAnalysisBackend.js'` por backwards-compat.

import { GoogleGenAI, Modality } from '@google/genai';
import {
  API_KEY,
  withExponentialBackoff,
  parseGeminiJson,
} from './gemini/_shared.js';

export interface InjuredRegion {
  id: string;
  label: string;
  severity: string | null;
  ds594Article?: string;
}

export interface MedicalInjuryAnalysis {
  anatomicalSystems: string[];
  specialistRequired: string;
  immediateActions: string[];
  ds594References: string[];
  diatCodes: string[];
  estimatedRecovery: string;
  workRestrictions: string[];
  severity: 'leve' | 'moderado' | 'grave' | 'crítico';
  requiresHospitalization: boolean;
}

export interface MedicalInjuryError {
  error: string;
}

export type MedicalInjuryResult = MedicalInjuryAnalysis | MedicalInjuryError;

/**
 * Analiza lesiones por zona corporal y produce diagnóstico ocupacional
 * estructurado (ICD-10 + DS 594 + DIAT codes). NO reemplaza atención
 * médica directa — el output es referencia para el prevencionista.
 */
export async function analyzeMedicalInjury(
  regions: InjuredRegion[],
): Promise<MedicalInjuryResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const injured = regions.filter((r) => r.severity !== null);
  if (injured.length === 0) {
    return { error: 'No se seleccionaron zonas lesionadas.' };
  }

  const regionsText = injured
    .map(
      (r) =>
        `- ${r.label} (severidad: ${r.severity}${r.ds594Article ? `, ${r.ds594Article}` : ''})`,
    )
    .join('\n');

  const prompt = `Eres un médico experto en salud ocupacional chilena (DS 594, DS 44/2024, Ley 16.744).
Analiza estas lesiones de accidente laboral y entrega un diagnóstico ocupacional estructurado en JSON.

ZONAS LESIONADAS:
${regionsText}

Responde ÚNICAMENTE con JSON válido con esta estructura exacta:
{
  "anatomicalSystems": ["sistemas anatómicos afectados"],
  "specialistRequired": "especialista médico recomendado",
  "immediateActions": ["acciones inmediatas de primeros auxilios"],
  "ds594References": ["artículos DS 594 aplicables"],
  "diatCodes": ["códigos DIAT correspondientes"],
  "estimatedRecovery": "tiempo estimado de recuperación",
  "workRestrictions": ["restricciones laborales recomendadas"],
  "severity": "leve | moderado | grave | crítico",
  "requiresHospitalization": boolean
}`;

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    return parseGeminiJson<MedicalInjuryAnalysis>(response);
  });
}

export interface DifferentialDiagnosisInput {
  symptoms: string;
  age?: number;
  sex?: 'M' | 'F' | 'O';
  occupation?: string;
  exposures?: string;
  vitals?: string;
}

export interface DifferentialDiagnosisCandidate {
  condition: string;
  icd10: string;
  probability: 'alta' | 'media' | 'baja';
  rationale: string;
}

export interface DifferentialDiagnosisResult {
  differentialDiagnosis: DifferentialDiagnosisCandidate[];
  occupationalRelevance: string;
  recommendedExams: string[];
  recommendedSurveillance:
    | 'PREXOR'
    | 'PLANESI'
    | 'TMERT'
    | 'EVAST'
    | 'PVE genérico'
    | 'ninguno';
  redFlags: string[];
  suggestedTreatment: string;
  diatRequired: boolean;
  specialistReferral: string | null;
}

/**
 * Diagnóstico diferencial ocupacional según Ley 16.744 + DS 109 +
 * MINSAL. Disclaimer: el tratamiento sugerido NO sustituye juicio
 * clínico. Lista 3-5 diagnósticos diferenciales ordenados por
 * probabilidad.
 */
export async function differentialDiagnosis(
  params: DifferentialDiagnosisInput,
): Promise<DifferentialDiagnosisResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const prompt = `Eres un médico ocupacional chileno experto (Ley 16.744, DS 594, DS 109, MINSAL).
Realiza un análisis de diagnóstico diferencial para un trabajador con estos datos:

SÍNTOMAS: ${params.symptoms}
${params.age ? `EDAD: ${params.age} años` : ''}
${params.sex ? `SEXO: ${params.sex}` : ''}
${params.occupation ? `OCUPACIÓN: ${params.occupation}` : ''}
${params.exposures ? `EXPOSICIONES LABORALES: ${params.exposures}` : ''}
${params.vitals ? `SIGNOS VITALES: ${params.vitals}` : ''}

Responde EXCLUSIVAMENTE con JSON válido:
{
  "differentialDiagnosis": [
    { "condition": "nombre", "icd10": "código CIE-10", "probability": "alta|media|baja", "rationale": "razonamiento clínico breve" }
  ],
  "occupationalRelevance": "¿es enfermedad profesional según Ley 16.744? Cita normativa",
  "recommendedExams": ["examen 1", "examen 2"],
  "recommendedSurveillance": "PREXOR | PLANESI | TMERT | EVAST | PVE genérico | ninguno",
  "redFlags": ["señal de alarma 1"],
  "suggestedTreatment": "tratamiento inicial recomendado, NO sustituye juicio clínico",
  "diatRequired": boolean,
  "specialistReferral": "especialista a referir o null"
}

Lista 3-5 diagnósticos diferenciales ordenados por probabilidad. Sé clínicamente preciso.`;

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    return parseGeminiJson<DifferentialDiagnosisResult>(response);
  });
}

export interface DrugInteraction {
  drugs: [string, string];
  severity: 'leve' | 'moderada' | 'grave' | 'contraindicada';
  mechanism: string;
  clinicalEffect: string;
  recommendation: string;
}

export interface DrugInteractionsResult {
  interactions: DrugInteraction[];
  overallRisk: 'bajo' | 'medio' | 'alto';
  warnings: string[];
}

/**
 * Análisis farmacológico de interacciones medicamentosas. Útil para
 * el médico ocupacional cuando trabaja con polifarmacia (típico en
 * trabajadores mayores). NO sustituye revisión farmacéutica clínica.
 */
export async function checkDrugInteractions(
  drugs: string[],
  patientContext?: string,
): Promise<DrugInteractionsResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const prompt = `Eres farmacéutico clínico chileno. Analiza interacciones medicamentosas:

MEDICAMENTOS: ${drugs.join(', ')}
${patientContext ? `CONTEXTO PACIENTE: ${patientContext}` : ''}

Responde EXCLUSIVAMENTE con JSON válido:
{
  "interactions": [
    { "drugs": ["A","B"], "severity": "leve|moderada|grave|contraindicada", "mechanism": "...", "clinicalEffect": "...", "recommendation": "..." }
  ],
  "overallRisk": "bajo|medio|alto",
  "warnings": ["alerta 1"]
}`;

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    return parseGeminiJson<DrugInteractionsResult>(response);
  });
}

export interface MedicalIllustrationSuccess {
  imageBase64: string;
  mimeType: string;
}

export type MedicalIllustrationResult =
  | MedicalIllustrationSuccess
  | { error: string };

/**
 * Genera ilustración anatómica vía Gemini 2.0 image-generation con
 * paleta teal/petroleum + gold (Praeventio brand). Estilo libro
 * médico, NO photorealistic, NO gráfico/sangriento. Para DIAT
 * documentation.
 */
export async function generateMedicalIllustration(
  regions: { id: string; label: string; severity: string | null }[],
  specialistContext?: string,
): Promise<MedicalIllustrationResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const injured = regions.filter((r) => r.severity !== null);
  if (injured.length === 0) return { error: 'Sin zonas para ilustrar' };

  const regionList = injured.map((r) => `${r.label} (${r.severity})`).join(', ');

  const prompt = `Professional medical anatomical illustration in editorial style, clean white background.
Show the human body with focus on these injured regions: ${regionList}.
Use soft teal/petroleum blue palette with gold accents (matching Guardian Praeventio brand).
Style: clean medical textbook illustration, NOT photorealistic, NOT graphic/bloody.
Show anatomical labels with subtle arrows pointing to affected areas.
Educational and professional — suitable for occupational health DIAT documentation in Chile.
${specialistContext ? `Context: ${specialistContext}` : ''}
No text overlays. Purely visual anatomical reference.`;

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? 'image/png',
        };
      }
    }
    return { error: 'No se generó imagen' };
  });
}
