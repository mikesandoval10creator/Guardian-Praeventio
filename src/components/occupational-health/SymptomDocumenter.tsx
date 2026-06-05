// Praeventio Guard — B7 / ADR 0012 (2026-06).
//
// SymptomDocumenter REPLACES the old MedicalAnalyzer, which asked Gemini to
// infer injury severity, the required specialist, recovery time, work
// restrictions and hospitalization — i.e. it diagnosed. ADR 0012 forbids that:
// the app NEVER diagnoses.
//
// This tool does the opposite and complementary thing: it helps the worker
// DOCUMENT and ARTICULATE what they feel — where it hurts (from the body
// viewer), since when, how it happened, how it feels, how strong, what makes
// it better or worse — and organizes it into clear EVIDENCE to take to a REAL
// doctor. It is purely client-side: no Gemini, no inference, and no health
// data ever leaves the device (coherent with on-device biometrics, #12).

import { useState, useMemo, useCallback } from 'react';
import { ClipboardList, Copy, Check, Stethoscope, Info } from 'lucide-react';
import { BodyRegion } from './HumanBodyViewer';
import { MedicalDisclaimer } from '../health/MedicalDisclaimer';

export type SymptomMechanism = 'golpe' | 'esfuerzo' | 'caida' | 'repetitivo' | 'gradual' | 'otro';
export type SymptomSensation =
  | 'dolor'
  | 'hormigueo'
  | 'rigidez'
  | 'debilidad'
  | 'ardor'
  | 'inflamacion'
  | 'entumecimiento';

export interface RegionSymptomDetail {
  /** ¿Desde cuándo? Texto libre del trabajador ("hace 3 días", "desde el lunes"). */
  onset: string;
  /** ¿Cómo se produjo? */
  mechanism: SymptomMechanism | '';
  /** ¿Cómo lo siente? (descriptivo, no diagnóstico). */
  sensations: SymptomSensation[];
  /** Intensidad percibida 1–10 (escala subjetiva del propio trabajador; 0 = sin marcar). */
  intensity: number;
  /** ¿Qué lo agrava o alivia? */
  modifiers: string;
  /** Notas adicionales. */
  notes: string;
}

const MECHANISM_LABELS: Record<SymptomMechanism, string> = {
  golpe: 'Golpe / impacto',
  esfuerzo: 'Esfuerzo / sobrecarga',
  caida: 'Caída',
  repetitivo: 'Movimiento repetitivo',
  gradual: 'Apareció de a poco',
  otro: 'Otro',
};

const SENSATION_LABELS: Record<SymptomSensation, string> = {
  dolor: 'Dolor',
  hormigueo: 'Hormigueo',
  rigidez: 'Rigidez',
  debilidad: 'Debilidad',
  ardor: 'Ardor',
  inflamacion: 'Inflamación',
  entumecimiento: 'Entumecimiento',
};

const SEVERITY_LABELS: Record<NonNullable<BodyRegion['severity']>, string> = {
  leve: 'Leve',
  moderado: 'Moderado',
  grave: 'Grave',
  critico: 'Crítico',
};

function emptyDetail(): RegionSymptomDetail {
  return { onset: '', mechanism: '', sensations: [], intensity: 0, modifiers: '', notes: '' };
}

/**
 * Build a plain-text, doctor-ready summary from what the worker documented.
 * Pure + deterministic — this is the worker's own report, organized; it never
 * infers anything. Exported for testing.
 */
export function buildSymptomSummary(
  regions: BodyRegion[],
  details: Record<string, RegionSymptomDetail>,
): string {
  const marked = regions.filter((r) => r.severity !== null);
  const lines: string[] = [
    'RESUMEN DE SÍNTOMAS PARA MI MÉDICO',
    '(Documento preparado por el trabajador — NO es un diagnóstico)',
    '',
  ];
  marked.forEach((r, i) => {
    const d = details[r.id] ?? emptyDetail();
    const sev = r.severity ? SEVERITY_LABELS[r.severity] : '—';
    lines.push(`${i + 1}. ${r.label} — molestia percibida: ${sev}`);
    if (d.onset.trim()) lines.push(`   • Desde cuándo: ${d.onset.trim()}`);
    if (d.mechanism) lines.push(`   • Cómo se produjo: ${MECHANISM_LABELS[d.mechanism]}`);
    if (d.sensations.length > 0) {
      lines.push(`   • Cómo lo siento: ${d.sensations.map((s) => SENSATION_LABELS[s]).join(', ')}`);
    }
    if (d.intensity > 0) lines.push(`   • Intensidad (1–10): ${d.intensity}`);
    if (d.modifiers.trim()) lines.push(`   • Qué lo mejora/empeora: ${d.modifiers.trim()}`);
    if (r.ds594Article) lines.push(`   • Zona normada: ${r.ds594Article}`);
    if (d.notes.trim()) lines.push(`   • Notas: ${d.notes.trim()}`);
    lines.push('');
  });
  lines.push('Llevaré esta información a un profesional de salud para su evaluación.');
  return lines.join('\n');
}

interface SymptomDocumenterProps {
  regions: BodyRegion[];
}

