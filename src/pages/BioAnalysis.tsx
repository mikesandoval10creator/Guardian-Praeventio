import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Activity, Camera, AlertTriangle, CheckCircle2, RefreshCw, Eye, User, Shield, Zap, Save, LineChart as LineChartIcon, HeartPulse } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { CompensatoryExercisesModal } from '../components/bio/CompensatoryExercisesModal';
import { MedicalIcon } from '../components/medical/MedicalIcon';

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { FaceLandmarker, PoseLandmarker, ObjectDetector, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { respiratorPressureDrop } from '../services/physics/bernoulliEngine';
import { generatePulmonaryNode } from '../services/zettelkasten/bernoulli';
import { writeNodesDebounced } from '../services/zettelkasten/persistence/writeNode';
// B3 (Fase 5) — Bio-Análisis 100% on-device (directiva #12). El frame de
// cámara NUNCA sale del dispositivo: el detector EPP corre sobre el pixel
// data local (ColorBasedEppDetector). Reemplaza el egress a Gemini Vision.
import {
  getEppDetectorImpl,
  inspectImage,
  buildEppInspectionNode,
  type EppClass,
  type EppInspectionResult,
} from '../services/ai/eppDetectorOnDevice';
import { buildOnDeviceBioReport } from '../services/bio/onDeviceBioReport';

// EPP requerido (mínimo legal genérico DS 594) que evalúa esta vista.
const BIO_REQUIRED_EPP: readonly EppClass[] = ['casco', 'chaleco_reflectivo', 'botas'];

// ATS/ERS spirometry guidelines (informational); NOT a clinical diagnosis.
const PEF_FILTER_RESISTANCE_PA_S_PER_M3 = 800;
const PEF_FATIGUE_THRESHOLD_PA = 1.0;
const ALTITUDE_THIN_AIR_MULTIPLIER = 1.3;
const ALTITUDE_THRESHOLD_MASL = 3000;

export function BioAnalysis() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [metrics, setMetrics] = useState({
    fatigue: 0,
    posture: 100,
    attention: 100,
    epp: 100
  });
  const [eppDetails, setEppDetails] = useState<{ detected: string[], missing: string[] }>({
    detected: [],
    missing: []
  });
  const [history, setHistory] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [lastAnalysisImage, setLastAnalysisImage] = useState<string | null>(null);
  const [isExercisesModalOpen, setIsExercisesModalOpen] = useState(false);
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [wearableConnected, setWearableConnected] = useState(false);
  const [bodyTemp, setBodyTemp] = useState<number | null>(null);
  const [pefLMin, setPefLMin] = useState<number>(550);
  const [altitudeMasl, setAltitudeMasl] = useState<number>(0);

  // Pulmonary ergonomics (Bernoulli) — early-warning heuristic, NOT clinical diagnosis.
  // Ref.: ATS/ERS spirometry guidelines (informational).
  // PURE derivation only — no side effects in render. Persistence + audit
  // logging happen in the useEffect below (React correctness: render must be
  // free of I/O; StrictMode double-renders must not double-write Firestore).
  const pulmonaryErgonomics = (() => {
    if (!Number.isFinite(pefLMin) || pefLMin <= 0) return null;
    const flowM3PerS = pefLMin / 60000;
    let drop = respiratorPressureDrop(PEF_FILTER_RESISTANCE_PA_S_PER_M3, flowM3PerS);
    const altitudeAdjusted = altitudeMasl > ALTITUDE_THRESHOLD_MASL;
    if (altitudeAdjusted) drop *= ALTITUDE_THIN_AIR_MULTIPLIER;
    return {
      flowM3PerS,
      dropPa: drop,
      altitudeAdjusted,
      atRisk: drop > PEF_FATIGUE_THRESHOLD_PA,
    };
  })();

  // Sprint 11 + Regla #3: persist the pulmonary-altitude node to Firestore
  // (debounce 2 s) when there is an active project, and emit an auditable
  // debug log. Runs as a side-effect AFTER render so it is invoked once per
  // real input change, never during the render phase.
  useEffect(() => {
    if (!Number.isFinite(pefLMin) || pefLMin <= 0) return;
    const node = generatePulmonaryNode(
      { id: 'bio-worker', pefLMin },
      { masl: altitudeMasl },
      { id: 'bio-mask', filterResistancePaSPerM3: PEF_FILTER_RESISTANCE_PA_S_PER_M3, criticalDropPa: PEF_FATIGUE_THRESHOLD_PA },
    );
    if (!node) return;
    logger.info('zettelkasten:pulmonary-altitude', { node });
    const projectId = selectedProject?.id;
    if (projectId) writeNodesDebounced([node], { projectId });
  }, [pefLMin, altitudeMasl, selectedProject?.id]);
  const { toasts, show: showToast, dismiss } = useToast();

  const connectWearable = async () => {
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['health_thermometer']
      });
      
      setWearableConnected(true);
      
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService('health_thermometer');
      const characteristic = await service?.getCharacteristic('temperature_measurement');
      
      characteristic?.startNotifications();
      characteristic?.addEventListener('characteristicvaluechanged', (e: any) => {
        const value = e.target.value;
        // Parse temperature (simplified)
        const temp = value.getUint32(1, true) / 100;
        setBodyTemp(temp);
        
        if (temp > 38) {
          setAlerts(prev => [...prev, `Alerta Térmica: Temperatura corporal elevada (${temp}°C)`]);
        }
      });
      
    } catch (error) {
      logger.error("Bluetooth error:", error);
      showToast("No se pudo conectar al wearable. Asegúrate de tener Bluetooth activado y permisos concedidos.", 'error');
    }
  };

  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    const loadModels = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });

        const objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.task`,
            delegate: "GPU"
          },
          scoreThreshold: 0.5,
          runningMode: "VIDEO"
        });

        if (isMounted) {
          faceLandmarkerRef.current = faceLandmarker;
          poseLandmarkerRef.current = poseLandmarker;
          objectDetectorRef.current = objectDetector;
          setIsModelsLoaded(true);
        }
      } catch (error) {
        logger.error("Error loading mediapipe models:", error);
      }
    };
    loadModels();
    return () => {
      isMounted = false;
      if (faceLandmarkerRef.current) faceLandmarkerRef.current.close();
      if (poseLandmarkerRef.current) poseLandmarkerRef.current.close();
      if (objectDetectorRef.current) objectDetectorRef.current.close();
    };
  }, []);

  // Real-time mesh drawing and analysis
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const predictWebcam = () => {
      if (!video || !canvas || !cameraActive || !faceLandmarkerRef.current || !poseLandmarkerRef.current) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let currentFatigue = 0;
      let currentPosture = 100;
      let currentAttention = 100;
      let newAlerts: string[] = [];

      const startTimeMs = performance.now();
      
      // Face detection
      const faceResults = faceLandmarkerRef.current.detectForVideo(video, startTimeMs);
      if (faceResults.faceLandmarks) {
        const drawingUtils = new DrawingUtils(ctx);
        for (const landmarks of faceResults.faceLandmarks) {
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#10B981", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#3B82F6" });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#3B82F6" });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#E0E0E0" });
        }

        if (faceResults.faceBlendshapes && faceResults.faceBlendshapes.length > 0) {
          const blendshapes = faceResults.faceBlendshapes[0].categories;
          const eyeBlinkLeft = blendshapes.find(b => b.categoryName === 'eyeBlinkLeft')?.score || 0;
          const eyeBlinkRight = blendshapes.find(b => b.categoryName === 'eyeBlinkRight')?.score || 0;
          const jawOpen = blendshapes.find(b => b.categoryName === 'jawOpen')?.score || 0;
          
          // Fatigue logic
          if (eyeBlinkLeft > 0.5 && eyeBlinkRight > 0.5) {
            currentFatigue += 50;
          }
          if (jawOpen > 0.3) {
            currentFatigue += 30; // Yawning
          }
          
          // Attention logic (head pitch/yaw estimation from blendshapes or landmarks)
          const headPitch = blendshapes.find(b => b.categoryName === 'headPitch')?.score || 0;
          if (Math.abs(headPitch) > 0.3) {
            currentAttention -= 40;
          }
        }
      }

      // Pose detection
      const poseResults = poseLandmarkerRef.current.detectForVideo(video, startTimeMs);
      if (poseResults.landmarks) {
        const drawingUtils = new DrawingUtils(ctx);
        for (const landmark of poseResults.landmarks) {
          drawingUtils.drawLandmarks(landmark, { radius: 3, color: "#F59E0B" });
          drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, { color: "#F59E0B", lineWidth: 2 });
          
          // Basic posture logic (e.g., shoulders level)
          const leftShoulder = landmark[11];
          const rightShoulder = landmark[12];
          if (leftShoulder && rightShoulder) {
            const shoulderDiff = Math.abs(leftShoulder.y - rightShoulder.y);
            if (shoulderDiff > 0.1) {
              currentPosture -= 30;
            }
          }
        }
      }

      // Object detection — draw person/asset bounding boxes for the live
      // overlay only. EPP compliance is NOT derived here: it is computed on
      // capture by the on-device EPP detector (ColorBasedEppDetector), which
      // is the single source of truth for `metrics.epp`. The old per-frame
      // "person → -20" heuristic was removed so a capture's real EPP score is
      // not overwritten by the live loop moments later.
      if (objectDetectorRef.current) {
        const objectResults = objectDetectorRef.current.detectForVideo(video, startTimeMs);
        if (objectResults.detections) {
          objectResults.detections.forEach(detection => {
            const category = detection.categories[0].categoryName;
            // Draw bounding box
            if (detection.boundingBox) {
              ctx.strokeStyle = '#3B82F6';
              ctx.lineWidth = 2;
              ctx.strokeRect(
                detection.boundingBox.originX,
                detection.boundingBox.originY,
                detection.boundingBox.width,
                detection.boundingBox.height
              );
              ctx.fillStyle = '#3B82F6';
              ctx.font = '12px Arial';
              ctx.fillText(
                `${category} ${Math.round(detection.categories[0].score * 100)}%`,
                detection.boundingBox.originX,
                detection.boundingBox.originY - 5
              );
            }
          });
        }
      }

      if (isAnalyzing) {
        // Draw scanning effect
        const scanY = (Date.now() / 10) % canvas.height;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
        ctx.fillRect(0, scanY, canvas.width, 2);
        ctx.shadowColor = 'rgba(16, 185, 129, 0.8)';
        ctx.shadowBlur = 10;
      }

      // Update metrics smoothly. `epp` is intentionally carried forward
      // unchanged — it is owned by the on-device capture inspection, not the
      // live loop (see comment above).
      setMetrics(prev => ({
        fatigue: Math.min(100, Math.max(0, prev.fatigue * 0.9 + currentFatigue * 0.1)),
        posture: Math.min(100, Math.max(0, prev.posture * 0.9 + currentPosture * 0.1)),
        attention: Math.min(100, Math.max(0, prev.attention * 0.9 + currentAttention * 0.1)),
        epp: prev.epp,
      }));

      requestRef.current = requestAnimationFrame(predictWebcam);
    };

    if (cameraActive) {
      requestRef.current = requestAnimationFrame(predictWebcam);
    }
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };
  }, [cameraActive, isAnalyzing]);

  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);

  const toggleCamera = async () => {
    if (cameraActive) {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraActive(false);
      setIsAnalyzing(false);
      setLastAnalysisImage(null);
      setCameraPermissionDenied(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadeddata', () => {
            setCameraActive(true);
            setCameraPermissionDenied(false);
          });
        }
      } catch (err) {
        logger.error("Error accessing camera:", err);
        setCameraPermissionDenied(true);
      }
    }
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !cameraActive) return;

    setIsAiProcessing(true);
    setIsAnalyzing(true);

    try {
      // 1. Capture frame
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");
      
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      // Capture the UN-blurred pixel data for on-device EPP detection BEFORE
      // blurring the face (blur would degrade casco/head detection). This
      // ImageData never leaves the browser — it is consumed locally.
      const frameImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Apply face blurring (ISO 27001 Privacy) — only for the local preview.
      if (faceLandmarkerRef.current) {
        const faceResults = faceLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
        if (faceResults.faceLandmarks) {
          faceResults.faceLandmarks.forEach(landmarks => {
            // Calculate bounding box for face
            let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
            landmarks.forEach(point => {
              const x = point.x * canvas.width;
              const y = point.y * canvas.height;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            });

            // Add padding
            const padding = 20;
            minX = Math.max(0, minX - padding);
            minY = Math.max(0, minY - padding);
            const width = Math.min(canvas.width - minX, (maxX - minX) + padding * 2);
            const height = Math.min(canvas.height - minY, (maxY - minY) + padding * 2);

            // Apply blur
            ctx.filter = 'blur(15px)';
            ctx.drawImage(canvas, minX, minY, width, height, minX, minY, width, height);
            ctx.filter = 'none';
          });
        }
      }

      setLastAnalysisImage(canvas.toDataURL('image/jpeg'));

      // 2. On-device EPP detection (directiva #12 — la imagen NO sale del
      // dispositivo). El detector de color analiza el pixel data localmente.
      let inspection: EppInspectionResult | null = null;
      try {
        const detector = await getEppDetectorImpl('auto');
        inspection = await inspectImage(frameImageData, detector, {
          requiredClasses: BIO_REQUIRED_EPP,
        });
      } catch (detectErr) {
        logger.warn('[BioAnalysis] on-device EPP detection failed', { err: String(detectErr) });
      }

      // 2b. Persist EVERY successful inspection as an epp_inspection ZK node
      // (OK results included → complete EPP audit trail), not only when there
      // are alerts. buildEppInspectionNode NEVER includes the image — only the
      // classification + métricas (privacy by design). Debounced + idempotent.
      if (inspection && selectedProject?.id && user?.uid) {
        try {
          const eppNode = buildEppInspectionNode(inspection, {
            workerUid: user.uid,
            projectId: selectedProject.id,
            authorUid: user.uid,
          });
          writeNodesDebounced([eppNode], { projectId: selectedProject.id });
        } catch (zkErr) {
          logger.warn('[BioAnalysis] EPP ZK node write failed', { err: String(zkErr) });
        }
      }

      // 3. Consolidate live MediaPipe metrics + on-device EPP into the report.
      const report = buildOnDeviceBioReport(
        { fatigue: metrics.fatigue, posture: metrics.posture, attention: metrics.attention },
        inspection,
        BIO_REQUIRED_EPP,
      );

      // Preserve MediaPipe metrics for fatigue, posture, and attention; EPP
      // score comes from the on-device inspection. When the inspection could
      // not run (eppScore === null), carry the previous EPP value forward
      // rather than recording "not assessed" as a compliant number.
      setMetrics(prev => {
        const newMetrics = {
          fatigue: prev.fatigue, // Keep MediaPipe value
          posture: prev.posture, // Keep MediaPipe value
          attention: prev.attention, // Keep MediaPipe value
          epp: report.eppScore ?? prev.epp, // On-device EPP score (null → keep prev)
        };

        setHistory(historyPrev => {
          const newHistory = [...historyPrev, {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            ...newMetrics
          }];
          return newHistory.slice(-10); // Keep last 10 readings
        });

        return newMetrics;
      });

      setEppDetails({
        detected: report.eppDetected,
        missing: report.eppMissing,
      });
      setAlerts(report.alerts);

    } catch (error) {
      logger.error("Error analyzing image:", error);
      showToast("Error al analizar la imagen en el dispositivo.", 'error');
    } finally {
      setIsAiProcessing(false);
      setIsAnalyzing(false);
    }
  };

  const saveToRiskNetwork = async () => {
    if (!selectedProject || !user) {
      showToast("Selecciona un proyecto primero.", 'warning');
      return;
    }

    if (alerts.length === 0) {
      showToast("No hay alertas críticas para guardar.", 'warning');
      return;
    }

    try {
      // 1. Save to dedicated findings collection
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/findings`), {
        title: `Hallazgo Bio-Análisis: ${alerts[0]}`,
        description: `Se detectaron las siguientes anomalías mediante Bio-Análisis (Computer Vision):\n\n${alerts.map(a => `- ${a}`).join('\n')}\n\nMétricas:\n- Fatiga: ${metrics.fatigue}%\n- Postura: ${metrics.posture}%\n- Atención: ${metrics.attention}%\n- EPP: ${metrics.epp}%`,
        type: 'Condición Subestándar',
        status: 'Abierto',
        priority: 'Alta',
        projectId: selectedProject.id,
        reportedBy: user.displayName || user.email || 'Usuario',
        createdAt: serverTimestamp()
      });

      // 2. Save to Risk Network
      await addNode({
        projectId: selectedProject.id,
        type: NodeType.FINDING,
        title: `Hallazgo Bio-Análisis: ${alerts[0]}`,
        description: `Se detectaron las siguientes anomalías mediante Bio-Análisis (Computer Vision):\n\n${alerts.map(a => `- ${a}`).join('\n')}\n\nMétricas:\n- Fatiga: ${metrics.fatigue}%\n- Postura: ${metrics.posture}%\n- Atención: ${metrics.attention}%\n- EPP: ${metrics.epp}%`,
        tags: ['bio-analisis', 'ia', 'hallazgo', 'vision'],
        connections: [],
        metadata: {
          findingId: docRef.id
        }
      });
      showToast("Hallazgo guardado en la Red Neuronal y Hallazgos exitosamente.", 'success');
    } catch (error) {
      logger.error("Error saving to Zettelkasten:", error);
      showToast("Error al guardar en la Red Neuronal.", 'error');
    }
  };

  return (
    <PremiumFeatureGuard featureName="Bio-Análisis en Tiempo Real" description="Utiliza computer vision para detectar fatiga, postura y uso de EPP en tiempo real.">
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            {t('bioAnalysis.title', 'Bio-Análisis')}
            {/* Sprint 17c — Bioicons respiratory + oximetry decoration. */}
            <span className="hidden sm:inline-flex items-center gap-1.5 text-cyan-300/80" aria-hidden="true">
              <MedicalIcon name="lung-pair" size={28} alt="Pulmones" />
              <MedicalIcon name="pulse-oximeter" size={28} alt="Oxímetro" />
              <MedicalIcon name="spirometer" size={28} alt="Espirómetro" />
            </span>
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('bioAnalysis.subtitle', 'Computer Vision & IA para Detección de Riesgos')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={connectWearable}
            disabled={wearableConnected}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 w-full sm:w-auto ${
              wearableConnected ? 'bg-emerald-500/20 text-emerald-500 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            <HeartPulse className="w-4 h-4" />
            <span>{wearableConnected ? 'Wearable Conectado' : 'Conectar Wearable'}</span>
          </button>
          <button 
            onClick={toggleCamera}
            disabled={!isModelsLoaded}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 w-full sm:w-auto ${
              !isModelsLoaded ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : cameraActive ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-white text-black hover:bg-zinc-200'
            }`}
          >
            {!isModelsLoaded ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            <span>{!isModelsLoaded ? 'Cargando Modelos...' : cameraActive ? 'Detener Cámara' : 'Iniciar Cámara'}</span>
          </button>
          
          {cameraActive && (
            <button
              onClick={captureAndAnalyze}
              disabled={isAiProcessing}
              className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 w-full sm:w-auto ${
                isAiProcessing ? 'bg-zinc-500 text-white cursor-not-allowed' : 'bg-indigo-500 text-white hover:bg-indigo-600'
              }`}
            >
              {isAiProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              <span>{isAiProcessing ? 'Analizando...' : 'Analizar (on-device)'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Camera Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden relative aspect-video shadow-2xl">
            {cameraPermissionDenied ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 p-6 text-center">
                <AlertTriangle className="w-16 h-16 mb-4 text-amber-500 opacity-80" />
                <p className="text-sm font-bold uppercase tracking-widest text-white mb-2">Acceso a Cámara Denegado</p>
                <p className="text-xs text-zinc-400 max-w-md">
                  El sistema no puede acceder a la cámara. Para utilizar el Bio-Análisis, por favor permite el acceso a la cámara en la configuración de tu navegador y recarga la página.
                </p>
              </div>
            ) : !cameraActive ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
                <Camera className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-sm font-bold uppercase tracking-widest">Cámara Desactivada</p>
                {lastAnalysisImage && (
                  <img src={lastAnalysisImage} alt="Last analysis" className="absolute inset-0 w-full h-full object-cover opacity-20" />
                )}
              </div>
            ) : (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover"
                />
                
                {/* Canvas for mesh overlay */}
                <canvas 
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                />
                
                {/* Overlay UI when analyzing */}
                {isAnalyzing && (
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Scanning effect */}
                    <motion.div 
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-1 bg-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.8)] z-10"
                    />
                    
                    {/* Live Stats Overlay */}
                    <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-widest">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                        Procesando en el dispositivo...
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Alerts Section */}
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Resultados del Análisis
              </h3>
              <div className="flex items-center gap-2">
                {bodyTemp && (
                  <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest ${bodyTemp > 38 ? 'bg-rose-500/20 text-rose-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                    Temp: {bodyTemp.toFixed(1)}°C
                  </span>
                )}
                <button 
                  onClick={() => setIsExercisesModalOpen(true)}
                  className="flex items-center gap-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                >
                  <HeartPulse className="w-3 h-3" />
                  Pausa Activa
                </button>
                {alerts.length > 0 && (
                  <button 
                    onClick={saveToRiskNetwork}
                    className="flex items-center gap-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                  >
                    <Save className="w-3 h-3" />
                    Guardar Hallazgo
                  </button>
                )}
              </div>
            </div>
            
            <div className="space-y-3">
              {alerts.length > 0 ? (
                alerts.map((alert, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3 text-amber-500"
                  >
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">{alert}</p>
                  </motion.div>
                ))
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3 text-emerald-500">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <p className="text-sm font-medium">No se detectan anomalías. Parámetros normales.</p>
                </div>
              )}
            </div>

            {/* EPP Details Section */}
            {(eppDetails.detected.length > 0 || eppDetails.missing.length > 0) && (
              <div className="mt-6 pt-6 border-t border-white/10">
                <h4 className="text-xs font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-500" />
                  Detalle de EPP Detectado
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                    <h5 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3" /> EPP Presente
                    </h5>
                    {eppDetails.detected.length > 0 ? (
                      <ul className="space-y-2">
                        {eppDetails.detected.map((item, i) => (
                          <li key={i} className="text-xs text-zinc-300 flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">No se detectó EPP.</p>
                    )}
                  </div>
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                    <h5 className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" /> EPP Faltante
                    </h5>
                    {eppDetails.missing.length > 0 ? (
                      <ul className="space-y-2">
                        {eppDetails.missing.map((item, i) => (
                          <li key={i} className="text-xs text-zinc-300 flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-rose-500" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">No se detectaron faltantes.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Metrics Dashboard */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6">Métricas Biométricas</h3>
            
            <div className="space-y-6">
              {/* Fatigue */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Nivel de Fatiga</span>
                  </div>
                  <span className={`text-lg font-black ${metrics.fatigue > 70 ? 'text-rose-500' : 'text-white'}`}>
                    {Math.round(metrics.fatigue)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${metrics.fatigue > 70 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    animate={{ width: `${metrics.fatigue}%` }}
                    transition={{ type: 'spring', bounce: 0 }}
                  />
                </div>
              </div>

              {/* Posture */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Calidad Postural</span>
                  </div>
                  <span className={`text-lg font-black ${metrics.posture < 60 ? 'text-amber-500' : 'text-white'}`}>
                    {Math.round(metrics.posture)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${metrics.posture < 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    animate={{ width: `${metrics.posture}%` }}
                    transition={{ type: 'spring', bounce: 0 }}
                  />
                </div>
              </div>

              {/* Attention */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Nivel de Atención</span>
                  </div>
                  <span className={`text-lg font-black ${metrics.attention < 50 ? 'text-amber-500' : 'text-white'}`}>
                    {Math.round(metrics.attention)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${metrics.attention < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    animate={{ width: `${metrics.attention}%` }}
                    transition={{ type: 'spring', bounce: 0 }}
                  />
                </div>
              </div>

              {/* EPP */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Cumplimiento EPP</span>
                  </div>
                  <span className={`text-lg font-black ${metrics.epp < 80 ? 'text-rose-500' : 'text-white'}`}>
                    {Math.round(metrics.epp)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${metrics.epp < 80 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    animate={{ width: `${metrics.epp}%` }}
                    transition={{ type: 'spring', bounce: 0 }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
              <LineChartIcon className="w-4 h-4 text-indigo-500" />
              Tendencia de Métricas
            </h3>
            <div className="h-48 w-full">
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="time" stroke="#666" fontSize={10} tickMargin={10} />
                    <YAxis stroke="#666" fontSize={10} domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
                      itemStyle={{ fontWeight: 'bold' }}
                    />
                    <Line type="monotone" dataKey="fatigue" name="Fatiga" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="posture" name="Postura" stroke="#eab308" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="attention" name="Atención" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="epp" name="EPP" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500">
                  <Activity className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-xs font-bold uppercase tracking-widest">Sin datos históricos</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-cyan-500" />
              Ergonomía pulmonar (Bernoulli)
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-zinc-400 mb-1">PEF (L/min)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={pefLMin}
                  onChange={(e) => setPefLMin(Number(e.target.value) || 0)}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-zinc-400 mb-1">Altitud (m s.n.m.)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={altitudeMasl}
                  onChange={(e) => setAltitudeMasl(Number(e.target.value) || 0)}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            {pulmonaryErgonomics ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-300">
                  Δp filtro estimado: <span className="font-black text-cyan-400">{pulmonaryErgonomics.dropPa.toFixed(2)} Pa</span>
                  {pulmonaryErgonomics.altitudeAdjusted && (
                    <span className="text-[10px] text-zinc-400 ml-2">(×{ALTITUDE_THIN_AIR_MULTIPLIER} aire enrarecido &gt;{ALTITUDE_THRESHOLD_MASL} m)</span>
                  )}
                </p>
                {pulmonaryErgonomics.atRisk && (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-xs text-rose-300">
                    Capacidad pulmonar reducida — riesgo de fatiga temprana en altitud.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">Ingresa un PEF válido (L/min).</p>
            )}
            <p className="mt-3 text-[10px] text-zinc-500">
              Heurística de alerta temprana, NO un diagnóstico clínico. Ref.: ATS/ERS spirometry guidelines (informational).
            </p>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6">
            <h3 className="text-sm font-black text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Sincronización Neuronal
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Los datos biométricos y de EPP se analizan 100% en tu dispositivo (MediaPipe Vision + detector EPP on-device): la imagen de la cámara nunca sale del equipo. Si se detectan anomalías críticas, puedes guardarlas como un nodo de "Hallazgo" en la Red Neuronal para análisis predictivo y auditoría.
            </p>
            <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              IA on-device activa
            </div>
          </div>
        </div>
      </div>

      <CompensatoryExercisesModal
        isOpen={isExercisesModalOpen}
        onClose={() => setIsExercisesModalOpen(false)}
        metrics={metrics}
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
    </PremiumFeatureGuard>
  );
}
