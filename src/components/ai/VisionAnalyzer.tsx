import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, Shield, AlertTriangle, Loader2, X, CheckCircle2, Info, Sparkles, Save, WifiOff } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { NodeType } from '../../types';
import { analyzeVisionImage } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useNotifications } from '../../contexts/NotificationContext';
import { logger } from '../../utils/logger';
import { respiratorPressureDrop } from '../../services/physics/bernoulliEngine';
import { generateRespiratorFatigueNode } from '../../services/zettelkasten/bernoulli';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { MedicalIcon } from '../medical/MedicalIcon';
// §2.18 (2026-05-22) — Detector EPP on-device (color-based heuristic).
// Procesa el pixel data del usuario sin enviarlo a Gemini. La imagen
// NUNCA sale del browser cuando se usa este path. Cloud Gemini sigue
// disponible como camino enriquecedor opcional (cuando isOnline).
import {
  getEppDetectorImpl,
  inspectImage,
  buildEppInspectionNode,
  type EppInspectionResult,
} from '../../services/ai/eppDetectorOnDevice';

// NIOSH 42 CFR Part 84 — typical N95 filter resistance and resting breathing flow.
const N95_FILTER_RESISTANCE_PA_S_PER_M3 = 800;
const RESTING_FLOW_M3_PER_S = 0.001;
const FATIGUE_REFERENCE_DROP_PA = 0.5; // heuristic: at 0.5 Pa, 8h shift sustainable.

const RESPIRATOR_KEYWORDS = ['respirador', 'mascarilla n95', 'mascarilla', 'filtro', 'n95'];

function detectsRespirator(result: { eppDetected: string[]; risksDetected: string[]; recommendations: string[]; summary: string }): boolean {
  const haystack = [
    ...result.eppDetected,
    ...result.risksDetected,
    ...result.recommendations,
    result.summary,
  ].join(' ').toLowerCase();
  return RESPIRATOR_KEYWORDS.some((k) => haystack.includes(k));
}

function estimateRespiratorFatiguePercent(
  projectId: string | null,
): { dropPa: number; sustainPercent: number } {
  const drop = respiratorPressureDrop(N95_FILTER_RESISTANCE_PA_S_PER_M3, RESTING_FLOW_M3_PER_S);
  // Heuristic: every Pa above the reference halves sustainable shift fraction.
  const raw = (1 - drop / FATIGUE_REFERENCE_DROP_PA) * 100;
  const clamped = Math.max(10, Math.min(100, raw));
  // Sprint 11: el nodo Bernoulli aterriza en zettelkasten_nodes/{idempotencyKey}
  // via writeNodesDebounced (2 s). Mantenemos el logger.info como debug aid.
  const node = generateRespiratorFatigueNode(
    { id: 'vision-worker', breathingFlowM3S: RESTING_FLOW_M3_PER_S },
    { id: 'n95-vision', filterResistancePaSPerM3: N95_FILTER_RESISTANCE_PA_S_PER_M3, maxPressureDropPa: FATIGUE_REFERENCE_DROP_PA },
    { temperatureC: 22 },
  );
  if (node) {
    logger.info('zettelkasten:respirator-fatigue', { node });
    if (projectId) writeNodesDebounced([node], { projectId });
  }
  return { dropPa: drop, sustainPercent: clamped };
}

interface AnalysisResult {
  eppDetected: string[];
  risksDetected: string[];
  recommendations: string[];
  summary: string;
}

const compressImage = (base64Str: string, maxWidth = 1080): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = maxWidth;
      const MAX_HEIGHT = maxWidth;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
  });
};

