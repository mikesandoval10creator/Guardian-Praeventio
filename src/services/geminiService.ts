import { auth } from './firebase';

const callGeminiAPI = async (action: string, args: any[]) => {
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, args }),
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  } catch (error) {
    console.error(`Error calling Gemini API for ${action}:`, error);
    throw error;
  }
};

export const generateEmbeddingsBatch = async (texts: string[]): Promise<number[][]> => callGeminiAPI('generateEmbeddingsBatch', [texts]);
export const autoConnectNodes = async (newNode: any, existingNodes: any[]): Promise<string[]> => callGeminiAPI('autoConnectNodes', [newNode, existingNodes]);
export const semanticSearch = async (query: string, nodes: any[], topK: number = 3): Promise<any[]> => callGeminiAPI('semanticSearch', [query, nodes, topK]);
export const analyzeFastCheck = async (observation: string) => callGeminiAPI('analyzeFastCheck', [observation]);
export const predictGlobalIncidents = async (context: string, envContext: string) => callGeminiAPI('predictGlobalIncidents', [context, envContext]);
export const analyzeRiskWithAI = async (description: string, nodesContext: string, industry?: string) => callGeminiAPI('analyzeRiskWithAI', [description, nodesContext, industry]);
export const analyzePostureWithAI = async (base64Image: string, mimeType: string) => callGeminiAPI('analyzePostureWithAI', [base64Image, mimeType]);
export const generateEmergencyPlan = async (projectName: string, context: string, industry?: string) => callGeminiAPI('generateEmergencyPlan', [projectName, context, industry]);
export const analyzeSafetyImage = async (base64Image: string, mimeType: string, context: string) => callGeminiAPI('analyzeSafetyImage', [base64Image, mimeType, context]);
export const generateISOAuditChecklist = async (topic: string, context: string) => callGeminiAPI('generateISOAuditChecklist', [topic, context]);
export const generatePTS = async (taskName: string, taskDescription: string, riskLevel: string, normative: string, glossary: any, envContext: string, zkContext: string, documentType: string) => callGeminiAPI('generatePTS', [taskName, taskDescription, riskLevel, normative, glossary, envContext, zkContext, documentType]);
export const generatePTSWithManufacturerData = async (taskName: string, taskDescription: string, machineryDetails: string, riskLevel: string, normative: string, glossary: any, envContext: string, zkContext: string, documentType: string) => callGeminiAPI('generatePTSWithManufacturerData', [taskName, taskDescription, machineryDetails, riskLevel, normative, glossary, envContext, zkContext, documentType]);
export const generateEmergencyScenario = async (context: string) => callGeminiAPI('generateEmergencyScenario', [context]);
export const generateRealisticIoTEvent = async (context: string) => callGeminiAPI('generateRealisticIoTEvent', [context]);
export const processDocumentToNodes = async (text: string) => callGeminiAPI('processDocumentToNodes', [text]);
export const simulateRiskPropagation = async (nodeTitle: string, context: string) => callGeminiAPI('simulateRiskPropagation', [nodeTitle, context]);
export const enrichNodeData = async (nodeData: any) => callGeminiAPI('enrichNodeData', [nodeData]);
export const analyzeRootCauses = async (riskTitle: string, riskDescription: string, context: string) => callGeminiAPI('analyzeRootCauses', [riskTitle, riskDescription, context]);
export const queryBCN = async (query: string) => callGeminiAPI('queryBCN', [query]);
export const getChatResponse = async (message: string, context: string, history: { role: string, content: string }[] = [], detailLevel: number = 1) => callGeminiAPI('getChatResponse', [message, context, history, detailLevel]);
export const getSafetyAdvice = async (weather: any) => callGeminiAPI('getSafetyAdvice', [weather]);
export const generateActionPlan = async (findingTitle: string, findingDescription: string = '', severity: string = 'Media', workerProposal?: string) => callGeminiAPI('generateActionPlan', [findingTitle, findingDescription, severity, workerProposal]);
export const generateSafetyReport = async (reportType: 'PTS' | 'PE' | 'AST', context: string) => callGeminiAPI('generateSafetyReport', [reportType, context]);
export const auditAISuggestion = async (suggestion: string, context: string) => callGeminiAPI('auditAISuggestion', [suggestion, context]);
export const generatePersonalizedSafetyPlan = async (workerName: string, role: string, history: string, projectRisks: string) => callGeminiAPI('generatePersonalizedSafetyPlan', [workerName, role, history, projectRisks]);
export const analyzeDocumentCompliance = async (documentText: string, normativeContext: string) => callGeminiAPI('analyzeDocumentCompliance', [documentText, normativeContext]);
export const generateTrainingRecommendations = async (workerName: string, workerRole: string, context: string) => callGeminiAPI('generateTrainingRecommendations', [workerName, workerRole, context]);
export const investigateIncidentWithAI = async (incidentTitle: string, incidentDescription: string, context: string) => callGeminiAPI('investigateIncidentWithAI', [incidentTitle, incidentDescription, context]);
export const auditProjectComplianceWithAI = async (projectName: string, projectContext: string, normativeContext: string) => callGeminiAPI('auditProjectComplianceWithAI', [projectName, projectContext, normativeContext]);
export const analyzeAttendancePatterns = async (projectName: string, attendanceData: string) => callGeminiAPI('analyzeAttendancePatterns', [projectName, attendanceData]);
export const generateSafetyCapsule = async (workerName: string, role: string, context: string) => callGeminiAPI('generateSafetyCapsule', [workerName, role, context]);
export const suggestRisksWithAI = async (industry: string, context: string) => callGeminiAPI('suggestRisksWithAI', [industry, context]);
export const suggestNormativesWithAI = async (industry: string) => callGeminiAPI('suggestNormativesWithAI', [industry]);
export const generateCompensatoryExercises = async (fatigue: number, posture: number, attention: number) => callGeminiAPI('generateCompensatoryExercises', [fatigue, posture, attention]);
export const analyzeBioImage = async (base64Image: string) => callGeminiAPI('analyzeBioImage', [base64Image]);
export const generatePredictiveForecast = async (projectName: string, context: string, weatherContext?: string) => callGeminiAPI('generatePredictiveForecast', [projectName, context, weatherContext]);
export const generateOperationalTasks = async (normativeTitle: string, normativeDescription: string): Promise<string[]> => callGeminiAPI('generateOperationalTasks', [normativeTitle, normativeDescription]);
export const generateEmergencyPlanJSON = async (scenario: string, description: string, normative: string, industry?: string) => callGeminiAPI('generateEmergencyPlanJSON', [scenario, description, normative, industry]);
export const forecastSafetyEvents = async (nodesContext: string, historicalData?: string) => callGeminiAPI('forecastSafetyEvents', [nodesContext, historicalData]);
export const analyzeRiskNetwork = async (nodesContext: string) => callGeminiAPI('analyzeRiskNetwork', [nodesContext]);
export const predictAccidents = async (nodesContext: string, telemetryContext: string) => callGeminiAPI('predictAccidents', [nodesContext, telemetryContext]);
export const analyzeSiteMapDensity = async (nodesContext: string, workersContext: string, assetsContext: string) => callGeminiAPI('analyzeSiteMapDensity', [nodesContext, workersContext, assetsContext]);
export const generateTrainingQuiz = async (topic: string, description: string) => callGeminiAPI('generateTrainingQuiz', [topic, description]);
export const validateRiskImageClick = async (imageBase64: string, x: number, y: number, width: number, height: number, gameContext: string = '') => callGeminiAPI('validateRiskImageClick', [imageBase64, x, y, width, height, gameContext]);
export const calculateDynamicEvacuationRoute = async (activeEmergencies: any[], workers: any[], machinery: any[], userBlockedAreas: string[] = []) => callGeminiAPI('calculateDynamicEvacuationRoute', [activeEmergencies, workers, machinery, userBlockedAreas]);
export const processAudioWithAI = async (base64Audio: string) => callGeminiAPI('processAudioWithAI', [base64Audio]);
export const analyzeVisionImage = async (base64Image: string) => callGeminiAPI('analyzeVisionImage', [base64Image]);
export const verifyEPPWithAI = async (base64Image: string, workerName: string, requiredEPP: string[]) => callGeminiAPI('verifyEPPWithAI', [base64Image, workerName, requiredEPP]);
export const analyzeRiskNetworkHealth = async (nodes: any[]) => callGeminiAPI('analyzeRiskNetworkHealth', [nodes]);
export const analyzeFeedPostForRiskNetwork = async (content: string, imageBase64: string | null, userName: string) => callGeminiAPI('analyzeFeedPostForRiskNetwork', [content, imageBase64, userName]);
export const analyzePsychosocialRisks = async (surveyResults: any[], organizationalContext: string) => callGeminiAPI('analyzePsychosocialRisks', [surveyResults, organizationalContext]);
export const auditLegalGap = async (companyProcedures: any[], applicableNormatives: any[]) => callGeminiAPI('auditLegalGap', [companyProcedures, applicableNormatives]);
export const evaluateNormativeImpact = async (newNormativeText: string, currentOperations: any[]) => callGeminiAPI('evaluateNormativeImpact', [newNormativeText, currentOperations]);
export const analyzeChemicalRisk = async (sdsText: string, storageConditions: string) => callGeminiAPI('analyzeChemicalRisk', [sdsText, storageConditions]);
export const suggestChemicalSubstitution = async (currentChemical: string, purpose: string) => callGeminiAPI('suggestChemicalSubstitution', [currentChemical, purpose]);
export const generateStressPreventionTips = async (role: string, criticalRisks: string[]) => callGeminiAPI('generateStressPreventionTips', [role, criticalRisks]);
export const generateShiftHandoverInsights = async (previousShiftEvents: any[], currentRisks: any[]) => callGeminiAPI('generateShiftHandoverInsights', [previousShiftEvents, currentRisks]);
export const analyzeShiftFatiguePatterns = async (attendanceData: any[]) => callGeminiAPI('analyzeShiftFatiguePatterns', [attendanceData]);
export const generateCustomSafetyTraining = async (gapDescription: string, audienceProfile: string, industry: string) => callGeminiAPI('generateCustomSafetyTraining', [gapDescription, audienceProfile, industry]);
export const optimizePPEInventory = async (currentStock: any[], consumptionHistory: any[], headcountByRisk: any) => callGeminiAPI('optimizePPEInventory', [currentStock, consumptionHistory, headcountByRisk]);
export const calculateStructuralLoad = async (element: string, specs: string) => callGeminiAPI('calculateStructuralLoad', [element, specs]);
export const designHazmatStorage = async (storageType: string, volume: number, materialClass: string) => callGeminiAPI('designHazmatStorage', [storageType, volume, materialClass]);
export const evaluateMinsalCompliance = async (protocolTitle: string, context: string, industry?: string) => callGeminiAPI('evaluateMinsalCompliance', [protocolTitle, context, industry]);
export const generateModuleRecommendations = async (moduleName: string, industry: string, networkContext: string) => callGeminiAPI('generateModuleRecommendations', [moduleName, industry, networkContext]);
export const generateExecutiveSummary = async (stats: any, nodes: any[]) => callGeminiAPI('generateExecutiveSummary', [stats, nodes]);
export const analyzeFaenaRiskWithAI = async (industry: string, context: string, envContext: string) => callGeminiAPI('analyzeFaenaRiskWithAI', [industry, context, envContext]);
export const extractAcademicSummary = async (text: string) => callGeminiAPI('extractAcademicSummary', [text]);
export const calculateComplianceSummary = async (projectId: string, nodes: any[]) => callGeminiAPI('calculateComplianceSummary', [projectId, nodes]);
export const processGlobalSafetyAudit = async (projectId: string, projectData: any) => callGeminiAPI('processGlobalSafetyAudit', [projectId, projectData]);
export const calculatePreventionROI = async (projectData: any) => callGeminiAPI('calculatePreventionROI', [projectData]);
export const generateSusesoFormMetadata = async (incident: any, projectContext: any) => callGeminiAPI('generateSusesoFormMetadata', [incident, projectContext]);
export const predictEPPReplacement = async (eppItem: any, usageData: any) => callGeminiAPI('predictEPPReplacement', [eppItem, usageData]);
export const auditEPPCompliance = async (workerId: string, assignedEPP: any[], requiredEPP: any[]) => callGeminiAPI('auditEPPCompliance', [workerId, assignedEPP, requiredEPP]);
export const suggestMeetingAgenda = async (projectRisks: any[], pendingAgreements: any[]) => callGeminiAPI('suggestMeetingAgenda', [projectRisks, pendingAgreements]);
export const summarizeAgreements = async (rawMeetingNotes: string) => callGeminiAPI('summarizeAgreements', [rawMeetingNotes]);
export const mapRisksToSurveillance = async (risks: any[]) => callGeminiAPI('mapRisksToSurveillance', [risks]);
export const analyzeHealthPatterns = async (medicalRecords: any[]) => callGeminiAPI('analyzeHealthPatterns', [medicalRecords]);
export const analyzeRiskCorrelations = async (nodes: any[], events: any[]) => callGeminiAPI('analyzeRiskCorrelations', [nodes, events]);
