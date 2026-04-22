import { motion } from 'framer-motion';
import { signInWithGoogle, auth, db } from '../services/firebase';
import { LogIn, ShieldCheck, Zap, Activity, WifiOff, ArrowLeft } from 'lucide-react';
import { Button } from '../components/shared/Card';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { isBiometricSupported, verifyBiometric, registerBiometric } from '../utils/biometrics';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';

export default function Login() {
  const isOnline = useOnlineStatus();
  const [hasBiometric, setHasBiometric] = useState(false);
  const [biometricCredential, setBiometricCredential] = useState<string | null>(null);

  useEffect(() => {
    isBiometricSupported().then(supported => {
      if (supported) {
        setHasBiometric(true);
        const savedCred = localStorage.getItem('praeventio_biometric_id');
        if (savedCred) {
          setBiometricCredential(savedCred);
        }
      }
    });
  }, []);

  const syncBiometricToCloud = async (uid: string, credId: string) => {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        biometricKeys: arrayUnion(credId)
      });
    } catch (e) {
      console.log("No se pudo sincronizar BD, pero la llave local existe", e);
    }
  };

  const handleLogin = async () => {
    if (!isOnline) return;
    try {
      await signInWithGoogle();
      const user = auth.currentUser;
      
      if (user && hasBiometric && !biometricCredential) {
        // Sign in occurred on a new device or cleared cache, register biometrics
        try {
          // Re-sync: first check if we already have it linked in Firestore
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
             // Let's create a new passkey specifically for this new device session
             const credId = await registerBiometric(user.uid, user.email || 'user');
             localStorage.setItem('praeventio_biometric_id', credId);
             await syncBiometricToCloud(user.uid, credId);
          }
        } catch(e) {
           console.log("Biometric registration skipped", e);
        }
      } else if (user && hasBiometric && biometricCredential) {
         // Already registered, just make sure cloud knows about this device's key
         await syncBiometricToCloud(user.uid, biometricCredential);
      }
    } catch (error) {
      console.error('Error logging in:', error);
    }
  };

  const handleBiometricLogin = async () => {
    if (!biometricCredential) return;
    try {
      const verified = await verifyBiometric(biometricCredential);
      if (verified) {
        // En una app Capacitor real, aquí inyectaríamos el refresh token o usaríamos signInWithCustomToken.
        // Simularemos invocando a Google Sign In sin forzar selección de cuenta si el navegador lo permite
        await signInWithGoogle();
      }
    } catch(error) {
      console.error("Biometric verification failed", error);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 font-sans relative">
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-white dark:bg-zinc-900 rounded-[2rem] sm:rounded-3xl p-6 sm:p-10 shadow-2xl border border-zinc-200 dark:border-zinc-800 relative overflow-hidden"
        >
          {/* Background Accents */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors font-medium text-xs uppercase tracking-wider mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver al inicio
            </Link>

            <div className="flex flex-col items-center mb-8 sm:mb-10">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-zinc-900 dark:bg-zinc-100 rounded-2xl flex items-center justify-center mb-4 sm:mb-6 shadow-lg rotate-3">
                <ShieldCheck className="w-7 h-7 sm:w-8 sm:h-8 text-white dark:text-zinc-900" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter leading-none mb-2 text-center">
                Praeventio Guard
              </h1>
              <span className="text-[8px] sm:text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest text-center">
                Identidad y Conciencia
              </span>
            </div>

            <div className="space-y-4 sm:space-y-6 mb-8 sm:mb-10">
              <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 mt-0.5 sm:mt-1 shrink-0" />
                <div>
                  <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1">Protección Biométrica</h3>
                  <p className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Tus datos médicos y proyectos sellados bajo biometría (Face ID / Huella).
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {biometricCredential ? (
                <Button
                  onClick={handleBiometricLogin}
                  disabled={!isOnline}
                  className={`w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2 sm:gap-3 transition-all shadow-xl ${
                    !isOnline 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none' 
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  <Zap className="w-5 h-5" />
                  Usar Biometría (Face ID / Huella)
                </Button>
              ) : null}

              <Button
                onClick={handleLogin}
                disabled={!isOnline}
                className={`w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2 sm:gap-3 transition-all shadow-xl ${
                  !isOnline 
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none' 
                    : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-[1.02] active:scale-[0.98]'
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-4 h-4" />
                    Requiere Conexión
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    {biometricCredential ? "Iniciar de otra forma" : "Iniciar con Google"}
                  </>
                )}
              </Button>
            </div>

            <p className="mt-6 sm:mt-8 text-center text-[8px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest leading-relaxed px-4">
              Al ingresar, aceptas nuestra red de conciencia y protocolos de seguridad.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
