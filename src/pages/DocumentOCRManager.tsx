import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Upload, Scan, FileSearch, ShieldAlert, CheckCircle2, AlertTriangle, Loader2, WifiOff, Save } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import Tesseract from 'tesseract.js';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { useProject } from '../contexts/ProjectContext';

export function DocumentOCRManager() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [scanResult, setScanResult] = useState<{ 
    rawText: string;
    type: string;
    workerName?: string;
    date?: string;
    risks?: string[];
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOnline = useOnlineStatus();
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setScanResult(null);
      setOcrProgress(0);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const extractStructuredData = (text: string) => {
    // Basic offline regex extraction for common permit fields
    const nameMatch = text.match(/(?:nombre|trabajador|solicitante)[\s:]+([A-Za-z\s]+)/i);
    const dateMatch = text.match(/(?:fecha)[\s:]+([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i);
    
    let type = 'Documento General';
    if (text.toLowerCase().includes('permiso de trabajo') || text.toLowerCase().includes('ptw')) {
      type = 'Permiso de Trabajo';
    } else if (text.toLowerCase().includes('charla') || text.toLowerCase().includes('odi')) {
      type = 'Registro de Capacitación';
    } else if (text.toLowerCase().includes('hds') || text.toLowerCase().includes('msds')) {
      type = 'Hoja de Datos de Seguridad';
    }

    const risks = [];
    if (text.toLowerCase().includes('altura')) risks.push('Trabajo en Altura');
    if (text.toLowerCase().includes('caliente') || text.toLowerCase().includes('soldadura')) risks.push('Trabajo en Caliente');
    if (text.toLowerCase().includes('confinado')) risks.push('Espacio Confinado');
    if (text.toLowerCase().includes('eléctrico') || text.toLowerCase().includes('tension')) risks.push('Riesgo Eléctrico');

    return {
      rawText: text,
      type,
      workerName: nameMatch ? nameMatch[1].trim() : 'No detectado',
      date: dateMatch ? dateMatch[1] : new Date().toLocaleDateString(),
      risks: risks.length > 0 ? risks : ['No especificados']
    };
  };

  const handleScan = async () => {
    if (!file) return;
    setIsScanning(true);
    setOcrProgress(0);
    
    try {
      const result = await Tesseract.recognize(
        file,
        'spa',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        }
      );
      
      const extractedText = result.data.text;
      const structured = extractStructuredData(extractedText);
      setScanResult(structured);
      
    } catch (error) {
      console.error("Error scanning document:", error);
      alert("Error al procesar el documento. Intente con una imagen más clara.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveToZettelkasten = async () => {
    if (!scanResult || !selectedProject) return;
    setIsSaving(true);
    try {
      await addNode({
        type: NodeType.DOCUMENT,
        title: `${scanResult.type} - ${scanResult.workerName}`,
        description: `Documento digitalizado vía OCR local.\n\nFecha: ${scanResult.date}\nRiesgos: ${scanResult.risks?.join(', ')}\n\nTexto extraído:\n${scanResult.rawText.substring(0, 500)}...`,
        tags: ['OCR', scanResult.type, ...(scanResult.risks || [])],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          ocr: true,
          workerName: scanResult.workerName,
          date: scanResult.date
        }
      });
      alert('Documento guardado exitosamente en el Zettelkasten.');
      setFile(null);
      setPreviewUrl(null);
      setScanResult(null);
    } catch (error) {
      console.error("Error saving node:", error);
      alert("Error al guardar en la red de riesgos.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Scan className="w-8 h-8 text-emerald-500" />
            Escáner OCR Local
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Digitalización de Permisos y Tarjetas de Seguridad (Offline)
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
          {!isOnline ? <WifiOff className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          <span className="font-bold uppercase tracking-wider text-sm">
            Procesamiento en Dispositivo (Edge)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-500" />
            Cargar Documento Físico
          </h2>

          <div 
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${file ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
            />
            {previewUrl ? (
              <div className="flex flex-col items-center gap-4">
                <img src={previewUrl} alt="Preview" className="max-h-48 rounded-lg object-contain" />
                <div>
                  <p className="text-sm font-bold text-white">{file?.name}</p>
                  <p className="text-xs text-zinc-500">{((file?.size || 0) / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Scan className="w-12 h-12 text-zinc-600" />
                <div>
                  <p className="text-sm font-bold text-zinc-300">Toma una foto o sube una imagen</p>
                  <p className="text-xs text-zinc-500">Permisos de Trabajo, Tarjetas de Observación, ODI</p>
                </div>
              </div>
            )}
          </div>

          <Button 
            className="w-full py-4 text-lg bg-emerald-600 hover:bg-emerald-500 text-white" 
            onClick={handleScan} 
            disabled={!file || isScanning}
          >
            {isScanning ? (
              <div className="flex flex-col items-center w-full">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Procesando OCR...</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
                  <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${ocrProgress}%` }}></div>
                </div>
              </div>
            ) : (
              <>
                <Scan className="w-5 h-5 mr-2" />
                Escanear y Extraer Texto
              </>
            )}
          </Button>
        </Card>

        {/* Results Panel */}
        <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
          {/* Background effect */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-emerald-500" />
            Resultados de Extracción
          </h2>

          {!scanResult && !isScanning && (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <FileSearch className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Sube una imagen para extraer el texto mediante IA local.</p>
            </div>
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <motion.div
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Scan className="w-16 h-16 text-emerald-500 mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-emerald-400 animate-pulse">Reconociendo caracteres (Tesseract.js)...</p>
              <p className="text-xs text-zinc-500 mt-2">{ocrProgress}% completado</p>
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
                  <h3 className="text-sm font-bold text-emerald-400">Extracción Completada</h3>
                  <p className="text-xs text-emerald-500/70">Datos estructurados localmente sin conexión a internet.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Tipo de Documento</p>
                  <p className="text-sm font-bold text-white">{scanResult.type}</p>
                </div>
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Fecha Detectada</p>
                  <p className="text-sm font-bold text-emerald-400 truncate">{scanResult.date}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Trabajador / Solicitante</p>
                <p className="text-lg font-bold text-white">{scanResult.workerName}</p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Riesgos Identificados</p>
                <div className="flex flex-wrap gap-2">
                  {scanResult.risks?.map((risk, idx) => (
                    <span key={idx} className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {risk}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-white/5 max-h-32 overflow-y-auto custom-scrollbar">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Texto Crudo Extraído</p>
                <p className="text-xs text-zinc-400 whitespace-pre-wrap">{scanResult.rawText}</p>
              </div>

              <Button 
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white" 
                onClick={handleSaveToZettelkasten}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                Guardar en Zettelkasten
              </Button>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}
