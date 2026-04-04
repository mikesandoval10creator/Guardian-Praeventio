import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, MapPin, ShieldAlert, Phone, ArrowRight } from 'lucide-react';
import { useEmergency } from '../../contexts/EmergencyContext';

export function EmergencyOverlay() {
  const { isEmergencyActive, emergencyType, resolveEmergency } = useEmergency();

  return (
    <AnimatePresence>
      {isEmergencyActive && (
        <motion.div
          key="emergency-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] bg-red-600 flex flex-col items-center justify-center text-white overflow-hidden"
        >
        {/* Pulsing background effect */}
        <motion.div
          animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 bg-red-700 mix-blend-multiply"
        />

        <div className="relative z-10 w-full max-w-4xl p-6 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: 'spring', bounce: 0.5 }}
            className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-red-900/50"
          >
            <ShieldAlert className="w-16 h-16 text-red-600" />
          </motion.div>

          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-4"
          >
            ALERTA DE EMERGENCIA
          </motion.h1>

          <motion.p 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-2xl md:text-3xl font-bold text-red-100 mb-12"
          >
            {emergencyType === 'sismo' ? 'SISMO DETECTADO - EVACUACIÓN INMEDIATA' : 
             emergencyType === 'iot_critical' ? 'ALERTA CRÍTICA DE TELEMETRÍA - REVISAR PERSONAL' :
             'EVACUACIÓN INMEDIATA'}
          </motion.p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-12">
            <motion.div 
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 text-left"
            >
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <MapPin className="w-6 h-6" />
                {emergencyType === 'iot_critical' ? 'Protocolo de Rescate' : 'Ruta de Evacuación'}
              </h3>
              <ul className="space-y-4">
                {emergencyType === 'iot_critical' ? (
                  <>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">1</div>
                      <p className="text-lg">Localice al trabajador afectado inmediatamente en el Mapa Vivo.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">2</div>
                      <p className="text-lg">Despache al equipo de primeros auxilios al sector.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">3</div>
                      <p className="text-lg">Asegure el área y detenga la maquinaria cercana.</p>
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">1</div>
                      <p className="text-lg">Mantenga la calma y diríjase a la salida más cercana.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">2</div>
                      <p className="text-lg">Siga las señales luminosas hacia la Zona de Seguridad.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-red-600 flex items-center justify-center font-bold shrink-0">3</div>
                      <p className="text-lg">No use ascensores. Utilice las escaleras de emergencia.</p>
                    </li>
                  </>
                )}
              </ul>
            </motion.div>

            <motion.div 
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 text-left flex flex-col justify-between"
            >
              <div>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Phone className="w-6 h-6" />
                  Contactos de Emergencia
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-center justify-between bg-black/20 p-3 rounded-lg">
                    <span className="font-medium">Ambulancia (SAMU)</span>
                    <span className="font-bold text-xl">131</span>
                  </li>
                  <li className="flex items-center justify-between bg-black/20 p-3 rounded-lg">
                    <span className="font-medium">Bomberos</span>
                    <span className="font-bold text-xl">132</span>
                  </li>
                  <li className="flex items-center justify-between bg-black/20 p-3 rounded-lg">
                    <span className="font-medium">Carabineros</span>
                    <span className="font-bold text-xl">133</span>
                  </li>
                </ul>
              </div>
            </motion.div>
          </div>

          <motion.button
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
            onClick={resolveEmergency}
            className="px-8 py-4 bg-white text-red-600 rounded-full font-bold text-lg hover:bg-red-50 transition-colors flex items-center gap-2 shadow-xl"
          >
            Confirmar Evacuación Segura
            <ArrowRight className="w-5 h-5" />
          </motion.button>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
