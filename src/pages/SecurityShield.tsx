import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Key, Smartphone, Lock, CheckCircle2, AlertTriangle, Fingerprint, ShieldAlert } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function SecurityShield() {
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [step, setStep] = useState(1);

  const handleEnableMFA = () => {
    setIsConfiguring(true);
    setStep(1);
    // Simulate API call to generate secret
    setTimeout(() => {
      setStep(2);
    }, 1500);
  };

  const handleVerifyMFA = () => {
    setStep(3);
    // Simulate verification
    setTimeout(() => {
      setMfaEnabled(true);
      setIsConfiguring(false);
    }, 2000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Shield className="w-8 h-8 text-indigo-500" />
            Escudo de Seguridad
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Autenticación Multifactor (MFA) y Políticas
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-indigo-500 bg-indigo-500/10 border-indigo-500/20">
          <Lock className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MFA Status Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-500" />
            Autenticación de Dos Factores (2FA)
          </h2>

          <div className={`p-6 rounded-2xl border-2 transition-colors ${mfaEnabled ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-xl ${mfaEnabled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                {mfaEnabled ? <ShieldAlert className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Estado MFA</h3>
                <p className={`text-sm font-medium ${mfaEnabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mfaEnabled ? 'Activado y Protegido' : 'Desactivado - Riesgo Alto'}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed">
            La autenticación multifactor añade una capa adicional de seguridad a tu cuenta. 
            Requerido para roles de Administrador y Prevencionista según la política corporativa.
          </p>

          {!mfaEnabled && !isConfiguring && (
            <Button 
              className="w-full py-4 text-lg" 
              onClick={handleEnableMFA} 
            >
              <Smartphone className="w-5 h-5 mr-2" />
              Configurar Autenticador
            </Button>
          )}

          {mfaEnabled && (
            <Button variant="danger" className="w-full" onClick={() => setMfaEnabled(false)}>
              Desactivar MFA (No Recomendado)
            </Button>
          )}
        </Card>

        {/* Configuration Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-indigo-500" />
            Configuración
          </h2>

          {!isConfiguring && !mfaEnabled && (
            <div className="flex flex-col items-center justify-center h-48 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Shield className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Inicia la configuración para proteger tu cuenta.</p>
            </div>
          )}

          {isConfiguring && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {step === 1 && (
                <div className="flex flex-col items-center justify-center h-48">
                  <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
                  <p className="text-sm text-zinc-400">Generando claves criptográficas...</p>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 text-center">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">1. Escanea el código QR</p>
                    <div className="w-48 h-48 bg-white mx-auto rounded-lg p-2 flex items-center justify-center">
                      <div className="w-full h-full border-4 border-black border-dashed flex items-center justify-center">
                        <span className="text-black font-bold text-xs">QR Simulado</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">2. Ingresa el código de 6 dígitos</p>
                    <div className="flex gap-2 justify-center">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <input 
                          key={i}
                          type="text" 
                          maxLength={1}
                          className="w-12 h-14 bg-zinc-900 border border-zinc-700 rounded-lg text-center text-xl font-black text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                          placeholder="0"
                        />
                      ))}
                    </div>
                  </div>

                  <Button className="w-full" onClick={handleVerifyMFA}>
                    Verificar y Activar
                  </Button>
                </div>
              )}

              {step === 3 && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', bounce: 0.5 }}
                  >
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
                  </motion.div>
                  <p className="text-lg font-bold text-white">¡MFA Activado!</p>
                  <p className="text-sm text-zinc-400">Tu cuenta ahora está protegida.</p>
                </div>
              )}
            </motion.div>
          )}

          {mfaEnabled && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <h3 className="text-sm font-bold text-white mb-2">Códigos de Recuperación</h3>
                <p className="text-xs text-zinc-400 mb-4">Guarda estos códigos en un lugar seguro. Te permitirán acceder si pierdes tu dispositivo.</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs text-indigo-400">
                  <div className="bg-black/50 p-2 rounded text-center">A1B2-C3D4</div>
                  <div className="bg-black/50 p-2 rounded text-center">E5F6-G7H8</div>
                  <div className="bg-black/50 p-2 rounded text-center">I9J0-K1L2</div>
                  <div className="bg-black/50 p-2 rounded text-center">M3N4-O5P6</div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
