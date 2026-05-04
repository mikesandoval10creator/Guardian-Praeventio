import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mountain, Wind, Thermometer, Droplets, AlertTriangle, Loader2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { logger } from '../utils/logger';
// Sprint 20 17th-wave (Bucket D — title= → <Tooltip>): WCAG 1.4.13
// compliant tooltip on the icon-only "Update with AI" refresh button.
import { Tooltip } from './shared/Tooltip';

interface WeatherData {
  temp?: number;
  humidity?: number;
  windSpeed?: number;
  uvIndex?: number;
  altitude?: number;
  description?: string;
}

interface Recommendation {
  icon: React.ReactNode;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
}

/** Returns altitude tier label and O2 reduction % per proto 1 spec */
function getAltitudeTier(altitudeM: number): { label: string; reduction: number; mandatory: boolean } {
  if (altitudeM > 2400) return { label: '> 2.400 m', reduction: 25, mandatory: true };
  if (altitudeM > 1500) return { label: '1.500–2.400 m', reduction: 15, mandatory: false };
  if (altitudeM > 500)  return { label: '500–1.500 m', reduction: 5, mandatory: false };
  return { label: '0–500 m', reduction: 0, mandatory: false };
}

function buildFallbackRecommendations(weather: WeatherData): Recommendation[] {
  const recs: Recommendation[] = [];
  const alt = weather.altitude ?? 0;
  const tier = getAltitudeTier(alt);

  if (tier.reduction > 0) {
    recs.push({
      icon: <Mountain className="w-4 h-4" />,
      title: `Altitud elevada — ${tier.label}`,
      body: tier.mandatory
        ? `Reducción de oxígeno disponible del ${tier.reduction}%. Aclimatación OBLIGATORIA antes de tareas físicas. Supervisar síntomas de mal de altura: cefalea, náuseas, vértigo.`
        : `Reducción de oxígeno disponible del ${tier.reduction}%. Aumentar frecuencia de descansos. Hidratación mínima 500 ml/h.`,
      severity: tier.mandatory ? 'critical' : 'warning',
    });
  }

  if ((weather.uvIndex ?? 0) >= 8) {
    recs.push({
      icon: <AlertTriangle className="w-4 h-4" />,
      title: 'Índice UV extremo',
      body: 'UV ≥ 8: uso obligatorio de protector solar SPF50+, casco con ala, manga larga. Evitar exposición directa entre 11:00 y 15:00 h (DS 594 Art. 53).',
      severity: 'critical',
    });
  }

  if ((weather.temp ?? 20) >= 32) {
    recs.push({
      icon: <Thermometer className="w-4 h-4" />,
      title: 'Riesgo de golpe de calor',
      body: `Temperatura ${weather.temp}°C: pausas mínimas de 15 min por hora en sombra, hidratación forzada 250 ml cada 20 min. Monitorear signos de estrés térmico (DS 594).`,
      severity: 'critical',
    });
  } else if ((weather.temp ?? 20) >= 27) {
    recs.push({
      icon: <Thermometer className="w-4 h-4" />,
      title: 'Calor moderado',
      body: `${weather.temp}°C: rotar tareas pesadas al horario fresco, garantizar acceso a agua fresca.`,
      severity: 'warning',
    });
  }

  if ((weather.windSpeed ?? 0) >= 60) {
    recs.push({
      icon: <Wind className="w-4 h-4" />,
      title: 'Viento fuerte — suspender trabajos en altura',
      body: `${weather.windSpeed} km/h: suspender trabajos en andamios, grúas y superficies elevadas. Asegurar materiales sueltos (DS 132 Art. 53).`,
      severity: 'critical',
    });
  }

  if ((weather.humidity ?? 50) >= 80 && (weather.temp ?? 20) >= 25) {
    recs.push({
      icon: <Droplets className="w-4 h-4" />,
      title: 'Humedad extrema',
      body: `Humedad ${weather.humidity}% con ${weather.temp}°C: índice de calor elevado. Reducir intensidad de trabajo físico pesado.`,
      severity: 'warning',
    });
  }

  if (recs.length === 0) {
    recs.push({
      icon: <Mountain className="w-4 h-4" />,
      title: 'Condiciones normales',
      body: 'Sin alertas ambientales activas. Mantener EPP estándar y procedimientos habituales.',
      severity: 'info',
    });
  }

  return recs;
}

