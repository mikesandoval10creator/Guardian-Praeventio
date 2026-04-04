import React from 'react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { Lock, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface PremiumFeatureGuardProps {
  children: React.ReactNode;
  featureName: string;
  description?: string;
}

export const PremiumFeatureGuard: React.FC<PremiumFeatureGuardProps> = ({ children, featureName, description }) => {
  const { isPremium, loading, upgradeToPremium } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-6">
          <Lock className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
          {featureName} es una función Premium
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400 max-w-md mb-8">
          {description || `Actualiza tu plan para desbloquear ${featureName} y llevar la seguridad de tu equipo al siguiente nivel con Praeventio Guard.`}
        </p>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={upgradeToPremium}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Zap className="w-5 h-5" />
          <span>Actualizar a Premium</span>
        </motion.button>
        
        <p className="text-xs text-zinc-500 mt-6">
          * Para propósitos de demostración, hacer clic en el botón actualizará tu cuenta instantáneamente.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
