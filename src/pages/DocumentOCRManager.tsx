import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Upload, Scan, FileSearch, ShieldAlert, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { extractAcademicSummary } from '../services/geminiService'; // Reusing the Gemini service for OCR simulation

export function DocumentOCRManager() {
  const [file, setFile] = useState<File | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ onuNumber: string, chemicalName: string, hazards: string[], isolationDistance: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setScanResult(null);
    }
  };

  const handleScan = async () => {
    if (!file) return;
    setIsScanning(true);
    
    try {
      // In a real implementation, we would send the file to Cloud Vision API or Gemini Pro Vision
      // Here we simulate the OCR and data extraction process
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Simulated extracted data based on a hypothetical MSDS
      setScanResult({
        onuNumber: 'UN 1005',
        chemicalName: 'Amoníaco, Anhidro',
        hazards: ['Gas Tóxico', 'Corrosivo', 'Peligro de Inhalación'],
        isolationDistance: '300 metros (Derrame Pequeño) / 1000 metros (Derrame Grande)'
      });
      
    } catch (error) {
      console.error("Error scanning document:", error);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Scan className="w-8 h-8 text-violet-500" />
            Motor OCR Hazmat
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Extracción de Datos HDS/MSDS con IA
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-violet-500 bg-violet-500/10 border-violet-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Cruce Automático GRE
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-violet-500" />
            Cargar Documento
          </h2>

          <div 
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${file ? 'border-violet-500 bg-violet-500/5' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".pdf,image/*"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="flex flex-col items-center gap-3">
                <FileText className="w-12 h-12 text-violet-500" />
                <div>
                  <p className="text-sm font-bold text-white">{file.name}</p>
                  <p className="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 cursor-pointer">
                <Upload className="w-12 h-12 text-zinc-600" />
                <div>
                  <p className="text-sm font-bold text-zinc-300">Haz clic para subir HDS/MSDS</p>
                  <p className="text-xs text-zinc-500">Soporta PDF, JPG, PNG</p>
                </div>
              </div>
            )}
          </div>

          <Button 
            className="w-full py-4 text-lg" 
            onClick={handleScan} 
            disabled={!file || isScanning}
          >
            {isScanning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Procesando con Visión IA...
              </>
            ) : (
              <>
                <Scan className="w-5 h-5 mr-2" />
                Escanear y Extraer Datos
              </>
            )}
          </Button>
        </Card>

        {/* Results Panel */}
        <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
          {/* Background effect */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-violet-500" />
            Resultados del Análisis
          </h2>

          {!scanResult && !isScanning && (
            <div className="flex flex-col items-center justify-center h-48 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <FileSearch className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Sube un documento para extraer información crítica.</p>
            </div>
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <motion.div
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Scan className="w-16 h-16 text-violet-500 mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-violet-400 animate-pulse">Analizando estructura molecular y números ONU...</p>
            </div>
          )}

          {scanResult && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-400">Extracción Exitosa</h3>
                  <p className="text-xs text-emerald-500/70">Datos cruzados con la Guía de Respuesta a Emergencias (GRE).</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Número ONU</p>
                  <p className="text-2xl font-black text-white">{scanResult.onuNumber}</p>
                </div>
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Sustancia</p>
                  <p className="text-lg font-bold text-violet-400 truncate">{scanResult.chemicalName}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Peligros Identificados</p>
                <div className="flex flex-wrap gap-2">
                  {scanResult.hazards.map((hazard, idx) => (
                    <span key={idx} className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {hazard}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-1">Distancia de Aislamiento Inicial (GRE)</p>
                <p className="text-sm font-bold text-white">{scanResult.isolationDistance}</p>
              </div>

              <Button className="w-full" variant="secondary">
                Vincular al Zettelkasten
              </Button>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}
