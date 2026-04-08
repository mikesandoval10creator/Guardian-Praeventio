import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sun, Camera, ShieldAlert, AlertTriangle, CheckCircle2, Info, Loader2, Activity } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function LightPollutionAudit() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Simulate accessing the camera
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setCameraPermissionDenied(false);
          }
        })
        .catch(err => {
          console.error("Error accessing camera:", err);
          setCameraPermissionDenied(true);
        });
    } else {
      setCameraPermissionDenied(true);
    }
    
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleScan = () => {
    setIsScanning(true);
    setScanComplete(false);

    // Simulate Vision AI processing
    setTimeout(() => {
      setIsScanning(false);
      setScanComplete(true);
    }, 3000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Sun className="w-8 h-8 text-amber-500" />
            Auditoría Lumínica (DS 43)
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Visión Computacional para Cumplimiento Ambiental
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-amber-500 bg-amber-500/10 border-amber-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Fiscalización IA
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Camera View */}
        <Card className="p-0 border-white/5 overflow-hidden relative min-h-[400px] bg-black flex items-center justify-center">
          {cameraPermissionDenied ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 p-6 text-center z-20 bg-zinc-900">
              <AlertTriangle className="w-16 h-16 mb-4 text-amber-500 opacity-80" />
              <p className="text-sm font-bold uppercase tracking-widest text-white mb-2">Acceso a Cámara Denegado</p>
              <p className="text-xs text-zinc-400 max-w-md">
                El sistema no puede acceder a la cámara. Para utilizar la Auditoría Lumínica, por favor permite el acceso a la cámara en la configuración de tu navegador y recarga la página.
              </p>
            </div>
          ) : (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute inset-0 w-full h-full object-cover opacity-60"
              />
              
              {/* Simulated AR Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className={`w-64 h-64 border-2 border-dashed rounded-3xl transition-colors duration-500 ${isScanning ? 'border-amber-500' : scanComplete ? 'border-rose-500' : 'border-white/30'}`}>
                  {isScanning && (
                    <motion.div 
                      className="w-full h-1 bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.8)]"
                      animate={{ y: [0, 256, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                </div>
              </div>

              <div className="absolute bottom-6 left-0 right-0 flex justify-center z-10">
                <Button 
                  onClick={handleScan} 
                  disabled={isScanning}
                  className="px-8 py-4 rounded-full shadow-2xl"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Analizando Espectro...
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5 mr-2" />
                      Escanear Torre de Iluminación
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* Results Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Resultados del Análisis
          </h2>

          {!scanComplete && !isScanning && (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Sun className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500 max-w-xs">Apunta la cámara hacia la fuente de luz para evaluar su cumplimiento con la norma DS 43.</p>
            </div>
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Activity className="w-16 h-16 text-amber-500 mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-amber-400 animate-pulse">Calculando ángulo de inclinación y temperatura de color...</p>
            </div>
          )}

          {scanComplete && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-rose-400">Incumplimiento Detectado (DS 43)</h3>
                  <p className="text-xs text-rose-500/70">La luminaria excede los límites permitidos para zonas astronómicas.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Ángulo de Inclinación</p>
                  <p className="text-2xl font-black text-rose-500">15°</p>
                  <p className="text-xs text-zinc-500 mt-1">Límite: 0° (Horizontal)</p>
                </div>
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Temperatura Color</p>
                  <p className="text-2xl font-black text-amber-500">4000K</p>
                  <p className="text-xs text-zinc-500 mt-1">Límite: 3000K</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Acción Correctiva Recomendada</p>
                <p className="text-sm text-zinc-300">
                  Ajustar la carcasa de la luminaria para que el cristal quede paralelo al suelo (0°). Reemplazar la ampolleta por una de luz cálida (≤ 3000K) o instalar filtro ámbar.
                </p>
              </div>

              <Button className="w-full" variant="danger">
                Generar Reporte de Infracción
              </Button>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}
