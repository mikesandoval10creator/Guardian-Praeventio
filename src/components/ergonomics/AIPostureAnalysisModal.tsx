import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  Loader2,
  AlertTriangle,
  Activity,
  CheckCircle2,
  ScanFace,
  BrainCircuit,
  Cpu,
} from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { logger } from '../../utils/logger';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../shared/ToastContainer';
import { useMediaPipePose, type PoseLandmark } from '../../hooks/useMediaPipePose';
import {
  landmarksToRebaInput,
  landmarksToRulaInput,
  LM,
} from '../../services/ergonomics/landmarksToScore';
import { calculateReba } from '../../services/ergonomics/reba';
import { calculateRula } from '../../services/ergonomics/rula';

interface AIPostureAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

// TODO Bucket OO.4 (Sprint 25 ola siguiente): modo "Análisis en vivo".
// Requiere getUserMedia(video) → <video> ref → useMediaPipePose.analyzeVideo
// (extender el hook para frames continuos), throttle a 0.5 Hz (cada 2s) para
// REBA/RULA, indicador semáforo verde/amarillo/rojo, grabación 30s con
// ring-buffer de frames y selección automática del peor (max REBA finalScore).
// Reuse: useMediaPipePose, calculateReba, landmarksToRebaInput. No tocar el
// flujo de fotos estático actual.

// Resultado del análisis postural on-device (MediaPipe Pose → REBA/RULA).
// Directiva #12 + privacidad: la imagen del trabajador NUNCA sale del
// dispositivo. A la nube va sólo el RESULTADO (scores/hallazgos) como
// registro de prevención — ver `handleSave`. `source` se conserva
// (siempre 'mediapipe') para tags/auditoría.
interface UnifiedResult {
  source: 'mediapipe';
  /** Score normalizado 1..10 para la UI heredada. */
  score: number;
  findings: string[];
  recommendations: string[];
  bodyParts: { neck: string; trunk: string; arms: string; legs: string };
  // Detalle MediaPipe / determinista.
  reba?: number;
  rebaLevel?: string;
  rula?: number;
  rulaLevel?: number;
  landmarks?: PoseLandmark[];
}

/** Map del actionLevel REBA a un score 1..10 visible. */
function rebaToVisualScore(reba: number): number {
  // REBA 1..15 → 1..10. Redondea conservadoramente.
  return Math.min(10, Math.max(1, Math.round((reba / 15) * 10)));
}

