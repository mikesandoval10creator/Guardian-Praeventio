import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { motion, AnimatePresence } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import {
  Layers, Upload, Loader2, CheckCircle2, AlertTriangle, Cpu, Zap,
  Video, Clock, Eye, RefreshCw, Trash2, Info, Map as MapIcon
} from 'lucide-react';
// Sprint 29 Bucket BB H24 — lazy split: Site25DPanel hosts the 2.5D
// canvas (three.js + r3f). Defer to keep the Digital Twin route
// shell snappy.
const Site25DPanel = React.lazy(() =>
  import('../components/digital-twin/Site25DPanel').then((m) => ({ default: m.Site25DPanel })),
);
import { TwinAccessGuard } from '../components/digital-twin/TwinAccessGuard';
import { isDemoProject } from '../data/demoProject';
import { auth, storage, db, doc, getDoc, ref as storageRef, uploadBytes, getDownloadURL } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { EmptyState } from '../components/shared/EmptyState';
import { ToastContainer } from '../components/shared/ToastContainer';
import { useToast } from '../hooks/useToast';
import { logger } from '../utils/logger';
import { generateSlamMeshNode } from '../services/zettelkasten/bernoulli/slamPhotogrammetryNode';
import { writeNodesDebounced } from '../services/zettelkasten/persistence/writeNode';
import { PlacedObjectsLayer } from '../components/digital-twin/PlacedObjectsLayer';
import { PlaceObjectMenu, DRAG_MIME } from '../components/digital-twin/PlaceObjectMenu';
import { NormativaWarningsBanner } from '../components/digital-twin/NormativaWarningsBanner';
import { MaintenanceStatusPanel } from '../components/digital-twin/MaintenanceStatusPanel';
import { ARObjectOverlay } from '../components/digital-twin/ARObjectOverlay';
// Sprint 30 Bucket JJ — iOS Quick Look + Android Scene Viewer fallback.
import { ArViewLink, type ArKind } from '../components/ar/ArViewLink';
import { useObjectLifecycle } from '../hooks/useObjectLifecycle';
import type { PlacedObject, PlacedObjectKind } from '../services/digitalTwin/photogrammetry/types';
import { runComplianceCheck } from '../services/digitalTwin/objectPlacement/normativaRules';
import {
  savePlacedObject,
  subscribePlacedObjects,
  updatePlacedObject,
} from '../services/digitalTwin/placedObjectsStore';

interface ReconstructionJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  videoUrl?: string;
  notes?: string;
  resultUrl?: string | null;
  pointCount?: number;
  boundingBox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  createdAt?: { seconds: number };
  error?: string;
  metrics?: { framesExtracted?: number };
}

type ProcessingMode = 'gpu' | 'cpu';

const STATUS_LABEL: Record<ReconstructionJob['status'], string> = {
  queued: 'En cola',
  processing: 'Procesando',
  completed: 'Completado',
  failed: 'Falló',
};

const STATUS_STYLE: Record<ReconstructionJob['status'], { bg: string; text: string; Icon: typeof Loader2 }> = {
  queued:     { bg: 'bg-zinc-700/40 border-zinc-600/50', text: 'text-zinc-300', Icon: Clock },
  processing: { bg: 'bg-cyan-500/15 border-cyan-500/40', text: 'text-cyan-300', Icon: Loader2 },
  completed:  { bg: 'bg-emerald-500/15 border-emerald-500/40', text: 'text-emerald-300', Icon: CheckCircle2 },
  failed:     { bg: 'bg-rose-500/15 border-rose-500/40', text: 'text-rose-300', Icon: AlertTriangle },
};

