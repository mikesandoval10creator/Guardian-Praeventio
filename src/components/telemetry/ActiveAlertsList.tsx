import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, Zap } from 'lucide-react';

interface ActiveAlertsListProps {
  alerts: string[];
  onSaveToZettelkasten: (alertMsg: string) => void | Promise<void>;
}

/**
 * Shows the list of active critical alerts (weather, seismic, IoT, BLE)
 * with a "Registrar en Red Neuronal" button per alert. Extracted from
 * Telemetry.tsx so the page component can stay focused on data.
 */
export function ActiveAlertsList({ alerts, onSaveToZettelkasten }: ActiveAlertsListProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        Alertas Críticas Activas
      </h2>
      {alerts.map((alert, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-rose-200">{alert}</p>
          </div>
          <button
            onClick={() => onSaveToZettelkasten(alert)}
            className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shrink-0 flex items-center gap-2"
          >
            <Zap className="w-3 h-3" />
            Registrar en Red Neuronal
          </button>
        </motion.div>
      ))}
    </div>
  );
}