export function AIPostureAnalysisModal({
  isOpen,
  onClose,
  projectId,
}: AIPostureAnalysisModalProps) {
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<UnifiedResult | null>(null);
  const [workstation, setWorkstation] = useState('');
  const [loadKg, setLoadKg] = useState<number>(0);
  const [statusLine, setStatusLine] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const { toasts, show: showToast, dismiss } = useToast();
  const { analyzeImage, error: poseError } = useMediaPipePose();

  // Re-pinta el overlay del esqueleto cuando se actualizan los landmarks.
  useEffect(() => {
    const lms = analysisResult?.landmarks;
    const canvas = overlayCanvasRef.current;
    const img = imgRef.current;
    if (!lms || !canvas || !img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#10b981';
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    // Conexiones clave (subset de POSE_CONNECTIONS para esqueleto principal).
    const PAIRS: [number, number][] = [
      [LM.L_SHOULDER, LM.R_SHOULDER],
      [LM.L_SHOULDER, LM.L_ELBOW],
      [LM.L_ELBOW, LM.L_WRIST],
      [LM.R_SHOULDER, LM.R_ELBOW],
      [LM.R_ELBOW, LM.R_WRIST],
      [LM.L_SHOULDER, LM.L_HIP],
      [LM.R_SHOULDER, LM.R_HIP],
      [LM.L_HIP, LM.R_HIP],
      [LM.L_HIP, LM.L_KNEE],
      [LM.L_KNEE, LM.L_ANKLE],
      [LM.R_HIP, LM.R_KNEE],
      [LM.R_KNEE, LM.R_ANKLE],
      [LM.NOSE, LM.L_SHOULDER],
      [LM.NOSE, LM.R_SHOULDER],
    ];
    for (const [a, b] of PAIRS) {
      const la = lms[a];
      const lb = lms[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
      ctx.stroke();
    }
    for (const lm of lms) {
      if (!lm || (lm.visibility ?? 0) < 0.4) continue;
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [analysisResult]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        // The image is rendered into <img ref={imgRef}> and analyzed fully
        // on-device by MediaPipe Pose. It is NOT base64-extracted for upload
        // anymore — the worker's photo never leaves the device (directiva #12).
        setImagePreview(reader.result as string);
        setAnalysisResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  /** Path primario: MediaPipe Pose Landmarker → REBA + RULA. */
  const analyzeWithMediaPipe = async (): Promise<UnifiedResult | null> => {
    if (!imgRef.current || !imgRef.current.complete) return null;
    setStatusLine('Cargando modelo MediaPipe Pose…');
    const pose = await analyzeImage(imgRef.current);
    setStatusLine('Calculando REBA / RULA…');

    const rebaInput = landmarksToRebaInput(pose.landmarks, { loadKg });
    const rulaInput = landmarksToRulaInput(pose.landmarks, { loadKg });
    const reba = calculateReba(rebaInput);
    const rula = calculateRula(rulaInput);

    const findings: string[] = [];
    if (rebaInput.trunk.flexionDeg > 20)
      findings.push(`Tronco flexionado ${Math.round(rebaInput.trunk.flexionDeg)}°`);
    if (rebaInput.neck.flexionDeg > 20)
      findings.push(`Cuello flexionado ${Math.round(rebaInput.neck.flexionDeg)}°`);
    if (rebaInput.upperArm.flexionDeg > 45)
      findings.push(
        `Brazo elevado ${Math.round(rebaInput.upperArm.flexionDeg)}° (peor lado)`
      );
    if (rebaInput.legs.kneeFlexionDeg > 30)
      findings.push(`Rodilla flexionada ${Math.round(rebaInput.legs.kneeFlexionDeg)}°`);
    if (!rebaInput.legs.bilateralSupport)
      findings.push('Apoyo unilateral / piernas desbalanceadas');
    if (findings.length === 0) findings.push('Sin desviaciones articulares relevantes');

    return {
      source: 'mediapipe',
      score: rebaToVisualScore(reba.finalScore),
      findings,
      recommendations: [reba.recommendation, rula.recommendation],
      bodyParts: {
        neck: `Cuello flex ${Math.round(rebaInput.neck.flexionDeg)}° (REBA neck score)`,
        trunk: `Tronco flex ${Math.round(rebaInput.trunk.flexionDeg)}°`,
        arms: `Brazo flex ${Math.round(rebaInput.upperArm.flexionDeg)}° / codo ${Math.round(rebaInput.lowerArm.flexionDeg)}°`,
        legs: rebaInput.legs.bilateralSupport
          ? `Apoyo bilateral, rodilla ${Math.round(rebaInput.legs.kneeFlexionDeg)}°`
          : 'Apoyo unilateral',
      },
      reba: reba.finalScore,
      rebaLevel: reba.actionLevel,
      rula: rula.finalScore,
      rulaLevel: rula.actionLevel,
      landmarks: pose.landmarks,
    };
  };

  const handleAnalyze = async () => {
    if (!imagePreview) return;
    setLoading(true);
    try {
      // Directiva #12 + privacidad: el análisis postural es 100% on-device
      // (MediaPipe Pose → REBA/RULA). La imagen del trabajador NO sale del
      // dispositivo — no hay fallback cloud. Si no se detecta la pose, se
      // pide otra foto en lugar de subir la imagen a un servicio externo.
      let result: UnifiedResult | null = null;
      try {
        result = await analyzeWithMediaPipe();
      } catch (e) {
        logger.warn('MediaPipe posture analysis failed', e);
      }
      if (!result) {
        showToast(
          'No se detectó la pose. Asegúrate de que se vea el cuerpo completo y bien iluminado, e intenta con otra foto.',
          'error'
        );
        return;
      }
      setAnalysisResult(result);
    } catch (error) {
      logger.error('Error analyzing posture:', error);
      showToast('Hubo un error al analizar la imagen. Por favor, intenta de nuevo.', 'error');
    } finally {
      setLoading(false);
      setStatusLine('');
    }
  };

  const handleSave = async () => {
    if (!analysisResult || !workstation) return;

    setSaving(true);
    try {
      const riskLevel =
        analysisResult.score >= 7 ? 'high' : analysisResult.score >= 4 ? 'medium' : 'low';

      const tags = ['ergonomia', 'postura', riskLevel, analysisResult.source];
      if (analysisResult.reba != null)
        tags.push(`reba-${analysisResult.reba}`);
      if (analysisResult.rula != null)
        tags.push(`rula-${analysisResult.rula}`);

      await addNode({
        type: NodeType.ERGONOMICS,
        title: `Análisis Postural - ${workstation}`,
        description: `Evaluación postural en ${workstation}. Fuente: MediaPipe Pose + REBA/RULA (on-device). Score: ${analysisResult.score}/10. Hallazgos: ${analysisResult.findings.join(', ')}`,
        tags,
        metadata: {
          workstation,
          assessmentType: 'MediaPipe Pose + REBA/RULA determinista (on-device)',
          risk: riskLevel,
          observations: `Hallazgos: ${analysisResult.findings.join('. ')}\n\nRecomendaciones: ${analysisResult.recommendations.join('. ')}\n\nEstado Corporal:\n- Cuello: ${analysisResult.bodyParts.neck}\n- Tronco: ${analysisResult.bodyParts.trunk}\n- Brazos: ${analysisResult.bodyParts.arms}\n- Piernas: ${analysisResult.bodyParts.legs}`,
          status: 'completed',
          date: new Date().toISOString().split('T')[0],
          aiScore: analysisResult.score,
          rebaScore: analysisResult.reba,
          rebaLevel: analysisResult.rebaLevel,
          rulaScore: analysisResult.rula,
          rulaLevel: analysisResult.rulaLevel,
          loadKg,
          source: analysisResult.source,
        },
        connections: [],
        projectId,
      });

      handleClose();
    } catch (error) {
      logger.error('Error saving AI ergonomics node:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setImagePreview(null);
    setAnalysisResult(null);
    setWorkstation('');
    setLoadKg(0);
    setStatusLine('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          <div
            onClick={handleClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <BrainCircuit className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                    Bio-Análisis Postural
                  </h2>
                  <p className="text-sm text-zinc-400">
                    MediaPipe Pose + REBA / RULA determinista
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {!imagePreview ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-xl p-12 flex flex-col items-center justify-center gap-4 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera className="w-8 h-8 text-zinc-400 group-hover:text-indigo-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-zinc-900 dark:text-white font-medium">
                      Sube una foto del trabajador (cuerpo completo)
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">
                      Formatos: JPG, PNG. El esqueleto se detecta on-device.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-white/10">
                    <img
                      ref={imgRef}
                      src={imagePreview}
                      alt="Preview"
                      className="max-w-full max-h-full object-contain"
                      crossOrigin="anonymous"
                    />
                    {analysisResult && (
                      <canvas
                        ref={overlayCanvasRef}
                        className="absolute inset-0 w-full h-full pointer-events-none"
                      />
                    )}
                    {!analysisResult && !loading && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute top-4 right-4 bg-white/80 dark:bg-black/50 backdrop-blur-md text-zinc-900 dark:text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-white dark:hover:bg-black/70 transition-colors border border-zinc-200 dark:border-white/10"
                      >
                        Cambiar Imagen
                      </button>
                    )}
                  </div>

                  {!analysisResult ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                            Carga manipulada (kg, opcional)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={loadKg}
                            onChange={(e) => setLoadKg(Number(e.target.value) || 0)}
                            className="mt-2 w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-lg py-2.5 px-3 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm"
                          />
                        </div>
                      </div>
                      <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="w-full py-3 rounded-xl font-medium text-sm transition-all shadow-lg flex items-center justify-center gap-2 bg-indigo-500 text-white hover:bg-indigo-600 shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>{statusLine || 'Analizando…'}</span>
                          </>
                        ) : (
                          <>
                            <ScanFace className="w-5 h-5" />
                            <span>Iniciar Bio-Análisis</span>
                          </>
                        )}
                      </button>
                      <p className="text-xs text-zinc-500 flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                        Análisis 100% on-device: la imagen no sale de tu dispositivo.
                      </p>
                      {poseError && (
                        <p className="text-xs text-rose-500">
                          MediaPipe error previo: {poseError}
                        </p>
                      )}
                    </>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/5">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Cpu className="w-3 h-3 text-emerald-400" />
                            REBA / RULA (on-device)
                          </h3>
                          <div className="flex items-end gap-3">
                            <span
                              className={`text-4xl font-black ${
                                analysisResult.score >= 7
                                  ? 'text-rose-500'
                                  : analysisResult.score >= 4
                                    ? 'text-amber-500'
                                    : 'text-emerald-500'
                              }`}
                            >
                              {analysisResult.score}
                            </span>
                            <span className="text-zinc-500 mb-1 font-medium">/ 10</span>
                            {analysisResult.reba != null && (
                              <span className="text-xs text-zinc-400 mb-1">
                                REBA {analysisResult.reba} · RULA {analysisResult.rula}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/5">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                            Puesto de Trabajo
                          </h3>
                          <input
                            type="text"
                            value={workstation}
                            onChange={(e) => setWorkstation(e.target.value)}
                            placeholder="Ej: Operador de Grúa"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-lg py-2.5 px-3 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <h3 className="text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            Hallazgos
                          </h3>
                          <ul className="space-y-2">
                            {analysisResult.findings.map((finding, i) => (
                              <li
                                key={i}
                                className="text-sm text-zinc-400 bg-zinc-800/30 p-3 rounded-xl border border-white/5"
                              >
                                {finding}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            Recomendaciones
                          </h3>
                          <ul className="space-y-2">
                            {analysisResult.recommendations.map((rec, i) => (
                              <li
                                key={i}
                                className="text-sm text-zinc-400 bg-zinc-800/30 p-3 rounded-xl border border-white/5"
                              >
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="bg-zinc-800/30 rounded-xl p-4 border border-white/5 space-y-3">
                        <h3 className="text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
                          <Activity className="w-4 h-4 text-indigo-400" />
                          Análisis Segmentado
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Cuello</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.neck}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Tronco</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.trunk}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Brazos</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.arms}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Piernas</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.legs}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>

            {analysisResult && (
              <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex justify-end gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-900 dark:text-white bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !workstation}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Evaluación</span>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/jpeg, image/png"
        className="hidden"
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </AnimatePresence>
  );
}
