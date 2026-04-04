import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Smartphone, ArrowRight, CheckCircle2, X, Loader2, KeyRound } from 'lucide-react';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useNotifications } from '../../contexts/NotificationContext';

interface MFASetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  isForced?: boolean;
}

export function MFASetupModal({ isOpen, onClose, onComplete, isForced = false }: MFASetupModalProps) {
  const [step, setStep] = useState<'intro' | 'phone' | 'verify' | 'success'>('intro');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useFirebase();
  const { addNotification } = useNotifications();

  const handleSendCode = async () => {
    if (!phoneNumber || phoneNumber.length < 9) {
      addNotification({
        title: 'Número inválido',
        message: 'Por favor, ingresa un número de teléfono válido.',
        type: 'error'
      });
      return;
    }
    
    setIsLoading(true);
    // Simulate sending SMS code
    setTimeout(() => {
      setIsLoading(false);
      setStep('verify');
      addNotification({
        title: 'Código enviado',
        message: `Se ha enviado un código SMS al ${phoneNumber}`,
        type: 'success'
      });
    }, 1500);
  };

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length < 6) {
      addNotification({
        title: 'Código inválido',
        message: 'Por favor, ingresa el código de 6 dígitos.',
        type: 'error'
      });
      return;
    }

    setIsLoading(true);
    // Simulate verifying code and enabling MFA
    setTimeout(() => {
      setIsLoading(false);
      setStep('success');
    }, 1500);
  };

  const handleComplete = () => {
    onComplete();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative"
          >
            {!isForced && step !== 'success' && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white z-10"
              >
                <X className="w-5 h-5" />
              </button>
            )}

          <div className="p-8 flex flex-col items-center text-center">
            {step === 'intro' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center"
              >
                <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 mb-6">
                  <Shield className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-black text-white mb-3">Protege tu Cuenta</h2>
                <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
                  Praeventio Guard requiere Autenticación Multifactor (MFA) para garantizar la seguridad de los datos industriales y personales.
                </p>
                <button
                  onClick={() => setStep('phone')}
                  className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex items-center justify-center gap-2"
                >
                  Configurar MFA
                  <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {step === 'phone' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-col items-center w-full"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30 mb-6">
                  <Smartphone className="w-8 h-8 text-blue-400" />
                </div>
                <h2 className="text-xl font-black text-white mb-2">Vincular Teléfono</h2>
                <p className="text-zinc-400 text-xs mb-6">
                  Ingresa tu número de teléfono móvil para recibir códigos de verificación por SMS.
                </p>
                
                <div className="w-full space-y-4 mb-8">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-medium">+56</span>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="9 1234 5678"
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-14 pr-4 text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSendCode}
                  disabled={isLoading || phoneNumber.length < 9}
                  className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-blue-500 hover:bg-blue-600 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Enviar Código SMS'}
                </button>
              </motion.div>
            )}

            {step === 'verify' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-col items-center w-full"
              >
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 mb-6">
                  <KeyRound className="w-8 h-8 text-indigo-400" />
                </div>
                <h2 className="text-xl font-black text-white mb-2">Verificar Código</h2>
                <p className="text-zinc-400 text-xs mb-6">
                  Ingresa el código de 6 dígitos que enviamos al +56 {phoneNumber}
                </p>
                
                <div className="w-full mb-8">
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-4 text-center text-2xl tracking-[0.5em] font-mono text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                  />
                </div>

                <button
                  onClick={handleVerifyCode}
                  disabled={isLoading || verificationCode.length < 6}
                  className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-indigo-500 hover:bg-indigo-600 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verificar y Activar'}
                </button>
                
                <button 
                  onClick={() => setStep('phone')}
                  className="mt-4 text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                >
                  Cambiar número de teléfono
                </button>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center w-full"
              >
                <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 mb-6 relative">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: 'spring' }}
                  >
                    <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                  </motion.div>
                  <motion.div 
                    className="absolute inset-0 border-2 border-emerald-500 rounded-full"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1.2, opacity: 0 }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                </div>
                <h2 className="text-2xl font-black text-white mb-2">MFA Activado</h2>
                <p className="text-zinc-400 text-sm mb-8">
                  Tu cuenta ahora está protegida con Autenticación Multifactor.
                </p>
                
                <button
                  onClick={handleComplete}
                  className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
                >
                  Continuar a Praeventio
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
