// Praeventio Guard — MFA Setup Modal.
//
// Decisión usuario 2026-05-15: NO SMS, NO llamadas telefónicas.
// Solo dos métodos REALES disponibles:
//   1. Biometría / Passkey (WebAuthn) — recomendado
//   2. TOTP (Google Authenticator / Authy / 1Password) — vía SecurityShield
//
// El path SMS fue removido completamente del componente (antes simulaba
// éxito con setTimeout y aceptaba cualquier código de 6 dígitos → bypass
// MFA). Si el usuario tiene biometría disponible → la usa aquí mismo.
// Si no → lo redirigimos a /security-shield donde TOTP está real (RFC 6238).

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ArrowRight,
  CheckCircle2,
  X,
  Loader2,
  Fingerprint,
  KeyRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';

interface MFASetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  isForced?: boolean;
}

export function MFASetupModal({ isOpen, onClose, onComplete, isForced = false }: MFASetupModalProps) {
  const [step, setStep] = useState<'intro' | 'method' | 'success'>('intro');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useFirebase();
  const { addNotification } = useNotifications();
  const { register, isSupported } = useBiometricAuth();
  const navigate = useNavigate();

  const handleBiometricSetup = async () => {
    setIsLoading(true);
    const success = await register(user?.email || 'user@praeventio.net');
    setIsLoading(false);

    if (success) {
      setStep('success');
      addNotification({
        title: 'Biometría Configurada',
        message: 'Tu dispositivo ahora es tu llave de acceso.',
        type: 'success',
      });
    } else {
      addNotification({
        title: 'No se pudo configurar la biometría',
        message:
          'Tu dispositivo no soporta WebAuthn o el usuario canceló. Usa TOTP (Google Authenticator) como alternativa.',
        type: 'error',
      });
    }
  };

  const handleTotpSetup = () => {
    // Redirige a SecurityShield donde TOTP RFC 6238 está implementado real.
    onClose();
    navigate('/security-shield');
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
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative"
            data-testid="mfa-setup-modal"
          >
            {!isForced && step !== 'success' && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white z-10"
                aria-label="Cerrar"
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
                  data-testid="mfa-step-intro"
                >
                  <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 mb-6">
                    <Shield className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-3">
                    Protege tu Cuenta
                  </h2>
                  <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
                    Praeventio Guard usa Autenticación Multifactor (MFA) sólida y
                    auditable: <strong>biometría</strong> (huella / FaceID) o
                    <strong> TOTP</strong> (Google Authenticator) — verificados
                    criptográficamente.
                  </p>
                  <button
                    onClick={() => setStep('method')}
                    className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex items-center justify-center gap-2"
                    data-testid="mfa-configure-button"
                  >
                    Configurar MFA
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.div>
              )}

              {step === 'method' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center w-full space-y-4"
                  data-testid="mfa-step-method"
                >
                  <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2">
                    Elige un Método
                  </h2>

                  <button
                    onClick={handleBiometricSetup}
                    disabled={!isSupported || isLoading}
                    className="w-full p-6 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 flex items-center gap-4 hover:border-emerald-500/50 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="mfa-biometric-button"
                  >
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                      {isLoading ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Fingerprint className="w-6 h-6" />
                      )}
                    </div>
                    <div className="text-left flex-1">
                      <p className="font-bold text-zinc-900 dark:text-white">
                        Biometría / Passkey
                      </p>
                      <p className="text-xs text-zinc-500">
                        {isSupported
                          ? 'Huella, FaceID, Windows Hello (recomendado)'
                          : 'No disponible en este dispositivo'}
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={handleTotpSetup}
                    disabled={isLoading}
                    className="w-full p-6 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 flex items-center gap-4 hover:border-indigo-500/50 transition-all group disabled:opacity-50"
                    data-testid="mfa-totp-button"
                  >
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                      <KeyRound className="w-6 h-6" />
                    </div>
                    <div className="text-left flex-1">
                      <p className="font-bold text-zinc-900 dark:text-white">
                        TOTP (Authenticator)
                      </p>
                      <p className="text-xs text-zinc-500">
                        Google Authenticator, Authy, 1Password — RFC 6238
                      </p>
                    </div>
                  </button>
                </motion.div>
              )}

              {step === 'success' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center w-full"
                  data-testid="mfa-step-success"
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
                      initial={{ scale: 1, opacity: 1 }}
                      animate={{ scale: 1.5, opacity: 0 }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2">
                    ¡MFA Activado!
                  </h2>
                  <p className="text-zinc-400 text-xs mb-8 leading-relaxed">
                    Tu cuenta ahora está protegida con autenticación
                    multifactor verificada criptográficamente.
                  </p>
                  <button
                    onClick={handleComplete}
                    className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex items-center justify-center gap-2"
                  >
                    Continuar
                    <ArrowRight className="w-4 h-4" />
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
