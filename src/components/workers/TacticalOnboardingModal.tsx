import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, CheckCircle2, Loader2, PenTool, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import { saveBunkerKnowledge, saveForSync } from '../../utils/pwa-offline';
import { useNotifications } from '../../contexts/NotificationContext';
import { useProject } from '../../contexts/ProjectContext';

interface TacticalOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  workerData: {
    id?: string;
    name: string;
    role: string;
    rut?: string;
  } | null;
}

export function TacticalOnboardingModal({ isOpen, onClose, workerData }: TacticalOnboardingModalProps) {
  const { selectedProject } = useProject();
  const [step, setStep] = useState<'intro' | 'sign' | 'generating' | 'success'>('intro');
  const [isDrawing, setIsDrawing] = useState(false);
  const [svgPaths, setSvgPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { addNotification } = useNotifications();

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    
    setCurrentPath(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    
    setCurrentPath(prev => `${prev} L ${x.toFixed(1)} ${y.toFixed(1)}`);
  };

  const stopDrawing = () => {
    if (isDrawing && currentPath) {
      setSvgPaths(prev => [...prev, currentPath]);
      setCurrentPath('');
    }
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSvgPaths([]);
    setCurrentPath('');
  };

  const generatePDFs = async () => {
    if (!workerData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL('image/png');
    
    // Generate Geometric SVG Signature
    const allPaths = [...svgPaths, currentPath].filter(p => p.trim() !== '').join(' ');
    const geometricSvgSignature = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><path d="${allPaths}" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    
    setStep('generating');

    const docs = [
      { title: 'Registro ODI (Derecho a Saber)', content: 'Obligación de Informar los Riesgos Laborales...' },
      { title: 'Registro de Inducción (Ley 16.744)', content: 'Inducción de Seguridad y Salud Ocupacional...' },
      { title: 'Registro de Entrega de EPP', content: 'Comprobante de Recepción de Elementos de Protección Personal...' },
      { title: 'Registro de Entrega de RIOSH', content: 'Recepción del Reglamento Interno de Orden, Higiene y Seguridad...' },
      { title: 'Pacto de Horas Extraordinarias', content: 'Acuerdo de Jornada Excepcional / Horas Extras...' }
    ];

    try {
      for (const doc of docs) {
        const pdf = new jsPDF();
        pdf.setFontSize(16);
        pdf.text(doc.title, 20, 20);
        
        pdf.setFontSize(12);
        pdf.text(`Trabajador: ${workerData.name}`, 20, 40);
        pdf.text(`Cargo: ${workerData.role}`, 20, 50);
        pdf.text(`Fecha: ${new Date().toLocaleDateString()}`, 20, 60);
        
        pdf.text(doc.content, 20, 80);
        
        // Add Signature
        pdf.text('Firma del Trabajador:', 20, 140);
        pdf.addImage(signatureDataUrl, 'PNG', 20, 150, 80, 40);
        
        const pdfBlob = pdf.output('blob');
        
        // Save to IndexedDB (Bunker) with Geometric SVG Signature metadata
        await saveBunkerKnowledge(`doc_${workerData.name.replace(/\s+/g, '_')}_${doc.title.replace(/\s+/g, '_')}`, {
          workerName: workerData.name,
          documentTitle: doc.title,
          blob: pdfBlob,
          geometricSignature: geometricSvgSignature,
          date: new Date().toISOString()
        });
        
        // Queue for deferred sync to Cloud Storage
        const file = new File([pdfBlob], `${doc.title.replace(/\s+/g, '_')}_${workerData.name.replace(/\s+/g, '_')}.pdf`, { type: 'application/pdf' });
        
        await saveForSync({
          type: 'upload',
          collection: 'documents',
          data: {
            storagePath: `projects/${selectedProject?.id || 'global'}/workers/${workerData.id || 'new'}/documents/${file.name}`,
            documentData: {
              title: doc.title,
              workerId: workerData.id || 'new',
              workerName: workerData.name,
              projectId: selectedProject?.id || 'global',
              type: 'legal_onboarding',
              status: 'signed',
              createdAt: new Date().toISOString(),
              geometricSignature: geometricSvgSignature
            }
          },
          file: file
        });
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStep('success');
      addNotification({
        title: 'Pack de Ingreso Generado',
        message: 'Los 5 documentos legales han sido firmados y guardados en el Búnker local.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error generating PDFs:', error);
      addNotification({
        title: 'Error',
        message: 'Hubo un problema al generar los documentos.',
        type: 'error'
      });
      setStep('sign');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && workerData && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative"
          >
            {step !== 'generating' && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white z-10"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            <div className="p-8 flex flex-col items-center text-center">
              {step === 'intro' && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center w-full">
                  <div className="w-20 h-20 rounded-3xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30 mb-6">
                    <FileText className="w-10 h-10 text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">Pack de Ingreso Táctico</h2>
                  <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
                    Generaremos automáticamente los 5 documentos legales obligatorios para <strong>{workerData.name}</strong> ({workerData.role}).
                  </p>
                  <ul className="text-left text-xs text-zinc-500 space-y-2 mb-8 w-full bg-zinc-800/30 p-4 rounded-xl border border-white/5">
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Registro ODI (Derecho a Saber)</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Inducción Ley 16.744</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Entrega de EPP</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Entrega de RIOSH</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Pacto de Horas Extraordinarias</li>
                  </ul>
                  <button
                    onClick={() => setStep('sign')}
                    className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                  >
                    Proceder a Firma
                  </button>
                </motion.div>
              )}

              {step === 'sign' && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center w-full">
                  <div className="flex items-center gap-3 mb-4">
                    <PenTool className="w-6 h-6 text-emerald-500" />
                    <h2 className="text-xl font-black text-zinc-900 dark:text-white">Firma del Trabajador</h2>
                  </div>
                  <p className="text-zinc-400 text-xs mb-4">
                    Esta firma geométrica vectorial se estampará en los 5 documentos legales.
                  </p>
                  
                  <div className="w-full bg-white rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 overflow-hidden mb-4 relative">
                    <canvas
                      ref={canvasRef}
                      width={400}
                      height={200}
                      className="w-full h-[200px] touch-none cursor-crosshair"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseOut={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                    <button 
                      onClick={clearCanvas}
                      className="absolute top-2 right-2 text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-1 rounded-md font-bold uppercase"
                    >
                      Limpiar
                    </button>
                  </div>

                  <button
                    onClick={generatePDFs}
                    className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
                  >
                    Firmar y Generar Documentos
                  </button>
                </motion.div>
              )}

              {step === 'generating' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-8">
                  <Loader2 className="w-16 h-16 text-blue-500 animate-spin mb-6" />
                  <h2 className="text-xl font-black text-white mb-2">Renderizado Inmutable</h2>
                  <p className="text-zinc-400 text-sm">Estampando firma vectorial en los 5 documentos...</p>
                </motion.div>
              )}

              {step === 'success' && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                  <h2 className="text-2xl font-black text-white mb-2">¡Onboarding Completado!</h2>
                  <p className="text-zinc-400 text-sm mb-8 text-center">
                    Los documentos han sido generados, firmados y guardados en el Búnker local. Se sincronizarán automáticamente con Google Drive cuando haya conexión.
                  </p>
                  <button
                    onClick={onClose}
                    className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                  >
                    Cerrar
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