// Procedural point cloud generated from boundingBox + pointCount (visualization fallback for demo mode)
function PointCloudViewer({ pointCount, boundingBox }: { pointCount: number; boundingBox: ReconstructionJob['boundingBox'] }) {
  const positions = React.useMemo(() => {
    const arr = new Float32Array(pointCount * 3);
    const bb = boundingBox || { minX: -10, maxX: 10, minY: 0, maxY: 5, minZ: -10, maxZ: 10 };
    for (let i = 0; i < pointCount; i++) {
      arr[i * 3]     = bb.minX + Math.random() * (bb.maxX - bb.minX);
      arr[i * 3 + 1] = bb.minY + Math.random() * (bb.maxY - bb.minY);
      arr[i * 3 + 2] = bb.minZ + Math.random() * (bb.maxZ - bb.minZ);
    }
    return arr;
  }, [pointCount, boundingBox]);

  const colors = React.useMemo(() => {
    const arr = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i++) {
      const heightRatio = (positions[i * 3 + 1] - (boundingBox?.minY ?? 0)) / Math.max(1, (boundingBox?.maxY ?? 5) - (boundingBox?.minY ?? 0));
      arr[i * 3]     = 0.2 + heightRatio * 0.4;       // R
      arr[i * 3 + 1] = 0.6 + heightRatio * 0.3;       // G
      arr[i * 3 + 2] = 0.5 - heightRatio * 0.2;       // B
    }
    return arr;
  }, [positions, pointCount, boundingBox]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={pointCount} itemSize={3} />
        <bufferAttribute attach="attributes-color" array={colors} count={pointCount} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} vertexColors sizeAttenuation transparent opacity={0.85} />
    </points>
  );
}

