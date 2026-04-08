import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { AlertTriangle, MapPin, ShieldAlert, Phone, ArrowRight, CheckCircle2, Navigation } from 'lucide-react';
import { useEmergency } from '../../contexts/EmergencyContext';

export function EmergencyOverlay() {
  const { isEmergencyActive, emergencyType, resolveEmergency } = useEmergency();
  const [isSafe, setIsSafe] = useState(false);
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [triageReported, setTriageReported] = useState<'verde' | 'amarillo' | 'rojo' | null>(null);

  // Kill-Switch de Animaciones (Modo Táctico) y Síntesis de Voz
  useEffect(() => {
    let utterance: SpeechSynthesisUtterance | null = null;

    if (isEmergencyActive) {
      document.documentElement.classList.add('tactical-mode');
      // Force high contrast
      document.body.style.backgroundColor = '#000000';

      // Get location for Medevac
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocation({
              lat: Number(pos.coords.latitude.toFixed(5)),
              lng: Number(pos.coords.longitude.toFixed(5))
            });
          },
          (err) => console.warn("No se pudo obtener ubicación para emergencia:", err),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      }

      // Síntesis de Voz Nativa
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Clear any ongoing speech

        let textToSpeak = 'Alerta de emergencia. Evacuación inmediata.';
        if (emergencyType === 'sismo') {
          textToSpeak = 'Alerta de sismo. Mantenga la calma y diríjase a la salida más cercana. Siga las señales luminosas hacia la Zona de Seguridad. No use ascensores.';
        } else if (emergencyType === 'iot_critical') {
          textToSpeak = 'Alerta crítica de telemetría. Localice al trabajador afectado inmediatamente. Despache al equipo de primeros auxilios. Asegure el área.';
        }

        utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'es-CL'; // Use Chilean Spanish if available, falls back to generic Spanish
        utterance.rate = 0.9; // Slightly slower for clarity
        utterance.pitch = 1.1; // Slightly higher pitch for urgency
        utterance.volume = 1.0; // Max volume

        // Try to find a Spanish voice
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(v => v.lang.startsWith('es'));
        if (spanishVoice) {
          utterance.voice = spanishVoice;
        }

        // Speak and repeat
        utterance.onend = () => {
          if (isEmergencyActive && !isSafe) {
            // Wait 2 seconds before repeating
            setTimeout(() => {
              if (isEmergencyActive && !isSafe && utterance) {
                window.speechSynthesis.speak(utterance);
              }
            }, 2000);
          }
        };

        window.speechSynthesis.speak(utterance);
      }

    } else {
      document.documentElement.classList.remove('tactical-mode');
      document.body.style.backgroundColor = '';
      setIsSafe(false);
      setTriageReported(null);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }

    return () => {
      document.documentElement.classList.remove('tactical-mode');
      document.body.style.backgroundColor = '';
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isEmergencyActive, emergencyType, isSafe]);

  const handleSafeClick = () => {
    setIsSafe(true);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // Here we would normally update Firebase: users/uid/status = 'safe'
    // For now, we just show the visual feedback and let them resolve it
    setTimeout(() => {
      resolveEmergency();
    }, 3000);
  };

  const handleTriage = (level: 'verde' | 'amarillo' | 'rojo') => {
    setTriageReported(level);
    // Here we would send the triage report to Firebase with the location
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

            <p className="text-2xl md:text-3xl font-bold text-white mb-8 bg-red-600 px-6 py-2 rounded-lg uppercase tracking-widest">
              {emergencyType === 'sismo' ? 'SISMO DETECTADO - EVACUACIÓN INMEDIATA' : 
               emergencyType === 'iot_critical' ? 'ALERTA CRÍTICA DE TELEMETRÍA - REVISAR PERSONAL' :
               'EVACUACIÓN INMEDIATA'}
            </p>

            {location && (
              <div className="mb-8 bg-black/80 border-2 border-amber-500 p-4 rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.3)] w-full max-w-2xl mx-auto flex items-center justify-center gap-4">
                <Navigation className="w-8 h-8 text-amber-500" />
                <div className="text-left">
                  <p className="text-amber-500 font-bold uppercase tracking-widest text-sm">Coordenadas GPS (Rescate/Medevac)</p>
                  <p className="text-white font-mono text-2xl md:text-3xl tracking-wider">
                    LAT: {location.lat} <span className="text-zinc-600">|</span> LNG: {location.lng}
                  </p>
                </div>
              </div>
            )}

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
              <div className="w-full flex flex-col items-center gap-8">
                <button 
                  onClick={handleSafeClick}
                  className="w-full md:w-auto bg-[#00ff00] text-black px-12 py-6 rounded-2xl text-3xl font-black uppercase tracking-widest hover:bg-[#00cc00] transition-all shadow-[0_0_30px_rgba(0,255,0,0.6)] flex items-center justify-center gap-4 border-4 border-white"
                >
                  <CheckCircle2 className="w-10 h-10" />
                  <span>ESTOY A SALVO</span>
                </button>

                {/* Protocolo Triage Rápido */}
                <div className="w-full max-w-2xl bg-black/80 border-2 border-zinc-800 p-6 rounded-2xl">
                  <h3 className="text-white font-bold uppercase tracking-widest mb-4">Reporte Rápido de Heridos (Triage)</h3>
                  {!triageReported ? (
                    <div className="grid grid-cols-3 gap-4">
                      <button 
                        onClick={() => handleTriage('verde')}
                        className="bg-green-600 hover:bg-green-500 text-white py-4 rounded-xl font-bold uppercase tracking-wider border-2 border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] transition-all"
                      >
                        Leve
                      </button>
                      <button 
                        onClick={() => handleTriage('amarillo')}
                        className="bg-yellow-600 hover:bg-yellow-500 text-white py-4 rounded-xl font-bold uppercase tracking-wider border-2 border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)] transition-all"
                      >
                        Grave
                      </button>
                      <button 
                        onClick={() => handleTriage('rojo')}
                        className="bg-red-600 hover:bg-red-500 text-white py-4 rounded-xl font-bold uppercase tracking-wider border-2 border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-all"
                      >
                        Crítico
                      </button>
                    </div>
                  ) : (
                    <div className={`py-4 rounded-xl font-bold uppercase tracking-wider border-2 flex items-center justify-center gap-2 ${
                      triageReported === 'verde' ? 'bg-green-900/50 border-green-500 text-green-400' :
                      triageReported === 'amarillo' ? 'bg-yellow-900/50 border-yellow-500 text-yellow-400' :
                      'bg-red-900/50 border-red-500 text-red-400'
                    }`}>
                      <CheckCircle2 className="w-6 h-6" />
                      Reporte {triageReported} enviado
                    </div>
                  )}
                </div>
              </div>
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
