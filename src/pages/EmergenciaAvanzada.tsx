import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Activity,
  Map,
  Users,
  Radio,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Card, Button } from "../components/shared/Card";

export function EmergenciaAvanzada() {
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "comms" | "resources">(
    "map",
  );

  const handleTriggerEmergency = () => {
    setIsEmergencyActive(true);
  };

  const handleResolveEmergency = () => {
    setIsEmergencyActive(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-8 h-8 text-red-500" />
            Emergencia Avanzada y Sismos
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Orquestación del Caos Post-Evento Crítico
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isEmergencyActive ? (
            <Button
              variant="danger"
              onClick={handleResolveEmergency}
              className="animate-pulse"
            >
              Finalizar Emergencia
            </Button>
          ) : (
            <Button variant="danger" onClick={handleTriggerEmergency}>
              Simular Sismo 7.5
            </Button>
          )}
        </div>
      </div>

      {isEmergencyActive && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/50 flex items-start gap-4"
        >
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 animate-pulse">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-red-500 uppercase tracking-wider">
              Alerta Sísmica Detectada
            </h2>
            <p className="text-sm text-red-400/80 mt-1">
              Magnitud estimada: 7.5. Epicentro a 45km. Activando protocolos de
              evacuación y bloqueando accesos a zonas de alto riesgo
              estructural.
            </p>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Navigation & Status */}
        <div className="space-y-6">
          <Card className="p-4 border-white/5">
            <div className="flex flex-col space-y-2">
              <button
                onClick={() => setActiveTab("map")}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors ${activeTab === "map" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-zinc-400 hover:bg-zinc-900"}`}
              >
                <div className="flex items-center gap-3">
                  <Map className="w-5 h-5" />
                  <span className="font-bold uppercase text-sm">
                    Mapa Dinámico A*
                  </span>
                </div>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveTab("comms")}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors ${activeTab === "comms" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-zinc-400 hover:bg-zinc-900"}`}
              >
                <div className="flex items-center gap-3">
                  <Radio className="w-5 h-5" />
                  <span className="font-bold uppercase text-sm">
                    Comunicaciones
                  </span>
                </div>
                {isEmergencyActive && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                )}
              </button>
              <button
                onClick={() => setActiveTab("resources")}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors ${activeTab === "resources" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-zinc-400 hover:bg-zinc-900"}`}
              >
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5" />
                  <span className="font-bold uppercase text-sm">
                    Brigadas y Recursos
                  </span>
                </div>
              </button>
            </div>
          </Card>

          <Card className="p-6 border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-zinc-400" />
              Estado de Zonas
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-white/5">
                <span className="text-sm text-zinc-300">Túnel Principal</span>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-full ${isEmergencyActive ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}`}
                >
                  {isEmergencyActive ? "BLOQUEADO" : "OPERATIVO"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-white/5">
                <span className="text-sm text-zinc-300">
                  Planta Procesadora
                </span>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-full ${isEmergencyActive ? "bg-yellow-500/20 text-yellow-400" : "bg-emerald-500/20 text-emerald-400"}`}
                >
                  {isEmergencyActive ? "EVACUANDO" : "OPERATIVO"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-white/5">
                <span className="text-sm text-zinc-300">Campamento</span>
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                  ZONA SEGURA
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Main Content Area */}
        <Card className="p-6 border-white/5 lg:col-span-2 min-h-[500px] flex flex-col">
          {activeTab === "map" && (
            <div className="flex-1 flex flex-col">
              <h3 className="text-lg font-bold text-white mb-4">
                Recálculo de Rutas (A-Star)
              </h3>
              <div className="flex-1 bg-zinc-900 rounded-xl border border-white/5 relative overflow-hidden flex items-center justify-center">
                {/* Simulated Map */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)",
                    backgroundSize: "24px 24px",
                  }}
                />

                {isEmergencyActive ? (
                  <div className="relative w-full h-full p-8">
                    {/* Blocked Path */}
                    <div className="absolute top-1/2 left-1/4 w-32 h-2 bg-red-500/50 rotate-45" />
                    <div className="absolute top-1/2 left-1/4 w-32 h-2 bg-red-500/50 -rotate-45" />
                    <span className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-8 text-xs font-bold text-red-500 bg-black/50 px-2 py-1 rounded">
                      DERRUMBE
                    </span>

                    {/* New Route */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      <path
                        d="M 100 100 L 100 300 L 400 300"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="4"
                        strokeDasharray="8 8"
                        className="animate-[dash_1s_linear_infinite]"
                      />
                    </svg>
                    <div className="absolute top-[80px] left-[80px] w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div className="absolute top-[280px] left-[380px] w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.5)]">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-zinc-500">
                    <Map className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Monitoreo en tiempo real activo.</p>
                    <p className="text-xs mt-1">
                      Esperando evento crítico para recalcular rutas.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "comms" && (
            <div className="flex-1 flex flex-col">
              <h3 className="text-lg font-bold text-white mb-4">
                Canal de Emergencia
              </h3>
              <div className="flex-1 bg-zinc-900 rounded-xl border border-white/5 p-4 flex flex-col justify-end space-y-4">
                {isEmergencyActive ? (
                  <>
                    <div className="self-start bg-zinc-800 p-3 rounded-lg rounded-tl-none max-w-[80%]">
                      <p className="text-xs text-zinc-400 mb-1">
                        Sistema Automático - 14:32
                      </p>
                      <p className="text-sm text-white">
                        Alerta sísmica emitida. Iniciando protocolo de
                        evacuación general.
                      </p>
                    </div>
                    <div className="self-start bg-zinc-800 p-3 rounded-lg rounded-tl-none max-w-[80%]">
                      <p className="text-xs text-zinc-400 mb-1">
                        Sensor Sector B - 14:33
                      </p>
                      <p className="text-sm text-yellow-400">
                        Caída de presión en red de agua contra incendios.
                      </p>
                    </div>
                    <div className="self-end bg-blue-600/20 border border-blue-500/30 p-3 rounded-lg rounded-tr-none max-w-[80%]">
                      <p className="text-xs text-blue-400 mb-1">
                        Comando Central - 14:35
                      </p>
                      <p className="text-sm text-white">
                        Brigada Alpha, diríjanse al Sector B para evaluación
                        visual. Resto del personal, mantengan ruta a Zona Segura
                        1.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-center text-zinc-500 my-auto">
                    <Radio className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Canal en silencio.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "resources" && (
            <div className="flex-1 flex flex-col">
              <h3 className="text-lg font-bold text-white mb-4">
                Despliegue de Brigadas
              </h3>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <span className="font-bold text-blue-400">A</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-white">
                        Brigada Alpha (Rescate)
                      </h4>
                      <p className="text-xs text-zinc-400">
                        4 Miembros • Equipamiento Pesado
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${isEmergencyActive ? "bg-yellow-500/20 text-yellow-400" : "bg-zinc-800 text-zinc-500"}`}
                  >
                    {isEmergencyActive ? "EN TERRENO" : "STANDBY"}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                      <span className="font-bold text-red-400">B</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-white">
                        Brigada Bravo (Hazmat)
                      </h4>
                      <p className="text-xs text-zinc-400">
                        3 Miembros • Trajes Nivel A
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-500">
                    STANDBY
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
