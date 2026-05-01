import { motion } from 'framer-motion';
import { Watch, Zap, Loader2, Terminal, HeartPulse, Truck } from 'lucide-react';

export interface IoTEvent {
  id: string;
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: any;
  status: 'normal' | 'warning' | 'critical';
}

interface IoTEventsFeedProps {
  events: IoTEvent[] | null | undefined;
  simulating: boolean;
  isOnline: boolean;
  onSimulate: () => void;
  onOpenWebhookModal: () => void;
}

/**
 * Real-time feed of IoT telemetry events (wearables + machinery)
 * with the "Simular" + "Webhook" controls. The component is purely
 * presentational; data fetching stays in Telemetry.tsx.
 */
export function IoTEventsFeed({
  events,
  simulating,
  isOnline,
  onSimulate,
  onOpenWebhookModal,
}: IoTEventsFeedProps) {
  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
            <Watch className="w-4 h-4 text-emerald-500" />
            Telemetría IoT (Maquinaria)
          </h3>
          <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
            En Vivo
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSimulate}
            disabled={simulating || !isOnline}
            className="px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Simular
          </button>
          <button
            onClick={onOpenWebhookModal}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2"
          >
            <Terminal className="w-3 h-3" />
            Webhook
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {events && events.length > 0 ? (
          events.map((event) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`bg-zinc-950/50 border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                event.status === 'critical' ? 'border-rose-500/30' :
                event.status === 'warning' ? 'border-amber-500/30' :
                'border-white/5'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  event.status === 'critical' ? 'bg-rose-500/20 text-rose-500' :
                  event.status === 'warning' ? 'bg-amber-500/20 text-amber-500' :
                  'bg-emerald-500/20 text-emerald-500'
                }`}>
                  {event.type === 'wearable' ? <HeartPulse className="w-6 h-6" /> : <Truck className="w-6 h-6" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{event.source}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                      event.status === 'critical' ? 'bg-rose-500/20 text-rose-500' :
                      event.status === 'warning' ? 'bg-amber-500/20 text-amber-500' :
                      'bg-emerald-500/20 text-emerald-500'
                    }`}>
                      {event.status === 'critical' ? 'Crítico' : event.status === 'warning' ? 'Advertencia' : 'Normal'}
                    </span>
                    <span className="text-[10px] font-medium text-zinc-500">
                      {event.timestamp?.toDate ? event.timestamp.toDate().toLocaleTimeString() : 'Ahora'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-left sm:text-right bg-zinc-900 rounded-xl px-4 py-2 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{event.metric}</p>
                <p className={`text-lg font-black ${
                  event.status === 'critical' ? 'text-rose-500' :
                  event.status === 'warning' ? 'text-amber-500' :
                  'text-white'
                }`}>
                  {event.value} <span className="text-xs text-zinc-500">{event.unit}</span>
                </p>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 bg-zinc-950/50 rounded-2xl border border-white/5">
            <Watch className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-400">Esperando datos de telemetría IoT...</p>
            <p className="text-xs text-zinc-600 mt-1">Conecta tus dispositivos usando el Webhook Generator.</p>
          </div>
        )}
      </div>
    </div>
  );
}
