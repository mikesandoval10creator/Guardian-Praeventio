import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Info, Beaker } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import {
  checkSegregation,
  HAZMAT_CLASS_LABELS,
  type HazmatSubclass,
} from '../services/hazmat/hazmatSegregation';

// 2026-05-15 (Sprint C): el SEGREGATION_MATRIX hardcoded original
// cubría sólo 9 clases con la nota "Simplified for demo purposes" y
// dejaba afuera 4.2, 4.3, 5.2, 6.2, 7, 9 — entre ellos peróxidos
// orgánicos y materiales reactivos al agua. Ahora delegamos al
// servicio IMDG 7.2.4 completo (15 sub-clases).

interface HazardClassEntry {
  id: HazmatSubclass;
  name: string;
  color: string;
}

const HAZARD_CLASSES: HazardClassEntry[] = [
  { id: '1', name: HAZMAT_CLASS_LABELS['1'], color: 'bg-orange-500' },
  { id: '2_1', name: HAZMAT_CLASS_LABELS['2_1'], color: 'bg-red-500' },
  { id: '2_2', name: HAZMAT_CLASS_LABELS['2_2'], color: 'bg-green-500' },
  { id: '2_3', name: HAZMAT_CLASS_LABELS['2_3'], color: 'bg-zinc-100 text-black' },
  { id: '3', name: HAZMAT_CLASS_LABELS['3'], color: 'bg-red-600' },
  { id: '4_1', name: HAZMAT_CLASS_LABELS['4_1'], color: 'bg-red-400' },
  { id: '4_2', name: HAZMAT_CLASS_LABELS['4_2'], color: 'bg-orange-400' },
  { id: '4_3', name: HAZMAT_CLASS_LABELS['4_3'], color: 'bg-blue-400' },
  { id: '5_1', name: HAZMAT_CLASS_LABELS['5_1'], color: 'bg-yellow-400 text-black' },
  { id: '5_2', name: HAZMAT_CLASS_LABELS['5_2'], color: 'bg-yellow-600' },
  { id: '6_1', name: HAZMAT_CLASS_LABELS['6_1'], color: 'bg-zinc-100 text-black' },
  { id: '6_2', name: HAZMAT_CLASS_LABELS['6_2'], color: 'bg-purple-400' },
  { id: '7', name: HAZMAT_CLASS_LABELS['7'], color: 'bg-yellow-300 text-black' },
  { id: '8', name: HAZMAT_CLASS_LABELS['8'], color: 'bg-zinc-800' },
  { id: '9', name: HAZMAT_CLASS_LABELS['9'], color: 'bg-zinc-500' },
];