export function SymptomDocumenter({ regions }: SymptomDocumenterProps) {
  const markedRegions = useMemo(() => regions.filter((r) => r.severity !== null), [regions]);
  const [details, setDetails] = useState<Record<string, RegionSymptomDetail>>({});
  const [copied, setCopied] = useState(false);

  const detailFor = useCallback(
    (id: string): RegionSymptomDetail => details[id] ?? emptyDetail(),
    [details],
  );

  const update = useCallback(
    (id: string, patch: Partial<RegionSymptomDetail>) => {
      setDetails((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyDetail()), ...patch } }));
    },
    [],
  );

  const toggleSensation = useCallback(
    (id: string, s: SymptomSensation) => {
      setDetails((prev) => {
        const cur = prev[id] ?? emptyDetail();
        const has = cur.sensations.includes(s);
        return {
          ...prev,
          [id]: {
            ...cur,
            sensations: has ? cur.sensations.filter((x) => x !== s) : [...cur.sensations, s],
          },
        };
      });
    },
    [],
  );

  const summary = useMemo(() => buildSymptomSummary(regions, details), [regions, details]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the text is still visible for manual copy.
    }
  }, [summary]);

  if (markedRegions.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 p-5 text-center">
        <ClipboardList className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Marca en el visor corporal las zonas donde sientes molestias para documentarlas y preparar
          un resumen claro para tu médico.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-200/50 dark:border-white/5">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <ClipboardList className="w-4 h-4 text-teal-500 dark:text-gold-400" />
        </div>
        <div>
          <p className="text-sm font-black text-zinc-900 dark:text-white">Documenta tus síntomas</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            Para explicarle a tu médico con fundamentos — esto no es un diagnóstico
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* ADR 0012 — la app asiste, no diagnostica. */}
        <MedicalDisclaimer variant="compact" />

        <div className="flex items-start gap-2 p-3 rounded-xl bg-teal-400/5 dark:bg-gold-400/5 border border-teal-400/10 dark:border-gold-400/10">
          <Info className="w-4 h-4 text-teal-500 dark:text-gold-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
            Mientras más claro describas <strong>dónde</strong>, <strong>desde cuándo</strong> y{' '}
            <strong>cómo se produjo</strong>, mejor podrá ayudarte el profesional de salud. Anota lo
            que sientes; el médico hará la evaluación.
          </p>
        </div>

        {markedRegions.map((r) => {
          const d = detailFor(r.id);
          return (
            <div
              key={r.id}
              className="rounded-xl border border-zinc-200/50 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-zinc-900 dark:text-white">{r.label}</p>
                {r.severity && (
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                    {SEVERITY_LABELS[r.severity]}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                    ¿Desde cuándo?
                  </span>
                  <input
                    value={d.onset}
                    onChange={(e) => update(r.id, { onset: e.target.value })}
                    placeholder="ej: hace 3 días, desde el lunes"
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
                  />
                </label>
                <label className="block">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                    ¿Cómo se produjo?
                  </span>
                  <select
                    value={d.mechanism}
                    onChange={(e) => update(r.id, { mechanism: e.target.value as SymptomMechanism | '' })}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-400/40"
                  >
                    <option value="">—</option>
                    {(Object.keys(MECHANISM_LABELS) as SymptomMechanism[]).map((m) => (
                      <option key={m} value={m}>{MECHANISM_LABELS[m]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                  ¿Cómo lo sientes?
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SENSATION_LABELS) as SymptomSensation[]).map((s) => {
                    const active = d.sensations.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleSensation(r.id, s)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                          active
                            ? 'bg-teal-400/15 dark:bg-gold-400/15 text-teal-700 dark:text-gold-300 border-teal-400/40 dark:border-gold-400/40'
                            : 'bg-white dark:bg-zinc-900/60 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-white/10 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        {SENSATION_LABELS[s]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                  <span>¿Qué tan fuerte lo sientes? (1–10)</span>
                  <span className="text-teal-600 dark:text-gold-400">{d.intensity || '—'}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={d.intensity}
                  onChange={(e) => update(r.id, { intensity: Number(e.target.value) })}
                  aria-label={`Intensidad percibida en ${r.label}`}
                  className="w-full accent-teal-500 dark:accent-gold-400"
                />
              </div>

              <label className="block">
                <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                  ¿Qué lo mejora o empeora?
                </span>
                <input
                  value={d.modifiers}
                  onChange={(e) => update(r.id, { modifiers: e.target.value })}
                  placeholder="ej: empeora al levantar peso, mejora en reposo"
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
                />
              </label>

              <label className="block">
                <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                  Notas adicionales
                </span>
                <textarea
                  value={d.notes}
                  onChange={(e) => update(r.id, { notes: e.target.value })}
                  rows={2}
                  placeholder="Cualquier detalle que quieras contarle al médico"
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none"
                />
              </label>
            </div>
          );
        })}

        {/* Doctor-ready summary */}
        <div className="rounded-xl border border-teal-400/20 dark:border-gold-400/20 bg-teal-400/5 dark:bg-gold-400/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700 dark:text-gold-400 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5" /> Resumen para tu médico
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              {copied ? <><Check className="w-3 h-3" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 font-mono">
            {summary}
          </pre>
        </div>
      </div>
    </div>
  );
}
