import { motion } from 'framer-motion';
import { Watch, Zap, Loader2, Terminal, HeartPulse, Truck } from 'lucide-react';

export interface IoTEvent {
  id: string;
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: { toDate?: () => Date; toMillis?: () => number } | number | string | Date;
  status: 'normal' | 'warning' | 'critical';
  /**
   * Marks an event produced by the client-side "Simular" demo. Simulated
   * events live ONLY in local component state — they are never written to
   * `telemetry_events`, never feed `triggerEmergency`, and never influence
   * the Digital-Twin / evacuation route. They render in a clearly-labeled
   * demo block so a worker can never mistake one for a live sensor reading.
   */
  simulated?: boolean;
}

/** A real event newer than this is treated as "live" for the feed badge. */
export const FEED_LIVE_WINDOW_MS = 10 * 60 * 1000;

/** Best-effort conversion of the polymorphic IoT timestamp to epoch ms. */
export function iotEventToMillis(ts: IoTEvent['timestamp']): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof ts === 'object') {
    if (typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof ts.toDate === 'function') {
      const ms = ts.toDate().getTime();
      return Number.isNaN(ms) ? null : ms;
    }
  }
  return null;
}

/**
 * True only when the most recent REAL event is within the freshness window.
 * Drives the "En Vivo" badge honestly instead of hard-coding it (an empty or
 * stale feed previously still advertised "En Vivo").
 */
export function isFeedLive(
  events: IoTEvent[] | null | undefined,
  nowMs: number,
  windowMs: number = FEED_LIVE_WINDOW_MS,
): boolean {
  if (!events || events.length === 0) return false;
  let latest = -Infinity;
  for (const e of events) {
    const ms = iotEventToMillis(e.timestamp);
    if (ms != null && ms > latest) latest = ms;
  }
  if (latest === -Infinity) return false;
  // Fresh (not stale) and not absurdly in the future (clock-skew tolerant).
  return nowMs - latest <= windowMs && latest - nowMs <= windowMs;
}

function formatEventTime(ts: IoTEvent['timestamp']): string {
  const ms = iotEventToMillis(ts);
  return ms != null ? new Date(ms).toLocaleTimeString() : 'Ahora';
}

function EventCard({ event, simulated }: { event: IoTEvent; simulated?: boolean }) {
  const borderClass = simulated
    ? 'border-dashed border-amber-500/40'
    : event.status === 'critical'
      ? 'border-rose-500/30'
      : event.status === 'warning'
        ? 'border-amber-500/30'
        : 'border-white/5';
  const iconBg = simulated
    ? 'bg-amber-500/10 text-amber-400'
    : event.status === 'critical'
      ? 'bg-rose-500/20 text-rose-500'
      : event.status === 'warning'
        ? 'bg-amber-500/20 text-amber-500'
        : 'bg-emerald-500/20 text-emerald-500';
  const statusChip =
    event.status === 'critical'
      ? 'bg-rose-500/20 text-rose-500'
      : event.status === 'warning'
        ? 'bg-amber-500/20 text-amber-500'
        : 'bg-emerald-500/20 text-emerald-500';
  const valueColor =
    event.status === 'critical'
      ? 'text-rose-500'
      : event.status === 'warning'
        ? 'text-amber-500'
        : 'text-white';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`bg-zinc-950/50 border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${borderClass}`}
    >
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconBg}`}>
          {event.type === 'wearable' ? <HeartPulse className="w-6 h-6" /> : <Truck className="w-6 h-6" />}
        </div>
        <div>
          <p className="text-sm font-bold text-white flex items-center gap-2">
            {event.source}
            {simulated && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-widest border border-amber-500/30">
                Simulado
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${statusChip}`}>
              {event.status === 'critical' ? 'Crítico' : event.status === 'warning' ? 'Advertencia' : 'Normal'}
            </span>
            <span className="text-[10px] font-medium text-zinc-500">{formatEventTime(event.timestamp)}</span>
          </div>
        </div>
      </div>
      <div className="text-left sm:text-right bg-zinc-900 rounded-xl px-4 py-2 border border-white/5">
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{event.metric}</p>
        <p className={`text-lg font-black ${valueColor}`}>
          {event.value} <span className="text-xs text-zinc-500">{event.unit}</span>
        </p>
      </div>
    </motion.div>
  );
}

interface IoTEventsFeedProps {
  events: IoTEvent[] | null | undefined;
  simulating: boolean;
  isOnline: boolean;
  onSimulate: () => void;
  onOpenWebhookModal: () => void;
  /** Client-side demo events (never persisted, never trigger alerts). */
  simulatedEvents?: IoTEvent[];
  /** Injected for deterministic tests; defaults to Date.now(). */
  nowMs?: number;
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
  simulatedEvents,
  nowMs,
}: IoTEventsFeedProps) {
  const live = isFeedLive(events, nowMs ?? Date.now());
  const hasSimulated = !!simulatedEvents && simulatedEvents.length > 0;

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
            <Watch className="w-4 h-4 text-emerald-500" />
            Telemetría IoT (Maquinaria)
          </h3>
          {live ? (
            <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
              En Vivo
            </span>
          ) : (
            <span className="px-2 py-1 rounded-md bg-zinc-700/30 text-zinc-400 text-[9px] font-black uppercase tracking-widest border border-zinc-600/30">
              Sin señal reciente
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSimulate}
            disabled={simulating || !isOnline}
            className="px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Simular (demo)
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

      {hasSimulated && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 text-[9px] font-black uppercase tracking-widest border border-amber-500/30">
              Simulado
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">
              Eventos de demostración — no generan alertas ni afectan la evacuación
            </span>
          </div>
          {simulatedEvents!.map((event) => (
            <EventCard key={event.id} event={event} simulated />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {events && events.length > 0 ? (
          events.map((event) => <EventCard key={event.id} event={event} />)
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