export function HazmatStorage() {
  const { t } = useTranslation();
  const [selectedClass1, setSelectedClass1] = useState<HazmatSubclass | null>(null);
  const [selectedClass2, setSelectedClass2] = useState<HazmatSubclass | null>(null);

  // Resultado del lookup IMDG. `null` cuando faltan inputs.
  const segregation =
    selectedClass1 && selectedClass2
      ? checkSegregation(selectedClass1, selectedClass2)
      : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Beaker className="w-8 h-8 text-emerald-500" />
            {t('hazmatStorage.title', 'Acopio HAZMAT')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('hazmatStorage.subtitle', 'Matriz de Segregación Química Offline')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border text-emerald-500 bg-emerald-500/10 border-emerald-500/20 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Validación Activa
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Selector Panel */}
        <Card className="p-6 border-white/5 space-y-6 lg:col-span-1">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Selección de Sustancias
          </h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-3">Sustancia A (Clase UN)</label>
              <div className="grid grid-cols-2 gap-2">
                {HAZARD_CLASSES.map((c) => (
                  <button
                    key={`a-${c.id}`}
                    onClick={() => setSelectedClass1(c.id)}
                    className={`p-2 rounded-lg text-xs font-bold border text-left transition-all ${
                      selectedClass1 === c.id
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-sm ${c.color}`} />
                      <span>{c.id.replace('_', '.')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-3">Sustancia B (Clase UN)</label>
              <div className="grid grid-cols-2 gap-2">
                {HAZARD_CLASSES.map((c) => (
                  <button
                    key={`b-${c.id}`}
                    onClick={() => setSelectedClass2(c.id)}
                    className={`p-2 rounded-lg text-xs font-bold border text-left transition-all ${
                      selectedClass2 === c.id
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                        : 'bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-sm ${c.color}`} />
                      <span>{c.id.replace('_', '.')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Result Panel */}
        <Card className="p-6 border-white/5 lg:col-span-2 flex flex-col justify-center items-center relative overflow-hidden min-h-[400px]">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'radial-gradient(circle at center, #3f3f46 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />

          {!selectedClass1 || !selectedClass2 ? (
            <div className="text-center z-10">
              <Beaker className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-zinc-500">Seleccione dos sustancias</h3>
              <p className="text-sm text-zinc-600 mt-2">Para validar su compatibilidad de almacenamiento conjunto.</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              key={`${selectedClass1}-${selectedClass2}`}
              className="z-10 w-full max-w-md"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-xl flex items-center justify-center text-2xl font-black border-4 border-zinc-900 shadow-xl ${HAZARD_CLASSES.find(c => c.id === selectedClass1)?.color}`}>
                    {selectedClass1.replace('_', '.')}
                  </div>
                  <p className="text-xs font-bold text-zinc-400 mt-3 uppercase tracking-wider">
                    {HAZARD_CLASSES.find(c => c.id === selectedClass1)?.name}
                  </p>
                </div>

                <div className="flex-1 flex justify-center">
                  <div className="w-12 h-1 bg-zinc-800 rounded-full relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 px-2 text-zinc-500 font-bold text-xs">
                      VS
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-xl flex items-center justify-center text-2xl font-black border-4 border-zinc-900 shadow-xl ${HAZARD_CLASSES.find(c => c.id === selectedClass2)?.color}`}>
                    {selectedClass2.replace('_', '.')}
                  </div>
                  <p className="text-xs font-bold text-zinc-400 mt-3 uppercase tracking-wider">
                    {HAZARD_CLASSES.find(c => c.id === selectedClass2)?.name}
                  </p>
                </div>
              </div>

              <div className={`p-6 rounded-2xl border ${
                segregation?.operational === 'compatible' ? 'bg-emerald-500/10 border-emerald-500/30' :
                segregation?.operational === 'incompatible' ? 'bg-rose-500/10 border-rose-500/30' :
                'bg-amber-500/10 border-amber-500/30'
              }`}>
                <div className="flex items-center gap-4 mb-4">
                  {segregation?.operational === 'compatible' ? <CheckCircle2 className="w-10 h-10 text-emerald-500" /> :
                   segregation?.operational === 'incompatible' ? <XCircle className="w-10 h-10 text-rose-500" /> :
                   <AlertTriangle className="w-10 h-10 text-amber-500" />}

                  <div>
                    <h3 className={`text-xl font-black uppercase tracking-wider ${
                      segregation?.operational === 'compatible' ? 'text-emerald-400' :
                      segregation?.operational === 'incompatible' ? 'text-rose-400' :
                      'text-amber-400'
                    }`}>
                      {segregation?.operational === 'compatible' ? t('hazmatStorage.compatible', 'Almacenamiento Permitido') :
                       segregation?.operational === 'incompatible' ? t('hazmatStorage.incompatible', 'Incompatible — Separar') :
                       t('hazmatStorage.caution', 'Precaución — Separación Específica')}
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-1 font-mono">
                      IMDG 7.2.4 — código {segregation?.imdgCode}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed">
                  {segregation?.rationale}
                </p>
              </div>
            </motion.div>
          )}

          <div className="absolute bottom-6 right-6 bg-black/50 backdrop-blur-md border border-white/10 p-3 rounded-xl max-w-xs z-10">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300">
                {t(
                  'hazmatStorage.source',
                  'Matriz IMDG 7.2.4 (Code of Safe Practice 2024), compatible con NCh 382/2190 y 49 CFR §177.848. Cubre 15 sub-clases NU. 100% offline para uso en bodegas remotas.',
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
