import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Printer, ShieldAlert, FileText, Download, CheckCircle2, AlertTriangle, FileCheck, Lock } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';

export function ImmutableRender() {
  const [isRendering, setIsRendering] = useState(false);
  const [renderComplete, setRenderComplete] = useState(false);

  const handleRender = () => {
    setIsRendering(true);
    setRenderComplete(false);
    
    // Simulate Puppeteer rendering delay
    setTimeout(() => {
      setIsRendering(false);
      setRenderComplete(true);
    }, 3000);
  };

  // Gate: server-side Puppeteer rendering for legal PDFs (notarized hash,
  // long-form audit reports) is part of the advanced analytics / branded
  // export bundle. Diamante+ aligns with the Custom Branding flag — same
  // tier that gets the white-label PDF output.
  return (
    <PremiumFeatureGuard
      feature="canUseCustomBranding"
      featureName="Renderizado Inmutable"
      description="La generación de PDFs legales con rendering server-side y branding personalizado está disponible desde el plan Diamante."
    >
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Printer className="w-8 h-8 text-fuchsia-500" />
            Renderizado Inmutable
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Generación de PDFs con Valor Legal (Puppeteer)
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20">
          <Lock className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Firma Digital
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Render Controls */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-fuchsia-500" />
            Documentos Disponibles
          </h2>

          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-zinc-900 border border-fuchsia-500/30 flex items-center justify-between cursor-pointer hover:bg-zinc-800 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-fuchsia-500" />
                <div>
                  <h3 className="text-sm font-bold text-white">Matriz IPER Consolidada</h3>
                  <p className="text-xs text-zinc-400">Versión 2.4 - Aprobada</p>
                </div>
              </div>
              <div className="w-4 h-4 rounded-full border-2 border-fuchsia-500 bg-fuchsia-500" />
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between cursor-pointer hover:bg-zinc-800 transition-colors opacity-50">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-zinc-500" />
                <div>
                  <h3 className="text-sm font-bold text-white">Reporte de Incidentes Mensual</h3>
                  <p className="text-xs text-zinc-400">Marzo 2026</p>
                </div>
              </div>
              <div className="w-4 h-4 rounded-full border-2 border-zinc-600" />
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between cursor-pointer hover:bg-zinc-800 transition-colors opacity-50">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-zinc-500" />
                <div>
                  <h3 className="text-sm font-bold text-white">Auditoría SUSESO</h3>
                  <p className="text-xs text-zinc-400">Pendiente de firma</p>
                </div>
              </div>
              <div className="w-4 h-4 rounded-full border-2 border-zinc-600" />
            </div>
          </div>

          <Button 
            className="w-full py-4 text-lg" 
            onClick={handleRender} 
            disabled={isRendering}
          >
            {isRendering ? (
              <>
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2" />
                Renderizando en Cloud...
              </>
            ) : (
              <>
                <Printer className="w-5 h-5 mr-2" />
                Generar PDF Inmutable
              </>
            )}
          </Button>
        </Card>

        {/* Status Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-fuchsia-500" />
            Estado del Proceso
          </h2>

          {!isRendering && !renderComplete && (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <FileText className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Selecciona un documento para generar su versión inmutable con valor legal.</p>
            </div>
          )}

          {isRendering && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <motion.div
                animate={{ 
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Printer className="w-16 h-16 text-fuchsia-500 mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-fuchsia-400 animate-pulse">Instanciando Chrome Headless...</p>
              <p className="text-xs text-zinc-500 mt-2">inyectando estilos y calculando paginación</p>
            </div>
          )}

          {renderComplete && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
                <p className="text-lg font-bold text-white">Renderizado Exitoso</p>
                <p className="text-sm text-zinc-400">El documento ha sido sellado criptográficamente.</p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-500 uppercase">Hash SHA-256</span>
                  <span className="text-xs font-mono text-fuchsia-400">8f4e...2a1b</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-500 uppercase">Tamaño</span>
                  <span className="text-xs text-white">2.4 MB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-500 uppercase">Páginas</span>
                  <span className="text-xs text-white">14</span>
                </div>
              </div>

              <div className="flex gap-4">
                <Button className="flex-1">
                  <Download className="w-4 h-4 mr-2" />
                  Descargar PDF
                </Button>
                <Button variant="secondary" className="flex-1">
                  <Lock className="w-4 h-4 mr-2" />
                  Verificar Firma
                </Button>
              </div>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
    </PremiumFeatureGuard>
  );
}
