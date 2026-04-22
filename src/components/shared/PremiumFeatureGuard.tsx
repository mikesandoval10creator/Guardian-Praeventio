import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface PremiumFeatureGuardProps {
  children: React.ReactNode;
  featureName: string;
  description?: string;
}

export const PremiumFeatureGuard: React.FC<PremiumFeatureGuardProps> = ({ children, featureName, description }) => {
  const { isPremium, loading } = useSubscription();
  const navigate = useNavigate();

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
          <Zap className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
          {featureName}
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400 max-w-md mb-2">
          {description || `${featureName} utiliza IA para potenciar tu gestión. Disponible desde el plan Profesional.`}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 max-w-md mb-8">
          Todas las herramientas de seguridad están disponibles en todos los planes. El plan Libre incluye gestión completa de riesgos para equipos de hasta 10 personas.
        </p>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/pricing')}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Zap className="w-5 h-5" />
          <span>Ver Planes desde $10/mes</span>
        </motion.button>
      </div>
    );
  }

  return <>{children}</>;
};
