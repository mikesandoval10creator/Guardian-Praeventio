import { motion } from 'framer-motion';
import { signInWithGoogle } from '../services/firebase';
import { LogIn, ShieldCheck, Zap, Activity } from 'lucide-react';
import { Button } from '../components/shared/Card';

export function Login() {
  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Error logging in:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 font-sans">
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-white dark:bg-zinc-900 rounded-3xl p-10 shadow-2xl border border-zinc-200 dark:border-zinc-800 relative overflow-hidden"
        >
          {/* Background Accents */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex flex-col items-center mb-10">
              <div className="w-16 h-16 bg-zinc-900 dark:bg-zinc-100 rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-3">
                <ShieldCheck className="w-8 h-8 text-white dark:text-zinc-900" />
              </div>
              <h1 className="text-3xl font-black uppercase tracking-tighter leading-none mb-2 text-center">
                Praeventio Guard
              </h1>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest text-center">
                Conciencia Arquitectónica
              </span>
            </div>

            <div className="space-y-6 mb-10">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <Zap className="w-5 h-5 text-amber-500 mt-1" />
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider mb-1">Prevención Proactiva</h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Anticípate a los riesgos antes de que se conviertan en incidentes.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <Activity className="w-5 h-5 text-emerald-500 mt-1" />
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider mb-1">Excelencia Operacional</h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Optimiza tus procesos con inteligencia artificial y datos en tiempo real.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleLogin}
              className="w-full py-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl"
            >
              <LogIn className="w-4 h-4" />
              Iniciar con Google
            </Button>

            <p className="mt-8 text-center text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest leading-relaxed">
              Al ingresar, aceptas nuestra red de conciencia y protocolos de seguridad.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