export function VisionAnalyzer() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const isOnline = useOnlineStatus();
  const { addNotification } = useNotifications();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setSaved(false);
      };
      reader.readAsDataURL(file);
    }
  };

  /**
   * §2.18 (2026-05-22) — Análisis EPP on-device REAL.
   *
   * Convierte el base64 a Blob + corre el detector heurístico de color
   * sobre el pixel data del usuario. La imagen NUNCA sale del browser.
   *
   * Devuelve un `EppInspectionResult` con detected / missing / lowConfidence
   * + métricas. El caller lo merge con el análisis cloud (Gemini) si
   * isOnline, o lo usa solo si offline.
   */
  const runOnDeviceEppAnalysis = async (
    base64Image: string,
  ): Promise<EppInspectionResult | null> => {
    try {
      // Convert base64 → Blob para el detector.
      const res = await fetch(base64Image);
      const blob = await res.blob();
      const detector = await getEppDetectorImpl('auto');
      const inspection = await inspectImage(blob, detector);
      return inspection;
    } catch (err) {
      logger.warn('[VisionAnalyzer] on-device EPP analysis failed', { err: String(err) });
      return null;
    }
  };

  const [onDeviceEppResult, setOnDeviceEppResult] = useState<EppInspectionResult | null>(null);

  const analyzeImage = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setSaved(false);
    setOnDeviceEppResult(null);
    try {
      // Compress image before any further processing.
      const compressedBase64 = await compressImage(image);

      // §2.18 (2026-05-22) — PASO 1: on-device EPP detection.
      // Esto SIEMPRE corre primero, online u offline. La imagen permanece
      // en el browser. Output: detected / missing / lowConfidence + bbox.
      const onDeviceResult = await runOnDeviceEppAnalysis(compressedBase64);
      if (onDeviceResult) {
        setOnDeviceEppResult(onDeviceResult);
      }

      // §2.18 — PASO 2 (opcional, online): Gemini cloud enrichment.
      // Cloud Gemini analiza riesgos contextuales + recomendaciones que
      // la heurística de color no puede inferir. Si offline, skip.
      if (isOnline) {
        const base64Data = compressedBase64.split(',')[1];
        try {
          const cloudAnalysis = await analyzeVisionImage(base64Data);
          // Merge cloud + on-device: cloud reporta riesgos y recomendaciones
          // textuales; on-device aporta EPP detectado/faltante calibrado
          // por color. La lista final de EPP detected viene del on-device
          // (más confiable porque el threshold está calibrado), pero
          // unimos con cloud si éste agregó EPPs no detectados localmente.
          const onDeviceEppNames = onDeviceResult
            ? onDeviceResult.detected.map((d) => d.class)
            : [];
          const mergedEpp = Array.from(
            new Set([...onDeviceEppNames, ...cloudAnalysis.eppDetected]),
          );
          setResult({
            ...cloudAnalysis,
            eppDetected: mergedEpp,
          });
        } catch (cloudErr) {
          // Si Gemini falla, usamos sólo el on-device — sin pop-up de error.
          logger.warn('[VisionAnalyzer] cloud Gemini failed, using on-device only', {
            err: String(cloudErr),
          });
          if (onDeviceResult) {
            setResult({
              eppDetected: onDeviceResult.detected.map((d) => d.class),
              risksDetected:
                onDeviceResult.missing.length > 0
                  ? [`EPP requerido faltante: ${onDeviceResult.missing.join(', ')}`]
                  : [],
              recommendations:
                onDeviceResult.missing.length > 0
                  ? [
                      `Asegurar uso de ${onDeviceResult.missing.join(', ')} antes de iniciar tareas (DS 594 art. 53-55).`,
                    ]
                  : ['No se detectaron EPP faltantes (heurística on-device).'],
              summary: `Análisis on-device — ${onDeviceResult.detected.length} EPP detectado(s), ${onDeviceResult.missing.length} faltante(s). Confianza promedio: ${Math.round(onDeviceResult.averageConfidence * 100)}%.`,
            });
          }
        }
      } else if (onDeviceResult) {
        // Offline: usamos exclusivamente el resultado on-device.
        setResult({
          eppDetected: onDeviceResult.detected.map((d) => d.class),
          risksDetected:
            onDeviceResult.missing.length > 0
              ? [`EPP requerido faltante: ${onDeviceResult.missing.join(', ')}`]
              : [],
          recommendations:
            onDeviceResult.missing.length > 0
              ? [
                  `Asegurar uso de ${onDeviceResult.missing.join(', ')} antes de iniciar tareas (DS 594 art. 53-55).`,
                ]
              : ['No se detectaron EPP faltantes (heurística on-device).'],
          summary: `Análisis on-device (offline) — ${onDeviceResult.detected.length} EPP detectado(s), ${onDeviceResult.missing.length} faltante(s). Confianza promedio: ${Math.round(onDeviceResult.averageConfidence * 100)}%.`,
        });
      } else {
        addNotification({
          title: 'Sin análisis disponible',
          message: 'No hay conexión y el detector on-device no pudo procesar la imagen.',
          type: 'error',
        });
        return;
      }

      addNotification({
        title: 'Análisis Completado',
        message: isOnline
          ? 'On-device + cloud Gemini procesados.'
          : 'Análisis on-device (offline) completo.',
        type: 'success',
      });
    } catch (err) {
      logger.error('Error analyzing image:', err);
      addNotification({
        title: 'Error de análisis',
        message: 'No se pudo procesar la imagen. Probá otra foto.',
        type: 'error',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!result || !selectedProject) return;
    setIsSaving(true);
    try {
      // PASO 1 — guardar el hallazgo Vision AI como NodeType.FINDING (legacy).
      await addNode({
        type: NodeType.FINDING,
        title: `Hallazgo IA: ${result.risksDetected[0]?.slice(0, 30) || 'Análisis de Visión'}...`,
        description: `Análisis de visión artificial realizado sobre imagen.\n\nResumen: ${result.summary}\n\nRiesgos: ${result.risksDetected.join(', ')}\n\nEPP: ${result.eppDetected.join(', ')}`,
        tags: ['Visión AI', 'Hallazgo', 'EPP', ...result.eppDetected],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          type: 'Vision Analysis',
          result: result,
          timestamp: new Date().toISOString()
        }
      });
      // §2.18 (2026-05-22) — PASO 2: si el on-device detector arrojó un
      // resultado, además persistimos un ZK node tipo `epp_inspection`
      // via writeNodesDebounced. Esto vincula la inspección visual con
      // el sistema Zettelkasten (relaciones requires/mitigates EPP).
      //
      // Privacy: `buildEppInspectionNode` jamás incluye la imagen en el
      // RiskNodePayload — solo classifications + bbox + métricas. Es el
      // contrato del módulo.
      if (onDeviceEppResult && user?.uid) {
        try {
          const eppNode = buildEppInspectionNode(onDeviceEppResult, {
            workerUid: user.uid, // self-inspection si supervisor toma foto propia
            projectId: selectedProject.id,
            authorUid: user.uid,
          });
          writeNodesDebounced([eppNode], { projectId: selectedProject.id });
        } catch (zkErr) {
          // ZK persistence no debe bloquear el save principal.
          logger.warn('[VisionAnalyzer] EPP ZK node write failed', { err: String(zkErr) });
        }
      }
      setSaved(true);
    } catch (error) {
      logger.error('Error saving vision finding:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 overflow-hidden">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
          <Camera className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Análisis de Visión AI</h2>
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Detección de EPP y Riesgos en tiempo real</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Section */}
        <div className="space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`aspect-video rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden relative ${
              image ? 'border-emerald-500/50' : 'border-zinc-300 dark:border-white/10 hover:border-blue-500/50 bg-zinc-100 dark:bg-zinc-800/30'
            }`}
          >
            {image ? (
              <>
                <img src={image || undefined} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <p className="text-white text-sm font-bold">Cambiar Imagen</p>
                </div>
              </>
            ) : (
              <div className="text-center p-6">
                <Upload className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Sube una foto o captura desde la cámara</p>
                <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-widest font-bold">JPG, PNG hasta 10MB</p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>

          {/* §2.18 (2026-05-22) — el botón ya NO requiere `isOnline`. El
              detector on-device corre offline; cloud Gemini es enrichment
              opcional. Offline el botón sigue activo. */}
          <button
            onClick={analyzeImage}
            disabled={!image || isAnalyzing}
            className={`w-full py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] ${
              isAnalyzing ? 'bg-blue-600/50 text-white cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/20'
            }`}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{isOnline ? 'On-device + Gemini…' : 'Procesando on-device…'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                <span>Iniciar Análisis EPP</span>
              </>
            )}
          </button>
          {/* §2.18 — Badge informativo del modo del análisis. */}
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-medium">
            {isOnline ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Online: on-device + Gemini (enrichment)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                <WifiOff className="w-3 h-3" />
                Offline: solo on-device (la imagen no sale del dispositivo)
              </span>
            )}
          </div>
        </div>

        {/* Results Section */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    EPP Detectado
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {result.eppDetected.map((item, i) => (
                      <span key={i} className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-emerald-500/20">
                        {item}
                      </span>
                    ))}
                    {result.eppDetected.length === 0 && <span className="text-zinc-500 text-xs italic">No se detectó EPP</span>}
                  </div>
                </div>

                <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-rose-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Riesgos Identificados
                  </h3>
                  <ul className="space-y-2">
                    {result.risksDetected.map((risk, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                        {risk}
                      </li>
                    ))}
                    {result.risksDetected.length === 0 && <li className="text-zinc-500 text-xs italic">No se detectaron riesgos críticos</li>}
                  </ul>
                </div>

                <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Recomendaciones
                  </h3>
                  <ul className="space-y-2">
                    {result.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>

                {detectsRespirator(result) && (() => {
                  const fatigue = estimateRespiratorFatiguePercent(selectedProject?.id ?? null);
                  return (
                    <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4">
                      <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Fatiga respiratoria (Bernoulli)
                        {/* Sprint 17c — Bioicons N95 + lungs decorate the respirator card. */}
                        <MedicalIcon name="mask-n95" size={16} alt="Mascarilla N95" />
                        <MedicalIcon name="lung-pair" size={16} alt="Pulmones" />
                      </h3>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300">
                        Fatiga respiratoria estimada: <span className="font-black text-amber-500">{fatigue.sustainPercent.toFixed(0)}%</span> del turno antes de requerir relevo.
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-1">
                        Δp filtro ≈ {fatigue.dropPa.toFixed(2)} Pa (R=800 Pa·s/m³, Q=0,001 m³/s reposo). Ref.: NIOSH 42 CFR Part 84.
                      </p>
                    </div>
                  );
                })()}

                <button
                  onClick={handleSave}
                  disabled={isSaving || saved || !selectedProject}
                  className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                    saved 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border border-emerald-500/20' 
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-white/10'
                  }`}
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : saved ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{saved ? 'Guardado en Red Neuronal' : 'Guardar Hallazgo'}</span>
                </button>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-zinc-200 dark:border-white/5 rounded-3xl bg-zinc-50 dark:bg-zinc-800/20">
                <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-zinc-400 dark:text-zinc-600" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold mb-2">Esperando Análisis</h3>
                <p className="text-xs text-zinc-500 max-w-[200px]">Sube una imagen para que el Guardián AI analice el entorno y detecte elementos de seguridad.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
