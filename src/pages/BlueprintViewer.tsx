import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Map,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize,
  Move,
  AlertTriangle,
  ShieldAlert,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { Card, Button } from "../components/shared/Card";

export function BlueprintViewer() {
  const [scale, setScale] = useState(1);
  const [activeLayer, setActiveLayer] = useState<
    "all" | "structural" | "electrical" | "hvac" | "safety"
  >("all");
  const [showRiskNodes, setShowRiskNodes] = useState(true);

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.2, 0.5));
  const handleReset = () => setScale(1);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Map className="w-8 h-8 text-blue-500" />
            Visor de Planos Avanzado
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Análisis de Layout y Nodos de Riesgo
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setShowRiskNodes(!showRiskNodes)}
          >
            {showRiskNodes ? "Ocultar Nodos" : "Mostrar Nodos"}
          </Button>
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-blue-500 bg-blue-500/10 border-blue-500/20">
            <Layers className="w-5 h-5" />
            <span className="font-bold uppercase tracking-wider text-sm">
              Capa: {activeLayer}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Controls Sidebar */}
        <Card className="p-6 border-white/5 space-y-6 lg:col-span-1">
          <div>
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
              Capas del Plano
            </h3>
            <div className="space-y-2">
              {[
                { id: "all", label: "Todas las Capas" },
                { id: "structural", label: "Estructural" },
                { id: "electrical", label: "Eléctrico" },
                { id: "hvac", label: "Climatización" },
                { id: "safety", label: "Seguridad / Evacuación" },
              ].map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => setActiveLayer(layer.id as any)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                    activeLayer === layer.id
                      ? "bg-blue-500/20 border-blue-500/50 text-blue-400"
                      : "bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {layer.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
              Herramientas
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center py-4 h-auto"
                onClick={handleZoomIn}
              >
                <ZoomIn className="w-5 h-5 mb-2" />
                <span className="text-xs">Acercar</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center py-4 h-auto"
                onClick={handleZoomOut}
              >
                <ZoomOut className="w-5 h-5 mb-2" />
                <span className="text-xs">Alejar</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center py-4 h-auto"
                onClick={handleReset}
              >
                <Maximize className="w-5 h-5 mb-2" />
                <span className="text-xs">Ajustar</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center py-4 h-auto"
              >
                <Move className="w-5 h-5 mb-2" />
                <span className="text-xs">Mover</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* Blueprint Area */}
        <Card className="border-white/5 lg:col-span-3 overflow-hidden relative bg-zinc-950 min-h-[600px] flex items-center justify-center">
          {/* Grid Background */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }}
          />

          <motion.div
            className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
            drag
            dragConstraints={{ left: -500, right: 500, top: -500, bottom: 500 }}
            style={{ scale }}
          >
            {/* Simulated Blueprint Content */}
            <div className="relative w-[800px] h-[500px] border-2 border-blue-500/30 rounded-lg p-8">
              {/* Outer Walls */}
              <div className="absolute inset-4 border-4 border-zinc-700" />

              {/* Inner Walls */}
              <div className="absolute top-4 bottom-4 left-1/3 w-2 bg-zinc-700" />
              <div className="absolute top-1/2 left-1/3 right-4 h-2 bg-zinc-700" />

              {/* Rooms Labels */}
              <div className="absolute top-10 left-10 text-zinc-500 font-mono text-sm uppercase">
                Zona de Acopio
              </div>
              <div className="absolute top-10 right-10 text-zinc-500 font-mono text-sm uppercase">
                Taller Mecánico
              </div>
              <div className="absolute bottom-10 right-10 text-zinc-500 font-mono text-sm uppercase">
                Oficinas
              </div>

              {/* Risk Nodes Overlay */}
              <AnimatePresence>
                {showRiskNodes && (
                  <>
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2"
                    >
                      <div className="relative group cursor-pointer">
                        <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
                        <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center relative z-10 shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                          <AlertTriangle className="w-4 h-4 text-white" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-zinc-900 border border-red-500/30 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          <p className="text-xs font-bold text-red-400 uppercase mb-1">
                            Riesgo Químico
                          </p>
                          <p className="text-[10px] text-zinc-400">
                            Almacenamiento de solventes cerca de zona de
                            tránsito.
                          </p>
                        </div>
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      className="absolute top-3/4 right-1/4 -translate-x-1/2 -translate-y-1/2"
                    >
                      <div className="relative group cursor-pointer">
                        <div className="absolute inset-0 bg-yellow-500/20 rounded-full animate-ping" />
                        <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center relative z-10 shadow-[0_0_15px_rgba(234,179,8,0.5)]">
                          <ShieldAlert className="w-4 h-4 text-black" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-zinc-900 border border-yellow-500/30 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          <p className="text-xs font-bold text-yellow-400 uppercase mb-1">
                            Riesgo Eléctrico
                          </p>
                          <p className="text-[10px] text-zinc-400">
                            Tablero principal expuesto sin señalización
                            adecuada.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Scale Indicator */}
          <div className="absolute bottom-4 right-4 px-3 py-1 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg text-xs font-mono text-zinc-400">
            Escala: {Math.round(scale * 100)}%
          </div>
        </Card>
      </div>
    </div>
  );
}
