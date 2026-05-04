import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, MapPin, ExternalLink, X } from 'lucide-react';
import { useSeismicMonitor } from '../../hooks/useSeismicMonitor';
import { useProject } from '../../contexts/ProjectContext';
import { useEmergency } from '../../contexts/EmergencyContext';

export function EmergencyAlertBanner() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { triggerEmergency } = useEmergency();

  // Use project coordinates if available, otherwise default to Santiago, Chile
  const projectLat = selectedProject?.coordinates?.lat || -33.4489;
  const projectLng = selectedProject?.coordinates?.lng || -70.6693;

  const { criticalAlert } = useSeismicMonitor(projectLat, projectLng);
  const [dismissedAlertId, setDismissedAlertId] = React.useState<string | null>(null);
  const triggeredAlertIdRef = React.useRef<string | null>(null);

  // When a new critical seismic alert arrives, persist it as an emergency event
  React.useEffect(() => {
    if (!criticalAlert) return;
    if (triggeredAlertIdRef.current === criticalAlert.id) return;
    triggeredAlertIdRef.current = criticalAlert.id;
    triggerEmergency('sismo_critico', selectedProject?.id);
  }, [criticalAlert, selectedProject?.id, triggerEmergency]);

  return (
    <AnimatePresence>
      {criticalAlert && criticalAlert.id !== dismissedAlertId && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="w-full bg-red-600 text-white shadow-2xl z-50 relative overflow-hidden"
        >
          {/* Pulsing background effect */}
          <div className="absolute inset-0 bg-red-500 animate-pulse opacity-50" />
          
          <div className="relative z-10 px-4 py-3 max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black uppercase tracking-widest text-sm">{t('emergency_alert.title', 'Alerta Sísmica Detectada')}</h3>
                  <span className="bg-white text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full">
                    {t('emergency_alert.magnitude_prefix', 'Mag')} {criticalAlert.magnitude.toFixed(1)}
                  </span>
                </div>
                <p className="text-xs font-medium text-red-100 mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {criticalAlert.place}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <a
                href={criticalAlert.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 sm:flex-none bg-white/20 hover:bg-white/30 transition-colors px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                {t('emergency_alert.view_details', 'Ver Detalles')} <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => setDismissedAlertId(criticalAlert.id)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                aria-label={t('emergency_alert.dismiss_aria', 'Descartar alerta')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