// Risk markers (pinned in 3D space — demo: static positions, future: from risk engine)
function RiskMarkers() {
  const markers = [
    { pos: [3, 1.5, 2] as [number, number, number], color: '#f43f5e', label: 'Caída altura' },
    { pos: [-4, 0.8, -3] as [number, number, number], color: '#f59e0b', label: 'Atropello' },
    { pos: [0, 2, 5] as [number, number, number], color: '#fbbf24', label: 'EPP faltante' },
  ];
  return (
    <>
      {markers.map((m, i) => (
        <mesh key={i} position={m.pos}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color={m.color} emissive={m.color} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </>
  );
}

export function DigitalTwinFaena() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { toasts, show, dismiss } = useToast();
  const reducedMotion = useReducedMotion();

  const [activeTab, setActiveTab] = useState<'reconstruction' | 'site25d'>('reconstruction');
  const [mode, setMode] = useState<ProcessingMode>('gpu');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<ReconstructionJob[]>([]);
  const [activeJob, setActiveJob] = useState<ReconstructionJob | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sprint 21 Ola 3 Bucket J: object placement persistence end-to-end.
  // - subscribePlacedObjects hidrata el state desde Firestore en realtime.
  // - savePlacedObject + updatePlacedObject persisten cada mutación local.
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [arObject, setArObject] = useState<PlacedObject | null>(null);
  const onLifecycleChange = useObjectLifecycle(selectedProject?.id ?? '');

  // Suscripción Firestore — limpia automáticamente al cambiar projectId.
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setPlacedObjects([]);
      return;
    }
    const unsub = subscribePlacedObjects(
      projectId,
      (objs) => setPlacedObjects(objs),
      (err) => logger.warn('placed_objects_subscription_error', { err: String(err) }),
    );
    return () => unsub();
  }, [selectedProject?.id]);
  const complianceReport = React.useMemo(
    () => runComplianceCheck({ placedObjects }),
    [placedObjects],
  );

  const handleCanvasDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const kind = (e.dataTransfer.getData(DRAG_MIME) ||
      e.dataTransfer.getData('text/plain')) as PlacedObjectKind | '';
    if (!kind) return;
    e.preventDefault();
    // Place at a sensible default — center of grid; Ola 3 will raycast onto mesh.
    const now = Date.now();
    const newObj: PlacedObject = {
      id: `placed_${now}_${Math.random().toString(36).slice(2, 8)}`,
      kind: kind as PlacedObjectKind,
      position: { x: (Math.random() - 0.5) * 8, y: 1, z: (Math.random() - 0.5) * 8 },
      lifecycle: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    setPlacedObjects((prev) => [...prev, newObj]);
    setSelectedObjectId(newObj.id);
    // Bucket J.2 — persistir en Firestore (best-effort; el subscribe lo
    // re-hidratará igualmente al confirmar la escritura remota).
    const projectId = selectedProject?.id;
    if (projectId) {
      void savePlacedObject(newObj, projectId).catch((err) =>
        logger.warn('placed_object_save_failed', { err: String(err) }),
      );
    }
    void onLifecycleChange(null, newObj).catch((err) =>
      logger.error('object lifecycle (planning) failed', { err: String(err) }),
    );
  }, [onLifecycleChange, selectedProject?.id]);

  const handleMarkInstalled = React.useCallback(async () => {
    if (!selectedObjectId) return;
    const previous = placedObjects.find((o) => o.id === selectedObjectId) ?? null;
    if (!previous) return;
    const next: PlacedObject = {
      ...previous,
      lifecycle: 'installed',
      updatedAt: Date.now(),
    };
    try {
      // Bucket J.2 — escribir el patch a Firestore ANTES de invocar el
      // lifecycle (que crea ZK + calendar). Si la escritura remota falla
      // dejamos que el subscribe re-sincronice; el ZK + calendar siguen
      // siendo source-of-truth de la auditoría.
      const projectId = selectedProject?.id;
      if (projectId) {
        await updatePlacedObject(next.id, { lifecycle: 'installed' }, projectId).catch(
          (err) => logger.warn('placed_object_update_failed', { err: String(err) }),
        );
      }
      const result = await onLifecycleChange(previous, next);
      setPlacedObjects((prev) => prev.map((o) => (o.id === next.id ? next : o)));
      const created = result.calendarEventSpecs.length;
      show(
        `Objeto instalado. ${created > 0 ? `${created} mantención(es) agendada(s).` : 'ZK node creado.'}`,
        'success',
      );
    } catch (err) {
      logger.error('mark installed failed', { err: String(err) });
      show('No se pudo persistir el cambio de estado', 'error');
    }
  }, [selectedObjectId, placedObjects, onLifecycleChange, show, selectedProject?.id]);

  const handleObjectMove = React.useCallback(
    (obj: PlacedObject, newPosition: { x: number; y: number; z: number }) => {
      const previous = obj;
      const next: PlacedObject = {
        ...obj,
        position: newPosition,
        updatedAt: Date.now(),
      };
      setPlacedObjects((prev) => prev.map((o) => (o.id === obj.id ? next : o)));
      // Bucket J.2 — persistir el move a Firestore además del lifecycle.
      const projectId = selectedProject?.id;
      if (projectId) {
        void updatePlacedObject(obj.id, { position: newPosition }, projectId).catch(
          (err) => logger.warn('placed_object_move_persist_failed', { err: String(err) }),
        );
      }
      void onLifecycleChange(previous, next).catch((err) =>
        logger.error('object move persistence failed', { err: String(err) }),
      );
    },
    [onLifecycleChange, selectedProject?.id],
  );

  const selectedObject = selectedObjectId
    ? placedObjects.find((o) => o.id === selectedObjectId) ?? null
    : null;

  const apiBase = (import.meta.env.VITE_APP_URL as string) || '';

  const apiCall = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('No autenticado');
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
    return res.json();
  };

  const refreshJobs = async () => {
    if (!selectedProject) return;
    setLoadingJobs(true);
    try {
      const list = await apiCall<ReconstructionJob[]>(`/api/digitalTwin/jobs?projectId=${selectedProject.id}`);
      setJobs(list);
      const completed = list.find(j => j.status === 'completed');
      if (completed && !activeJob) setActiveJob(completed);
    } catch (err) {
      logger.error('refreshJobs failed', { err: String(err) });
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    refreshJobs();
  }, [selectedProject?.id]);

  // Polling: refresh active processing job every 4s (skipped when user prefers reduced motion)
  useEffect(() => {
    const hasProcessing = jobs.some(j => j.status === 'queued' || j.status === 'processing');
    if (!hasProcessing || reducedMotion) return;
    const interval = setInterval(refreshJobs, 4000);
    return () => clearInterval(interval);
  }, [jobs.map(j => `${j.jobId}:${j.status}`).join(','), reducedMotion]);

  // Bucket B.1 — emit Zettelkasten `slam-mesh` node for completed reconstruction jobs.
  // Uses the keyframe count from `job.metrics.framesExtracted` (falls back to 0). Generator
  // gates on min keyframes/coverage and returns null below threshold.
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) return;
    const nodes = jobs
      .filter((j) => j.status === 'completed')
      .map((job) => generateSlamMeshNode(
        {
          id: job.jobId,
          keyframeCount: job.metrics?.framesExtracted ?? 0,
          coveragePercent: 80,
        },
        { id: projectId },
      ))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    if (nodes.length > 0) writeNodesDebounced(nodes, { projectId });
  }, [jobs.map(j => `${j.jobId}:${j.status}`).join(','), selectedProject?.id]);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('video/')) {
      show('Solo se aceptan archivos de video (mp4, mov, webm)', 'error');
      return;
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 200) {
      show(`Video muy pesado (${sizeMB.toFixed(0)}MB). Máximo 200MB.`, 'error');
      return;
    }
    setVideoFile(file);
  };

  const handleSubmit = async () => {
    if (!videoFile || !selectedProject || !user) return;
    setUploading(true);
    try {
      // 1. Upload to Firebase Storage
      const path = `digital_twin/${selectedProject.id}/${Date.now()}_${videoFile.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, videoFile);
      const videoUrl = await getDownloadURL(sRef);
      setUploading(false);

      // 2. Submit reconstruction job.
      //
      // The "Vista previa" badge stays on while the backend resolves the
      // adapter via `ColmapAdapter.fromEnv()` (Bucket H — see
      // src/services/digitalTwin/photogrammetry/colmapAdapter.ts). When
      // PHOTOGRAMMETRY_WORKER_URL + PHOTOGRAMMETRY_WORKER_TOKEN are set
      // on the API runtime, the request hits the real COLMAP Cloud Run
      // worker; otherwise the API falls back to the mock adapter and the
      // page shows demo point clouds. The `mode` field below ('cpu'
      // here) maps to ColmapAdapter on the backend, while 'gpu' is
      // reserved for the Modal.run worker (Bucket I, separate adapter).
      setSubmitting(true);
      const result = await apiCall<{ jobId: string; status: string }>('/api/digitalTwin/reconstruct', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedProject.id,
          videoUrl,
          notes: notes.trim() || undefined,
          mode,
        }),
      });
      show(`Job ${result.jobId.slice(0, 8)} encolado (${mode === 'gpu' ? '~2-5 min' : '~10-15 min CPU'})`, 'success');
      setVideoFile(null);
      setNotes('');
      await refreshJobs();
    } catch (err) {
      logger.error('DigitalTwin submit failed', { err: String(err) });
      show('Error al subir video o crear job', 'error');
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  };

  const totalNodes = activeJob?.pointCount ?? 0;

  return (
    <div className="flex flex-col h-full min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5 bg-zinc-900/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Layers className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black uppercase tracking-tighter text-white">Gemelo Digital 3D</h1>
              <span
                className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest rounded bg-amber-500/15 text-amber-400 border border-amber-500/40"
                role="status"
                aria-label="Función en vista previa, no apta para reportes oficiales"
              >
                Vista previa
              </span>
            </div>
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Reconstrucción Faena · lingBot-Map</p>
          </div>
        </div>
        <button
          onClick={refreshJobs}
          disabled={loadingJobs}
          aria-label="Refrescar lista de jobs"
          className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <RefreshCw className={`w-4 h-4 text-zinc-400 ${loadingJobs ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Vistas del gemelo digital"
        className="flex items-center gap-1 px-4 sm:px-6 pt-3 border-b border-white/5 bg-zinc-900/60 shrink-0"
      >
        <button
          role="tab"
          aria-selected={activeTab === 'reconstruction'}
          onClick={() => setActiveTab('reconstruction')}
          className={`flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-lg transition-colors ${
            activeTab === 'reconstruction'
              ? 'bg-zinc-950 text-cyan-300 border-x border-t border-white/10'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          Reconstrucción 3D
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'site25d'}
          onClick={() => setActiveTab('site25d')}
          className={`flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-lg transition-colors ${
            activeTab === 'site25d'
              ? 'bg-zinc-950 text-cyan-300 border-x border-t border-white/10'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
          Mapa 2.5D del sitio
        </button>
      </div>

      {activeTab === 'site25d' ? (
        <div className="flex-1 p-4 sm:p-6 overflow-hidden">
          <div className="h-full bg-zinc-900/60 border border-white/5 rounded-2xl overflow-hidden">
            <Suspense fallback={
              <div className="w-full h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              </div>
            }>
              <Site25DPanel />
            </Suspense>
          </div>
        </div>
      ) : (
      /* Main grid */
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 sm:p-6 overflow-hidden">
        {/* LEFT: Upload + Job list */}
        <aside className="space-y-4 overflow-y-auto pr-1">
          {/* Mode toggle */}
          <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Modo de procesamiento</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Modo de procesamiento">
              <button
                role="radio"
                aria-checked={mode === 'gpu'}
                onClick={() => setMode('gpu')}
                className={`p-3 rounded-xl border transition-all ${
                  mode === 'gpu'
                    ? 'bg-cyan-500/15 border-cyan-500/50 ring-2 ring-cyan-500/30'
                    : 'bg-zinc-800/40 border-white/5 hover:bg-zinc-800/80'
                }`}
              >
                <Zap className={`w-5 h-5 mb-1 ${mode === 'gpu' ? 'text-cyan-400' : 'text-zinc-500'}`} aria-hidden="true" />
                <p className={`text-xs font-black ${mode === 'gpu' ? 'text-white' : 'text-zinc-400'}`}>GPU Cloud</p>
                <p className="text-[9px] text-zinc-500 mt-0.5">~2-5 min · Modal.run</p>
              </button>
              <button
                role="radio"
                aria-checked={mode === 'cpu'}
                onClick={() => setMode('cpu')}
                className={`p-3 rounded-xl border transition-all ${
                  mode === 'cpu'
                    ? 'bg-amber-500/15 border-amber-500/50 ring-2 ring-amber-500/30'
                    : 'bg-zinc-800/40 border-white/5 hover:bg-zinc-800/80'
                }`}
              >
                <Cpu className={`w-5 h-5 mb-1 ${mode === 'cpu' ? 'text-amber-400' : 'text-zinc-500'}`} aria-hidden="true" />
                <p className={`text-xs font-black ${mode === 'cpu' ? 'text-white' : 'text-zinc-400'}`}>CPU local</p>
                <p className="text-[9px] text-zinc-500 mt-0.5">~10-15 min · gratis</p>
              </button>
            </div>
            <div className="flex items-start gap-2 mt-3 p-2 bg-zinc-800/40 rounded-lg">
              <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                {mode === 'gpu'
                  ? 'GPU serverless dedicada (~$0.44/hr). Resultado rápido para revisión inmediata.'
                  : 'Procesamiento sin GPU dedicada. Más lento pero sin costo por job.'}
              </p>
            </div>
            {mode === 'cpu' && (
              <div className="mt-2 p-3 rounded-lg bg-amber-900/30 border border-amber-600/40 text-amber-200 text-xs">
                <strong>Modo CPU local:</strong> la reconstrucción toma 10–30 min en el servidor
                usando COLMAP (sin GPU, sin costo). El resultado aparecerá automáticamente al terminar.
              </div>
            )}
          </div>

          {/* Upload zone */}
          <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Nuevo escaneo</p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFileSelect(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Soltar video o hacer click para seleccionar"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                dragOver
                  ? 'border-cyan-500/60 bg-cyan-500/5'
                  : videoFile
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-white/10 hover:border-white/20 bg-zinc-800/20'
              }`}
            >
              {videoFile ? (
                <div>
                  <Video className="w-8 h-8 text-emerald-400 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-xs font-bold text-white truncate">{videoFile.name}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">{(videoFile.size / (1024 * 1024)).toFixed(1)} MB</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setVideoFile(null); }}
                    className="mt-2 text-[10px] text-rose-400 hover:text-rose-300 font-bold"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-zinc-500 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-xs font-bold text-zinc-300">Soltar video aquí</p>
                  <p className="text-[10px] text-zinc-500 mt-1">mp4, mov, webm · máx 200MB</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
            </div>

            <input
              type="text"
              placeholder="Notas (sector, fecha, condiciones)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full mt-3 bg-zinc-800 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
            />

            <button
              onClick={handleSubmit}
              disabled={!videoFile || uploading || submitting || !selectedProject}
              className="w-full mt-3 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Subiendo video</>
               : submitting ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Encolando job</>
               : <><Upload className="w-4 h-4" aria-hidden="true" />Iniciar reconstrucción</>}
            </button>
          </div>

          {/* Brecha C: place objects menu — solo visible cuando hay reconstrucción completa */}
          {activeJob?.status === 'completed' && (
            <PlaceObjectMenu />
          )}

          {/* Jobs list */}
          <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">
              Jobs recientes ({jobs.length})
            </p>
            {jobs.length === 0 ? (
              <p className="text-[11px] text-zinc-600 text-center py-4">Aún no hay reconstrucciones</p>
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => {
                  const style = STATUS_STYLE[job.status];
                  const isActive = activeJob?.jobId === job.jobId;
                  return (
                    <li key={job.jobId}>
                      <button
                        onClick={() => job.status === 'completed' && setActiveJob(job)}
                        disabled={job.status !== 'completed'}
                        aria-label={`Job ${job.jobId.slice(0, 8)} estado ${STATUS_LABEL[job.status]}`}
                        className={`w-full text-left p-2.5 rounded-xl border transition-all ${style.bg} ${
                          isActive ? 'ring-2 ring-cyan-500/40' : ''
                        } ${job.status === 'completed' ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default'}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${style.text} flex items-center gap-1.5`}>
                            <style.Icon className={`w-3 h-3 ${job.status === 'processing' || job.status === 'queued' ? 'animate-spin' : ''}`} aria-hidden="true" />
                            {STATUS_LABEL[job.status]}
                          </span>
                          <span className="text-[9px] text-zinc-500 font-mono">{job.jobId.slice(0, 8)}</span>
                        </div>
                        {(job.status === 'processing' || job.status === 'queued') && (
                          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-1.5">
                            <div
                              className="h-full bg-cyan-500 transition-all"
                              style={{ width: `${job.progress}%` }}
                              role="progressbar"
                              aria-valuenow={job.progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            />
                          </div>
                        )}
                        {job.notes && (
                          <p className="text-[10px] text-zinc-500 mt-1 truncate">{job.notes}</p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* RIGHT: 3D viewer — Sprint 26 Bucket YY.2: protegido por TwinAccessGuard
            (ADR 0011 triple-gate). El header + upload + jobs list quedan
            fuera del guard porque no muestran geometría. */}
        {selectedProject ? (
        <TwinAccessGuard
          projectId={selectedProject.id}
          hookOptions={{
            fakers: {
              getCurrentUser: () =>
                user
                  ? {
                      uid: user.uid,
                      email: user.email ?? '',
                      emailVerified: user.emailVerified,
                    }
                  : null,
              isProjectMember: async (uid, projectId) => {
                try {
                  const snap = await getDoc(doc(db, 'projects', projectId));
                  if (!snap.exists()) return false;
                  const data = snap.data() as
                    | { members?: unknown; createdBy?: unknown }
                    | undefined;
                  const inMembers =
                    Array.isArray(data?.members) &&
                    data!.members.includes(uid);
                  const isCreator =
                    typeof data?.createdBy === 'string' &&
                    data!.createdBy === uid;
                  return inMembers || isCreator;
                } catch {
                  return false;
                }
              },
              isDemoProject,
              runBiometric: async () => {
                try {
                  const mod: any = await import(
                    /* @vite-ignore */ '@aparajita/capacitor-biometric-auth'
                  );
                  const result = await mod.BiometricAuth.authenticate({
                    reason:
                      'Verifica tu identidad para acceder al Digital Twin',
                    cancelTitle: 'Cancelar',
                  });
                  return {
                    ok: result?.isAuthenticated ?? true,
                    method: 'fingerprint' as const,
                  };
                } catch {
                  return { ok: false, method: 'unavailable' as const };
                }
              },
            },
          }}
        >
        <section className="lg:col-span-2 bg-zinc-900/60 border border-white/5 rounded-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">
                Visor 3D {activeJob ? `· ${activeJob.jobId.slice(0, 8)}` : ''}
              </span>
            </div>
            {activeJob && totalNodes > 0 && (
              <span className="text-[10px] text-zinc-500 font-mono">
                {totalNodes.toLocaleString()} puntos
              </span>
            )}
          </div>

          <div
            className="flex-1 relative bg-zinc-950"
            onDragOver={(e) => {
              if (activeJob?.status !== 'completed') return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={handleCanvasDrop}
          >
            {!activeJob || activeJob.status !== 'completed' ? (
              <EmptyState
                mascot
                title="Sin reconstrucción activa"
                description="Sube un video de la faena para generar el gemelo digital 3D. La nube de puntos aparecerá aquí cuando esté lista. (Vista previa: el resultado actual es ilustrativo y no representa la reconstrucción real hasta que se conecte el motor.)"
              />
            ) : (
              <Suspense fallback={
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
                  <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
                </div>
              }>
                <Canvas camera={{ position: [15, 12, 15], fov: 50 }} dpr={[1, 2]}>
                  <ambientLight intensity={0.4} />
                  <directionalLight position={[10, 20, 10]} intensity={0.8} />
                  <Environment preset="warehouse" />
                  <Grid
                    infiniteGrid
                    cellSize={1}
                    cellThickness={0.5}
                    cellColor="#27272a"
                    sectionSize={5}
                    sectionThickness={1}
                    sectionColor="#06b6d4"
                    fadeDistance={50}
                  />
                  <PointCloudViewer pointCount={totalNodes} boundingBox={activeJob.boundingBox} />
                  <RiskMarkers />
                  <PlacedObjectsLayer
                    objects={placedObjects}
                    selectedId={selectedObjectId}
                    onSelect={(o) => setSelectedObjectId(o.id)}
                    onMove={handleObjectMove}
                    onRequestAr={(o) => setArObject(o)}
                  />
                  <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
                </Canvas>

                {/* Brecha C: normativa banner top-right */}
                <div className="absolute top-3 right-3 max-w-sm">
                  <NormativaWarningsBanner
                    violations={complianceReport.violations}
                    compact={complianceReport.violations.length > 4}
                  />
                </div>

                {/* Bucket K.2 — Maintenance status panel (histórico ZK + próximos
                    mantenimientos) anclado al top-right cuando hay objeto seleccionado. */}
                {selectedObject && selectedProject?.id && (
                  <div className="absolute top-3 right-3 max-h-[calc(100%-1.5rem)] overflow-y-auto z-10">
                    <MaintenanceStatusPanel
                      placedObject={selectedObject}
                      projectId={selectedProject.id}
                      onClose={() => setSelectedObjectId(null)}
                    />
                  </div>
                )}

                {/* Brecha C: selected object detail panel bottom-right */}
                {selectedObject && (
                  <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md rounded-xl p-3 border border-white/10 max-w-xs">
                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                      Objeto seleccionado
                    </p>
                    <p className="text-xs font-bold text-white mb-1">
                      {selectedObject.kind}
                    </p>
                    <p className="text-[10px] text-zinc-400 mb-2">
                      Estado: <span className="text-cyan-300">{selectedObject.lifecycle}</span>
                    </p>
                    {selectedObject.lifecycle === 'planning' && (
                      <button
                        onClick={handleMarkInstalled}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors"
                      >
                        Marcar instalado
                      </button>
                    )}
                    {selectedObject.lifecycle === 'installed' && (
                      <button
                        onClick={async () => {
                          const previous = selectedObject;
                          const next: PlacedObject = {
                            ...previous,
                            lifecycle: 'active',
                            updatedAt: Date.now(),
                          };
                          await onLifecycleChange(previous, next);
                          setPlacedObjects((prev) =>
                            prev.map((o) => (o.id === next.id ? next : o)),
                          );
                        }}
                        className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors"
                      >
                        Marcar activo
                      </button>
                    )}
                    {/* Bucket J.5 — WebXR AR overlay (Android Chrome / desktop preview). */}
                    <button
                      type="button"
                      onClick={() => setArObject(selectedObject)}
                      className="w-full mt-2 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors border border-white/10"
                    >
                      Ver en AR (WebXR)
                    </button>
                    {/* Sprint 30 Bucket JJ — Native iOS Quick Look + Android
                        Scene Viewer link for installed objects. Renders nothing
                        on desktop UAs; the WebXR button above stays as the
                        cross-platform path. */}
                    {selectedObject.lifecycle === 'installed' && (
                      <div className="mt-2">
                        <ArViewLink
                          kind={selectedObject.kind as ArKind}
                          label="Ver en AR (nativo)"
                          className="inline-flex w-full justify-center items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-black uppercase tracking-wider transition-colors"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Risk overlay legend */}
                <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md rounded-xl p-3 border border-white/10">
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">Riesgos detectados</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500" aria-hidden="true" />
                      Caída de altura
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                      Atropello
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" aria-hidden="true" />
                      EPP faltante
                    </div>
                  </div>
                </div>
              </Suspense>
            )}
          </div>
        </section>
        </TwinAccessGuard>
        ) : (
          <section className="lg:col-span-2 bg-zinc-900/60 border border-white/5 rounded-2xl overflow-hidden flex items-center justify-center min-h-[480px]">
            <p className="text-xs text-zinc-500">
              Selecciona un proyecto para ver el Digital Twin.
            </p>
          </section>
        )}
      </div>
      )}

      {/* Bucket J.5 — AR overlay (placeholder funcional, sesión WebXR real en Ola 4). */}
      {arObject && (
        <ARObjectOverlay object={arObject} onClose={() => setArObject(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
