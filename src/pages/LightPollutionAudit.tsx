// Round 15 / I4 — Auditoría de iluminación de puestos de trabajo (DS 594 Art. 103).
//
// Propósito de seguridad: el DS 594 (Reglamento sobre Condiciones Sanitarias y
// Ambientales Básicas en los Lugares de Trabajo) establece niveles mínimos de
// iluminación según el tipo de tarea. Este módulo permite al auditor medir
// con sensor del teléfono o ingreso manual y validar contra los thresholds.
//
// Thresholds resumidos (Tabla 1 DS 594 Art. 103):
//   • Trabajo de precisión (pequeñas piezas, escritorio):   500 lux
//   • Trabajo regular (taller, oficinas estándar):          300 lux
//   • Trabajo basto (bodegas, pasillos amplios):            150 lux
//   • Pasillos y zonas de tránsito:                          50 lux
//
// - Persistencia: lighting_audits/{id} (NUEVA colección — schema documentado abajo).
// - Audit log: audit.lighting.completed.
// - Tier: canUseCustomBranding (Diamante+ B2B audit tooling).
//
// Schema de lighting_audits (para R6 reviewer / R16 firestore.rules follow-up):
//   {
//     id: string,
//     projectId?: string,
//     auditorUid: string,
//     auditorEmail: string | null,
//     area: string,
//     taskCategory: 'precision' | 'regular' | 'basto' | 'transito',
//     measurementsLux: number[],
//     averageLux: number,
//     thresholdLux: number,
//     compliant: boolean,
//     createdAt: ISO string,
//     signed: boolean,                  // append-only post-sign (mismo patrón
//                                       // que ergonomic_assessments).
//   }

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, AlertTriangle, CheckCircle2, Plus, Loader2, FileCheck } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { Card, Button } from '../components/shared/Card';
import { logAuditAction } from '../services/auditService';

type TaskCat = 'precision' | 'regular' | 'basto' | 'transito';

interface CatMeta { label: string; threshold: number; description: string }

export const TASK_THRESHOLDS: Record<TaskCat, CatMeta> = {
  precision: { label: 'Precisión', threshold: 500, description: 'Piezas pequeñas, lectura técnica, escritorio.' },
  regular:   { label: 'Regular',   threshold: 300, description: 'Oficinas, talleres, líneas estándar.' },
  basto:     { label: 'Basto',     threshold: 150, description: 'Bodegas, pasillos amplios, andenes.' },
  transito:  { label: 'Tránsito',  threshold: 50,  description: 'Pasillos secundarios, escaleras.' },
};

/** Pure helper — average of valid lux readings. Returns 0 for empty input. */
export function averageLux(values: number[]): number {
  const valid = values.filter(v => Number.isFinite(v) && v >= 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

/** Pure helper — DS 594 Art. 103 compliance. */
export function isCompliant(avgLux: number, category: TaskCat): boolean {
  return avgLux >= TASK_THRESHOLDS[category].threshold;
}

export function LightPollutionAudit() {
  return (
    <PremiumFeatureGuard
      featureName="Auditoría de Iluminación (Diamante+)"
      feature="canUseCustomBranding"
      description="Herramienta B2B de auditoría DS 594 Art. 103 — mide y certifica niveles lumínicos en puestos de trabajo."
    >
      <LightPollutionAuditInner />
    </PremiumFeatureGuard>
  );
}

function LightPollutionAuditInner() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [area, setArea] = useState('');
  const [category, setCategory] = useState<TaskCat>('regular');
  const [readings, setReadings] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const meta = TASK_THRESHOLDS[category];
  const avg = averageLux(readings);
  const compliant = readings.length > 0 && isCompliant(avg, category);

  const addReading = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    setReadings(prev => [...prev, Math.round(n)]);
    setDraft('');
  };

  const reset = () => {
    setReadings([]); setDraft(''); setSavedId(null);
  };

  const save = async () => {
    if (!user || readings.length === 0 || !area.trim()) return;
    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'lighting_audits'), {
        projectId: selectedProject?.id ?? null,
        auditorUid: user.uid,
        auditorEmail: user.email,
        area: area.trim(),
        taskCategory: category,
        measurementsLux: readings,
        averageLux: avg,
        thresholdLux: meta.threshold,
        compliant,
        signed: false,
        createdAt: serverTimestamp(),
      });
      await logAuditAction(
        'audit.lighting.completed',
        'audit',
        {
          auditId: docRef.id,
          area: area.trim(),
          category,
          averageLux: avg,
          thresholdLux: meta.threshold,
          compliant,
          measurements: readings.length,
        },
        selectedProject?.id,
      );
      setSavedId(docRef.id);
    } catch (err) {
      console.error('LightPollutionAudit save failed', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Lightbulb className="w-7 h-7 text-amber-400" /> Auditoría de Iluminación
          </h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">DS 594 Art. 103</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border font-bold uppercase text-xs tracking-widest flex items-center gap-2 ${
          readings.length === 0 ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400' :
          compliant ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                      'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          {readings.length === 0 ? 'Sin mediciones' : compliant ? 'Cumple' : 'No cumple'}
        </div>
      </div>

      <Card className="p-6 space-y-4 border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Área auditada</label>
            <input value={area} onChange={e => setArea(e.target.value)}
              placeholder="Ej: Bodega A — pasillo central"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Categoría de tarea</label>
            <select value={category} onChange={e => setCategory(e.target.value as TaskCat)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
              {(Object.keys(TASK_THRESHOLDS) as TaskCat[]).map(k => (
                <option key={k} value={k}>{TASK_THRESHOLDS[k].label} (≥{TASK_THRESHOLDS[k].threshold} lux)</option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 mt-1">{meta.description}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <input type="number" value={draft} onChange={e => setDraft(e.target.value)} min={0}
            placeholder="Lectura en lux (sensor o luxómetro)"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            onKeyDown={e => { if (e.key === 'Enter') addReading(); }} />
          <Button onClick={addReading} disabled={!draft}><Plus className="w-4 h-4 mr-1" /> Agregar</Button>
        </div>

        {readings.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Mediciones" value={readings.length} cls="text-zinc-300" />
              <Stat label="Promedio" value={`${avg} lux`} cls="text-amber-400" />
              <Stat label="Umbral" value={`${meta.threshold} lux`} cls="text-zinc-500" />
            </div>
            <div className="flex flex-wrap gap-1">
              {readings.map((r, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  r >= meta.threshold ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-rose-500/30 text-rose-400 bg-rose-500/10'
                }`}>{r} lux</span>
              ))}
            </div>
            {!compliant && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Promedio ({avg} lux) por debajo del mínimo DS 594 Art. 103 ({meta.threshold} lux). Recomendación: aumentar densidad de luminarias o cambiar a tecnología LED de mayor flujo lumínico.</span>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving || !area.trim() || !!savedId}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Guardando…</> :
                 savedId ? <><CheckCircle2 className="w-4 h-4 mr-2" />Auditoría guardada</> :
                 <><FileCheck className="w-4 h-4 mr-2" />Cerrar auditoría</>}
              </Button>
              <Button variant="secondary" onClick={reset}>Nueva auditoría</Button>
            </div>
            {savedId && (
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">ID: {savedId}</p>
            )}
          </motion.div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: React.ReactNode; cls: string }) {
  return (
    <div className="p-3 rounded-xl bg-zinc-900 border border-white/5 text-center">
      <p className={`text-xl font-black ${cls}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
    </div>
  );
}

export default LightPollutionAudit;
