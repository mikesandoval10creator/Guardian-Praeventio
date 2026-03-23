import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Camera, AlertTriangle, CheckCircle2, RefreshCw, Eye, User } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';

export function BioAnalysis() {
  const { selectedProject } = useProject();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [metrics, setMetrics] = useState({
    fatigue: 0,
    posture: 100,
    attention: 100
  });
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let animationFrameId: number;

    const drawSimulatedMesh = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !isAnalyzing) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match canvas size to video
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw simulated face mesh points
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radiusX = 60 + Math.sin(Date.now() / 500) * 5; // Slight breathing effect
      const radiusY = 80 + Math.cos(Date.now() / 500) * 5;

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)'; // Emerald 500
      ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.lineWidth = 1;

      // Draw points around an ellipse (simulating face contour)
      const numPoints = 20;
      const points = [];
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radiusX + (Math.random() * 4 - 2);
        const y = centerY + Math.sin(angle) * radiusY + (Math.random() * 4 - 2);
        points.push({ x, y });
        
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Connect some points to simulate a mesh
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const p3 = points[(i + 5) % points.length]; // Cross connections
        
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        
        if (i % 3 === 0) {
           ctx.moveTo(p1.x, p1.y);
           ctx.lineTo(p3.x, p3.y);
        }
      }
      ctx.stroke();

      // Draw simulated eye tracking
      const leftEyeX = centerX - 25;
      const rightEyeX = centerX + 25;
      const eyeY = centerY - 15;
      
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // Blue 500 for eyes
      ctx.beginPath();
      ctx.arc(leftEyeX, eyeY, 8, 0, Math.PI * 2);
      ctx.arc(rightEyeX, eyeY, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Draw gaze direction line
      const gazeOffsetX = Math.sin(Date.now() / 1000) * 15;
      const gazeOffsetY = Math.cos(Date.now() / 1000) * 5;
      
      ctx.beginPath();
      ctx.moveTo(leftEyeX, eyeY);
      ctx.lineTo(leftEyeX + gazeOffsetX, eyeY + gazeOffsetY);
      ctx.moveTo(rightEyeX, eyeY);
      ctx.lineTo(rightEyeX + gazeOffsetX, eyeY + gazeOffsetY);
      ctx.stroke();

      animationFrameId = requestAnimationFrame(drawSimulatedMesh);
    };

    if (isAnalyzing && cameraActive) {
      interval = setInterval(() => {
        // Simulate fluctuating metrics
        setMetrics(prev => {
          const newFatigue = Math.min(100, Math.max(0, prev.fatigue + (Math.random() * 10 - 3)));
          const newPosture = Math.min(100, Math.max(0, prev.posture + (Math.random() * 10 - 5)));
          const newAttention = Math.min(100, Math.max(0, prev.attention + (Math.random() * 10 - 5)));
          
          const newAlerts = [];
          if (newFatigue > 70) newAlerts.push('Signos de fatiga detectados. Se recomienda pausa activa.');
          if (newPosture < 60) newAlerts.push('Postura incorrecta. Riesgo ergonómico (REBA/RULA).');
          if (newAttention < 50) newAlerts.push('Baja atención detectada. Posible distracción.');
          
          setAlerts(newAlerts);
          
          return {
            fatigue: newFatigue,
            posture: newPosture,
            attention: newAttention
          };
        });
      }, 2000);

      drawSimulatedMesh();
    }
    
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(animationFrameId);
      // Clear canvas when stopping
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };
  }, [isAnalyzing, cameraActive]);

  const toggleCamera = async () => {
    if (cameraActive) {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraActive(false);
      setIsAnalyzing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("No se pudo acceder a la cámara. Por favor, verifica los permisos.");
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Bio-Análisis</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Detección de Fatiga y Postura en Tiempo Real
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={toggleCamera}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center gap-2 ${
              cameraActive ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-white text-black hover:bg-zinc-200'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>{cameraActive ? 'Detener Cámara' : 'Iniciar Cámara'}</span>
          </button>
          
          {cameraActive && (
            <button 
              onClick={() => setIsAnalyzing(!isAnalyzing)}
              className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center gap-2 ${
                isAnalyzing ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>{isAnalyzing ? 'Pausar Análisis' : 'Iniciar Análisis'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Camera Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden relative aspect-video">
            {!cameraActive ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
                <Camera className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-sm font-bold uppercase tracking-widest">Cámara Desactivada</p>
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
                
                {/* Canvas for simulated mesh overlay */}
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
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-1 bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.8)] z-10"
                    />
                    
                    {/* Simulated Face/Body Tracking Box */}
                    <div className="absolute top-1/4 left-1/4 right-1/4 bottom-1/4 border-2 border-emerald-500/50 rounded-xl flex items-start justify-between p-2">
                      <div className="w-4 h-4 border-t-2 border-l-2 border-emerald-500" />
                      <div className="w-4 h-4 border-t-2 border-r-2 border-emerald-500" />
                    </div>
                    <div className="absolute top-1/4 left-1/4 right-1/4 bottom-1/4 flex items-end justify-between p-2">
                      <div className="w-4 h-4 border-b-2 border-l-2 border-emerald-500" />
                      <div className="w-4 h-4 border-b-2 border-r-2 border-emerald-500" />
                    </div>

                    {/* Live Stats Overlay */}
                    <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Analizando
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Alerts Section */}
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Alertas en Tiempo Real
            </h3>
            
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
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6">
            <h3 className="text-sm font-black text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Zettelkasten Sync
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Los datos biométricos se analizan localmente. Las anomalías persistentes generarán un nodo de "Hallazgo" en el Grafo de Conocimiento para análisis predictivo.
            </p>
            <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Sincronización Activa
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
