// Daily rotating safety tip — industry-aware, deterministic by day-of-year.
// One tip per day per sector; no randomness so it's stable across renders.

import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../contexts/ProjectContext';

const TIPS_BY_PREFIX: Record<string, string[]> = {
  'GP-AGR': [
    'Revisa el EPP antes de aplicar agroquímicos. Guantes, respirador y lentes son obligatorios.',
    'En días de calor extremo, hidratación cada 20 minutos y pausas bajo sombra.',
    'Inspecciona mangueras y conexiones de riego antes de iniciar faena.',
    'Las intoxicaciones por plaguicidas son prevenibles: lee siempre la hoja de seguridad (MSDS).',
    'Protege tu piel del sol: usa manga larga y factor 50+ en faenas al aire libre.',
  ],
  'GP-MIN': [
    'Verifica el sistema de ventilación antes de ingresar a cualquier labor subterránea.',
    'Inspección visual de culatines y estructuras de soporte: obligatoria al inicio de cada turno.',
    'Detectores de gas: calibra y prueba antes de cada ingreso a espacios confinados.',
    'El casco minero salva vidas: usa la correa mentonera siempre ajustada.',
    'Comunicación es seguridad: reporta cualquier cambio geológico inmediatamente.',
  ],
  'GP-CONS': [
    'Inspecciona tu arnés antes de subir: revisa costuras, ganchos y mosquetones.',
    'Las caídas en altura son la primera causa de muerte en construcción. Líneas de vida son obligatorias.',
    'Orden y limpieza en obra: 80% de los accidentes ocurren por tropiezos y caídas al mismo nivel.',
    'Nunca trabajes bajo cargas suspendidas. Señaliza la zona de radio de acción de la grúa.',
    'Protección auditiva obligatoria cuando el nivel de ruido supera 85 dB.',
  ],
  'GP-ELEC': [
    'LOTO (Lockout/Tagout) es obligatorio antes de cualquier intervención eléctrica.',
    'Usa EPP dieléctrico certificado: guantes clase 2 mínimo para BT, clase 4 para AT.',
    'Distancias de seguridad: mantén mínimo 1 metro de BT, 3 metros de MT, 5 metros de AT.',
    'Arco eléctrico: es el mayor riesgo en trabajos energizados. Calcula la energía incidente antes de intervenir.',
    'Verifica el estado de tus herramientas dieléctricas antes de cada jornada.',
  ],
  'GP-SAL': [
    'Higiene de manos: lavado de 20 segundos con agua y jabón después de cada paciente.',
    'Pinchazos con aguja: notifica inmediatamente y sigue el protocolo de accidente biológico.',
    'Usa siempre barrera (guantes, mascarilla) ante contacto con fluidos corporales.',
    'La fatiga clínica afecta la toma de decisiones: respeta tus turnos de descanso.',
    'Movimientos repetitivos: aplica ergonomía correcta al movilizar pacientes.',
  ],
  'GP-TRANS': [
    'Inspección previa al viaje: neumáticos, frenos, luces y líquidos en 5 minutos.',
    'Fatiga al volante: para cada 2 horas de conducción continua. La microsomnia es real.',
    'Chaleco reflectante obligatorio al bajar del vehículo en vía pública o ruta.',
    'Carga segura: verifica amarre de carga antes de iniciar y cada 200 km en ruta larga.',
    'Condiciones climáticas adversas: reduce velocidad y aumenta distancia de seguridad.',
  ],
  'GP-MANU': [
    'Guardas de seguridad: nunca operes maquinaria sin sus protecciones instaladas.',
    'Limpieza de máquinas: aplica LOTO siempre antes de intervenir.',
    'Postura ergonómica: ajusta altura de trabajo para evitar lesiones de espalda y hombros.',
    'Derrame de aceite: señaliza y limpia inmediatamente para evitar caídas.',
    'Ropa holgada y joyas son riesgo de enganche. Usa ropa ajustada en zonas de maquinaria.',
  ],
};

const TIPS_DEFAULT = [
  'El orden y limpieza son la base de la seguridad: 5S cada turno.',
  'Reporta condiciones inseguras antes de que se conviertan en accidentes.',
  'Realiza pausas activas cada 2 horas para prevenir lesiones musculoesqueléticas.',
  'Conoce las rutas de evacuación y puntos de encuentro de tu lugar de trabajo.',
  'La comunicación efectiva previene incidentes: habla con tu equipo antes de iniciar tareas críticas.',
];

function getSectorPrefix(industry: string | undefined): string | null {
  if (!industry) return null;
  const match = industry.match(/^(GP-[A-Z]+)/);
  return match ? match[1] : null;
}

function getDailyTip(tips: string[]): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return tips[dayOfYear % tips.length];
}

export function AdviceBanner() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const prefix = getSectorPrefix(selectedProject?.industry);
  const tips = (prefix && TIPS_BY_PREFIX[prefix]) ? TIPS_BY_PREFIX[prefix] : TIPS_DEFAULT;
  const tip = getDailyTip(tips);

  return (
    <section className="bg-elevated border border-default-token rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-3 flex items-start gap-2.5 shadow-mode">
      <div className="w-7 h-7 sm:w-8 sm:h-8 accent-bg rounded-full flex items-center justify-center shrink-0 mt-0.5">
        <Lightbulb className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest accent-text mb-0.5">
          {t('advice_banner.label', 'Consejo del día')}
          {prefix && <span className="text-muted-token font-normal ml-1 normal-case tracking-normal">· {prefix}</span>}
        </p>
        <p className="text-[10px] sm:text-xs text-secondary-token leading-snug">
          {tip}
        </p>
      </div>
    </section>
  );
}
