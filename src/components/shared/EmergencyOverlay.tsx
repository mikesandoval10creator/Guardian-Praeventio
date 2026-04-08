import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { AlertTriangle, MapPin, ShieldAlert, Phone, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useEmergency } from '../../contexts/EmergencyContext';

export function EmergencyOverlay() {
  const { isEmergencyActive, emergencyType, resolveEmergency } = useEmergency();
  const [isSafe, setIsSafe] = useState(false);

  // Kill-Switch de Animaciones (Modo Táctico)
  useEffect(() => {
    if (isEmergencyActive) {
      document.documentElement.classList.add('tactical-mode');
      // Force high contrast
      document.body.style.backgroundColor = '#000000';
    } else {
      document.documentElement.classList.remove('tactical-mode');
      document.body.style.backgroundColor = '';
      setIsSafe(false);
    }
    return () => {
      document.documentElement.classList.remove('tactical-mode');
      document.body.style.backgroundColor = '';
    };
  }, [isEmergencyActive]);

  const handleSafeClick = () => {
    setIsSafe(true);
    // Here we would normally update Firebase: users/uid/status = 'safe'
    // For now, we just show the visual feedback and let them resolve it
    setTimeout(() => {
      resolveEmergency();
    }, 3000);
  };

  return (
    <MotionConfig reducedMotion={isEmergencyActive ? "always" : "user"}>
      <AnimatePresence>
        {isEmergencyActive && (
          <motion.div
            key="emergency-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center text-[#00ff00] overflow-hidden font-mono"
          >
          {/* Pulsing background effect - Disabled in tactical mode via MotionConfig, but kept for structure */}
          <div className="absolute inset-0 bg-[#110000] mix-blend-multiply" />

          <div className="relative z-10 w-full max-w-4xl p-6 flex flex-col items-center text-center">
            <div className="w-32 h-32 bg-[#00ff00] rounded-full flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(0,255,0,0.5)]">
              <ShieldAlert className="w-16 h-16 text-black" />
            </div>

            <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-4 text-red-500 drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]">
              ALERTA DE EMERGENCIA
            </h1>

            <p className="text-2xl md:text-3xl font-bold text-white mb-12 bg-red-600 px-6 py-2 rounded-lg uppercase tracking-widest">
              {emergencyType === 'sismo' ? 'SISMO DETECTADO - EVACUACIÓN INMEDIATA' : 
               emergencyType === 'iot_critical' ? 'ALERTA CRÍTICA DE TELEMETRÍA - REVISAR PERSONAL' :
               'EVACUACIÓN INMEDIATA'}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-12">
              <div className="bg-black/80 p-6 rounded-2xl border-2 border-[#00ff00] text-left shadow-[0_0_15px_rgba(0,255,0,0.2)]">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-[#00ff00]">
                  <MapPin className="w-6 h-6" />
                  {emergencyType === 'iot_critical' ? 'Protocolo de Rescate' : 'Ruta de Evacuación'}
                </h3>
                <ul className="space-y-4">
                  {emergencyType === 'iot_critical' ? (
                    <>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">1</div>
                        <p className="text-lg text-white">Localice al trabajador afectado inmediatamente en el Mapa Vivo.</p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">2</div>
                        <p className="text-lg text-white">Despache al equipo de primeros auxilios al sector.</p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">3</div>
                        <p className="text-lg text-white">Asegure el área y detenga la maquinaria cercana.</p>
                      </li>
                    </>
                  ) : (
                    <>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">1</div>
                        <p className="text-lg text-white">Mantenga la calma y diríjase a la salida más cercana.</p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">2</div>
                        <p className="text-lg text-white">Siga las señales luminosas hacia la Zona de Seguridad.</p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#00ff00] text-black flex items-center justify-center font-bold shrink-0">3</div>
                        <p className="text-lg text-white">No use ascensores. Utilice las escaleras de emergencia.</p>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className="bg-black/80 p-6 rounded-2xl border-2 border-red-500 text-left shadow-[0_0_15px_rgba(255,0,0,0.2)] flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-red-500">
                    <Phone className="w-6 h-6" />
                    Contactos de Emergencia
                  </h3>
                  <ul className="space-y-3">
                    <li className="flex items-center justify-between bg-red-900/20 p-3 rounded-lg border border-red-500/30">
                      <span className="font-medium text-white">Ambulancia (SAMU)</span>
                      <span className="font-bold text-xl text-red-400">131</span>
                    </li>
                    <li className="flex items-center justify-between bg-red-900/20 p-3 rounded-lg border border-red-500/30">
                      <span className="font-medium text-white">Bomberos</span>
                      <span className="font-bold text-xl text-red-400">132</span>
                    </li>
                    <li className="flex items-center justify-between bg-red-900/20 p-3 rounded-lg border border-red-500/30">
                      <span className="font-medium text-white">Carabineros</span>
                      <span className="font-bold text-xl text-red-400">133</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Botón "Estoy a Salvo" Unificado */}
            {!isSafe ? (
              <button 
                onClick={handleSafeClick}
                className="w-full md:w-auto bg-[#00ff00] text-black px-12 py-6 rounded-2xl text-3xl font-black uppercase tracking-widest hover:bg-[#00cc00] transition-all shadow-[0_0_30px_rgba(0,255,0,0.6)] flex items-center justify-center gap-4 border-4 border-white"
              >
                <CheckCircle2 className="w-10 h-10" />
                <span>ESTOY A SALVO</span>
              </button>
            ) : (
              <div className="bg-white text-black px-12 py-6 rounded-2xl text-2xl font-black uppercase tracking-widest shadow-[0_0_30px_rgba(255,255,255,0.6)] flex items-center justify-center gap-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <span>ESTADO REGISTRADO. ESPERE INSTRUCCIONES.</span>
              </div>
            )}

            <button 
              onClick={resolveEmergency}
              className="mt-8 text-zinc-500 hover:text-white uppercase tracking-widest text-sm font-bold underline decoration-zinc-500 underline-offset-4"
            >
              (Admin) Desactivar Alarma
            </button>
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
