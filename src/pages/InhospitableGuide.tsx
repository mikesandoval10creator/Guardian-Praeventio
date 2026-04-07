import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mountain, ThermometerSnowflake, Wind, Sun, CloudLightning, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '../components/shared/Card';

interface GuideSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export function InhospitableGuide() {
  const [openSection, setOpenSection] = useState<string | null>('hipotermia');

  const toggleSection = (id: string) => {
    setOpenSection(openSection === id ? null : id);
  };

  const sections: GuideSection[] = [
    {
      id: 'hipotermia',
      title: 'Hipotermia y Congelamiento',
      icon: <ThermometerSnowflake className="w-6 h-6 text-blue-400" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            La hipotermia ocurre cuando el cuerpo pierde calor más rápido de lo que puede producirlo, causando una temperatura corporal peligrosamente baja (por debajo de 35°C).
          </p>
          <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Síntomas Clave</h4>
            <ul className="list-disc list-inside text-sm text-blue-200 space-y-1">
              <li>Escalofríos incontrolables (en etapas tempranas)</li>
              <li>Confusión, torpeza en las manos</li>
              <li>Habla arrastrada o balbuceo</li>
              <li>Somnolencia o muy poca energía</li>
            </ul>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Acción Inmediata (Primeros Auxilios)</h4>
            <ol className="list-decimal list-inside text-sm text-emerald-200 space-y-2">
              <li><strong>Mover a la persona</strong> a un lugar cálido y seco.</li>
              <li><strong>Quitar la ropa mojada</strong> y reemplazarla por seca.</li>
              <li><strong>Calentar el centro del cuerpo</strong> primero (pecho, cuello, cabeza, ingle) usando mantas eléctricas o contacto piel a piel.</li>
              <li><strong>Bebidas calientes</strong> (sin alcohol ni cafeína) solo si la persona está consciente y puede tragar.</li>
              <li><strong>No frotar</strong> ni masajear a la persona, ya que puede causar daño en la piel o un paro cardíaco.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'mal-altura',
      title: 'Mal Agudo de Montaña (Puna)',
      icon: <Mountain className="w-6 h-6 text-amber-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            Ocurre por la exposición a baja presión de oxígeno a gran altitud (generalmente sobre los 2.400 metros).
          </p>
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">Síntomas Clave</h4>
            <ul className="list-disc list-inside text-sm text-amber-200 space-y-1">
              <li>Dolor de cabeza punzante</li>
              <li>Náuseas y vómitos</li>
              <li>Fatiga extrema y debilidad</li>
              <li>Dificultad para dormir</li>
            </ul>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Acción Inmediata</h4>
            <ol className="list-decimal list-inside text-sm text-emerald-200 space-y-2">
              <li><strong>Detener el ascenso</strong> inmediatamente. No subir más alto.</li>
              <li><strong>Descender</strong> si los síntomas son severos o no mejoran con descanso (bajar al menos 500 metros).</li>
              <li><strong>Administrar oxígeno</strong> si está disponible.</li>
              <li><strong>Hidratación</strong> constante (evitar alcohol).</li>
              <li>En casos graves (Edema Pulmonar o Cerebral), la evacuación inmediata es crítica.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'tormenta',
      title: 'Tormentas Eléctricas',
      icon: <CloudLightning className="w-6 h-6 text-purple-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            Las tormentas eléctricas en zonas abiertas o de gran altitud son extremadamente peligrosas. El rayo busca el camino de menor resistencia hacia la tierra.
          </p>
          <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Señales de Peligro Inminente</h4>
            <ul className="list-disc list-inside text-sm text-purple-200 space-y-1">
              <li>Cabello erizado (estática en el aire).</li>
              <li>Zumbido en objetos metálicos.</li>
              <li>Menos de 30 segundos entre el relámpago y el trueno (la tormenta está a menos de 10 km).</li>
            </ul>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Acción Inmediata</h4>
            <ol className="list-decimal list-inside text-sm text-emerald-200 space-y-2">
              <li><strong>Buscar refugio</strong> en un edificio sólido o un vehículo cerrado (no carpas ni árboles aislados).</li>
              <li><strong>Alejarse de objetos altos</strong> (árboles, postes) y cuerpos de agua.</li>
              <li><strong>Si no hay refugio:</strong> Adoptar la posición de seguridad (agachado, pies juntos, manos sobre las orejas, cabeza entre las rodillas). <strong>No acostarse en el suelo.</strong></li>
              <li><strong>Separarse</strong> del grupo al menos 5 metros para evitar que un rayo afecte a todos.</li>
              <li><strong>Descartar objetos metálicos</strong> (bastones, herramientas).</li>
            </ol>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Mountain className="w-8 h-8 text-zinc-400" />
            Guía Inhóspita
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Protocolos de Supervivencia Offline
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Disponible Offline</span>
        </div>
      </div>

      <div className="bg-zinc-800/50 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
        <p className="text-sm text-zinc-300">
          Esta guía está diseñada para ser consultada sin conexión a internet. Contiene los protocolos críticos de supervivencia para entornos geográficos extremos.
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <Card key={section.id} className="overflow-hidden border-white/5">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 sm:p-6 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-zinc-800 rounded-xl border border-white/5">
                  {section.icon}
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">{section.title}</h3>
              </div>
              {openSection === section.id ? (
                <ChevronUp className="w-5 h-5 text-zinc-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-zinc-500" />
              )}
            </button>
            
            {openSection === section.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-white/5 bg-zinc-900/30"
              >
                <div className="p-4 sm:p-6">
                  {section.content}
                </div>
              </motion.div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
