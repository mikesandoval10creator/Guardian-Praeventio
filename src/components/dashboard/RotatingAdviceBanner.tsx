// RotatingAdviceBanner — banner UNICO de consejos que rota automaticamente.
// Consolida los 3 banners de consejo/recomendacion y FUSIONA la logica climatica
// (buildWeatherAdvice — altitud/UV/calor/viento/humedad, DS 594/DS 132) con
// consejos por rubro y generales. Los disparados por el clima real van primero y
// con severidad (critico = rojo, advertencia = ambar). Crossfade con framer-motion.

import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, AlertTriangle, ShieldCheck } from 'lucide-react';
import { buildWeatherAdvice, type WeatherInput, type AdviceItem } from './weatherAdvice';

const GENERAL: string[] = [
  'La comunicacion efectiva previene incidentes: habla con tu equipo antes de iniciar tareas criticas.',
  'Reporta toda condicion insegura apenas la detectes. Un reporte a tiempo evita un accidente.',
  'Realiza pausas activas cada 2 horas para reducir la fatiga y los errores.',
  'Verifica tu EPP antes de cada turno: casco, calzado y proteccion segun la tarea.',
];

const BY_RUBRO: Record<string, string[]> = {
  mining: [
    'Mineria: verifica ventilacion y fortificacion antes de ingresar a la labor.',
    'Monitorea la fatiga en operadores de maquinaria pesada.',
  ],
  construccion: [
    'Construccion: inspecciona andamios y lineas de vida antes de trabajos en altura.',
    'Asegura el uso correcto de arnes en toda tarea sobre 1,8 m (DS 594).',
  ],
  energia: [
    'Energia: confirma bloqueo y etiquetado (LOTO) antes de intervenir equipos.',
    'Usa EPP dielectrico certificado y verifica ausencia de tension.',
  ],
  agricultura: [
    'Agricultura: hidratacion constante y pausas bajo sombra ante golpe de calor.',
    'Verifica el EPP para aplicacion de agroquimicos (guantes, respirador, antiparras).',
  ],
};

function rubroKey(industry?: string): string {
  const s = (industry ?? '').toLowerCase();
  if (/min/.test(s)) return 'mining';
  if (/constr/.test(s)) return 'construccion';
  if (/energ/.test(s)) return 'energia';
  if (/agric|silvo|forest|pesc|salmon/.test(s)) return 'agricultura';
  return '';
}

const STYLE: Record<AdviceItem['severity'], { badge: string; ring: string; icon: string; Icon: typeof Lightbulb }> = {
  critical: { badge: 'Alerta de seguridad', ring: 'from-[var(--accent-hazard)]/12', icon: 'text-[var(--accent-hazard)]', Icon: AlertTriangle },
  warning: { badge: 'Atencion', ring: 'from-[var(--accent-warning)]/12', icon: 'text-[var(--accent-warning)]', Icon: ShieldCheck },
  info: { badge: 'Consejo del dia', ring: 'from-[var(--accent-warning)]/10', icon: 'text-[var(--accent-warning)]', Icon: Lightbulb },
};

export function RotatingAdviceBanner({
  industry,
  weather,
  intervalMs = 6000,
}: {
  industry?: string;
  weather?: WeatherInput;
  intervalMs?: number;
}) {
  const items: AdviceItem[] = useMemo(() => {
    const weatherItems = buildWeatherAdvice(weather);
    const rubro = (BY_RUBRO[rubroKey(industry)] ?? []).map((text): AdviceItem => ({ text, severity: 'info' }));
    const general = GENERAL.map((text): AdviceItem => ({ text, severity: 'info' }));
    return [...weatherItems, ...rubro, ...general];
  }, [industry, weather]);

  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % items.length), intervalMs);
    return () => clearInterval(id);
  }, [items.length, intervalMs]);

  const current = items[i] ?? items[0];
  if (!current) return null;
  const sev = STYLE[current.severity];
  const SevIcon = sev.Icon;

  return (
    <section
      className={`relative overflow-hidden rounded-xl sm:rounded-2xl border border-default-token bg-gradient-to-r ${sev.ring} via-surface to-surface p-2.5 sm:p-3 shadow-mode w-full`}
      aria-label="Consejo de seguridad"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 sm:gap-3">
        <div className={`shrink-0 w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-elevated flex items-center justify-center ${sev.icon}`}>
          <SevIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-token leading-none mb-0.5">
            {sev.badge}
          </p>
          <div className="relative min-h-[2rem] sm:min-h-[1.75rem]">
            <AnimatePresence mode="wait">
              <motion.p
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="text-[11px] sm:text-xs text-secondary-token leading-snug"
              >
                {current.text}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        {items.length > 1 && (
          <div className="shrink-0 hidden sm:flex flex-col gap-1" aria-hidden="true">
            {items.slice(0, 6).map((_, k) => (
              <span key={k} className={`w-1.5 h-1.5 rounded-full transition-colors ${k === i ? 'bg-secondary-token' : 'bg-default-token'}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