const SEVERITY_STYLES = {
  info:     'border-blue-500/30 bg-blue-950/30 text-blue-300',
  warning:  'border-amber-500/40 bg-amber-950/30 text-amber-300',
  critical: 'border-red-500/50 bg-red-950/40 text-red-300',
};

const SEVERITY_ICON = {
  info:     'text-blue-400',
  warning:  'text-amber-400',
  critical: 'text-red-400 animate-pulse',
};

interface Props {
  weather?: WeatherData;
  className?: string;
}

export function WeatherSafetyRecommendations({ weather, className = '' }: Props) {
  const { selectedProject } = useProject();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [aiRecs, setAiRecs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const altitude = (weather?.altitude as number | undefined) ?? 0;
  const enrichedWeather: WeatherData = { ...weather, altitude };

  useEffect(() => {
    setRecs(buildFallbackRecommendations(enrichedWeather));
  }, [weather?.temp, weather?.humidity, weather?.windSpeed, weather?.uvIndex, altitude]);

  const fetchAIRecs = async () => {
    if (!weather) return;
    setLoading(true);
    try {
      const prompt = `Eres un experto en seguridad laboral chilena (DS 594, Ley 16.744). Genera EXACTAMENTE 3 recomendaciones de seguridad breves (máx 25 palabras cada una) para trabajadores de campo con estas condiciones: Temperatura ${weather.temp ?? '--'}°C, Humedad ${weather.humidity ?? '--'}%, Viento ${weather.windSpeed ?? '--'} km/h, UV ${weather.uvIndex ?? '--'}, Altitud ${altitude}m. Formato: JSON array de strings ["rec1","rec2","rec3"].`;
      const res = await fetch('/api/ask-guardian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: prompt, stream: false }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const text: string = data.response ?? data.answer ?? '';
      const match = text.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as string[];
        setAiRecs(parsed.slice(0, 3));
        setLastFetched(new Date());
      }
    } catch (err) {
      logger.warn('[WeatherSafetyRecs] AI fetch failed, using fallback', { message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const criticalCount = recs.filter(r => r.severity === 'critical').length;

  return (
    <div className={`rounded-2xl border border-zinc-700/50 bg-zinc-900/80 overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Mountain className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-black uppercase tracking-widest text-white">
            Recomendaciones de Seguridad
          </span>
          {criticalCount > 0 && (
            <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-black animate-pulse">
              {criticalCount} CRÍTICA{criticalCount > 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Actualizar con IA">
            <button
              onClick={e => { e.stopPropagation(); fetchAIRecs(); }}
              disabled={loading || !weather}
              aria-label="Actualizar recomendaciones con IA"
              className="p-1 rounded-lg hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white disabled:opacity-40"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          </Tooltip>
          {expanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {/* Altitude tier badge */}
              {altitude > 0 && (
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                  <Mountain className="w-3 h-3" />
                  Altitud del proyecto: {Math.round(altitude)} m — {getAltitudeTier(altitude).label}
                  {getAltitudeTier(altitude).reduction > 0 && (
                    <span className="text-amber-400">(-{getAltitudeTier(altitude).reduction}% O₂)</span>
                  )}
                </div>
              )}

              {/* Rule-based recommendations */}
              {recs.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${SEVERITY_STYLES[r.severity]}`}
                  role={r.severity === 'critical' ? 'alert' : 'status'}
                  aria-label={`${r.severity === 'critical' ? 'Alerta crítica' : r.severity === 'warning' ? 'Advertencia' : 'Información'}: ${r.title}`}
                >
                  <span className={`mt-0.5 shrink-0 ${SEVERITY_ICON[r.severity]}`} aria-hidden="true">{r.icon}</span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide mb-0.5">{r.title}</p>
                    <p className="text-[11px] opacity-80 leading-relaxed">{r.body}</p>
                  </div>
                </div>
              ))}

              {/* AI recommendations */}
              {aiRecs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-zinc-700/50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1">
                    ✦ Recomendaciones IA
                    {lastFetched && <span className="text-zinc-600">— {lastFetched.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>}
                  </p>
                  {aiRecs.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2 py-1.5">
                      <span className="text-emerald-500 font-black text-xs shrink-0">{i + 1}.</span>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">{rec}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
