import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Printer, QrCode, Loader2, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useProject } from '../contexts/ProjectContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { logger } from '../utils/logger';

// ─── Template definitions ────────────────────────────────────────────────────

interface PosterTemplate {
  id: string;
  title: string;
  subtitle: string;
  industry: string;
  color: string;        // hex bg
  textColor: string;
  rules: string[];
  legalRef: string;
  icon: 'shield' | 'warning' | 'check';
}

const TEMPLATES: PosterTemplate[] = [
  {
    id: 'epp-general',
    title: 'USO OBLIGATORIO DE EPP',
    subtitle: 'Equipo de Protección Personal',
    industry: 'General',
    color: '#1e40af',
    textColor: '#ffffff',
    rules: [
      'Casco de seguridad en todo momento',
      'Zapatos de seguridad con puntera de acero',
      'Chaleco reflectante de alta visibilidad',
      'Lentes de seguridad en zonas de riesgo',
      'Guantes según tarea asignada',
    ],
    legalRef: 'D.S. 594/1999 — Ley 16.744',
    icon: 'shield',
  },
  {
    id: 'trabajo-altura',
    title: 'TRABAJO EN ALTURA',
    subtitle: 'Precauciones Obligatorias',
    industry: 'Construcción',
    color: '#dc2626',
    textColor: '#ffffff',
    rules: [
      'Arnés de seguridad certificado ante todo trabajo ≥ 1,8 m',
      'Línea de vida asegurada a punto fijo resistente ≥ 1.500 kg',
      'Casco con barboquejo en todo momento',
      'Prohibido trabajar en altura bajo efectos del alcohol o fármacos',
      'Señalizar y delimitar el área de trabajo debajo',
    ],
    legalRef: 'D.S. 594 Art. 53 — NCh 1258',
    icon: 'warning',
  },
  {
    id: 'sustancias-peligrosas',
    title: 'MANEJO DE SUSTANCIAS PELIGROSAS',
    subtitle: 'Protocolos de Seguridad',
    industry: 'Química / Industria',
    color: '#7c3aed',
    textColor: '#ffffff',
    rules: [
      'Leer ficha de datos de seguridad (HDS) antes de manipular',
      'Usar respirador con filtros adecuados al agente químico',
      'Guantes de nitrilo, neopreno o PVC según sustancia',
      'Mantener contenedores cerrados y etiquetados (GHS/SGA)',
      'Conocer ubicación del kit de derrames y ducha de emergencia',
    ],
    legalRef: 'D.S. 594 Art. 37 — DS 148/2003',
    icon: 'warning',
  },
  {
    id: 'mineria-basic',
    title: 'NORMAS DE SEGURIDAD MINERA',
    subtitle: 'Obligaciones D.S. 132',
    industry: 'Minería',
    color: '#b45309',
    textColor: '#ffffff',
    rules: [
      'Inducción ODI aprobada antes de ingresar a la faena',
      'Bloqueo y etiquetado (LOTO) antes de intervenir equipos',
      'Comunicar toda condición insegura al supervisor inmediato',
      'Prohibido ingresar a labores sin autorización expresa',
      'Uso obligatorio de detector de gases en espacios confinados',
    ],
    legalRef: 'D.S. 132/2004 Reglamento Seguridad Minera',
    icon: 'shield',
  },
  {
    id: 'ergonomia',
    title: 'PREVENCIÓN DE LESIONES MUSCULOESQUELÉTICAS',
    subtitle: 'Manejo Manual de Cargas',
    industry: 'General',
    color: '#0f766e',
    textColor: '#ffffff',
    rules: [
      'Peso máximo: 25 kg hombres / 20 kg mujeres (Ley 20.949)',
      'Doblar las rodillas, no la espalda, al levantar cargas',
      'Mantener la carga cerca del cuerpo durante el traslado',
      'Girar el cuerpo completo, no solo la cintura',
      'Solicitar ayuda o equipo auxiliar para cargas superiores al límite',
    ],
    legalRef: 'Ley 20.949 — Protocolo TMERT MINSAL',
    icon: 'check',
  },
  {
    id: 'orden-aseo',
    title: 'ORDEN Y ASEO EN EL TRABAJO',
    subtitle: 'Regla de las 5S',
    industry: 'General',
    color: '#15803d',
    textColor: '#ffffff',
    rules: [
      'Mantener pasillos y vías de escape siempre despejados',
      'Devolver herramientas a su lugar al terminar cada tarea',
      'Limpiar derrames inmediatamente para evitar caídas',
      'Segregar residuos peligrosos en contenedores habilitados',
      'Reportar condiciones de desorden al supervisor',
    ],
    legalRef: 'D.S. 594/1999 Art. 5 — Ley 16.744',
    icon: 'check',
  },
];

const FORMAT_SIZES: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
};

// ─── Poster preview component (also used as PDF capture target) ───────────────

function PosterCard({ tpl, projectName, qrUrl }: { tpl: PosterTemplate; projectName: string; qrUrl: string }) {
  const Icon = tpl.icon === 'shield' ? Shield : tpl.icon === 'warning' ? AlertTriangle : CheckCircle2;
  return (
    <div
      style={{ backgroundColor: tpl.color, color: tpl.textColor }}
      className="flex flex-col h-full p-6 rounded-none"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Icon size={28} color={tpl.textColor} />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">{tpl.industry}</span>
          </div>
          <h2 className="text-2xl font-black uppercase leading-tight">{tpl.title}</h2>
          <p className="text-sm font-medium opacity-80 mt-0.5">{tpl.subtitle}</p>
        </div>
        <div className="shrink-0 bg-white p-1.5 rounded-lg">
          <QRCodeSVG value={qrUrl} size={56} />
        </div>
      </div>

      {/* Rules */}
      <div className="flex-1 space-y-2.5">
        {tpl.rules.map((rule, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[11px] font-black mt-0.5">
              {i + 1}
            </span>
            <p className="text-sm leading-snug font-medium">{rule}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-5 pt-4 border-t border-white/20 flex items-end justify-between gap-4">
        <div>
          <p className="text-[9px] opacity-60 uppercase tracking-widest font-bold">Referencia legal</p>
          <p className="text-[11px] font-bold opacity-90">{tpl.legalRef}</p>
          {projectName && (
            <p className="text-[9px] opacity-50 mt-0.5 uppercase tracking-widest">{projectName}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[9px] opacity-50 uppercase tracking-widest font-bold">Guardian</p>
          <p className="text-[9px] opacity-50 uppercase tracking-widest font-bold">Praeventio</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AfichesSeguridad() {
  const { selectedProject } = useProject();
  const [selected, setSelected] = useState<PosterTemplate>(TEMPLATES[0]);
  const [format, setFormat] = useState<'A4' | 'A3' | 'A2'>('A4');
  const [downloading, setDownloading] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);
  const { toasts, show: showToast, dismiss } = useToast();

  const projectName = selectedProject?.name ?? 'Praeventio Guard';
  const qrUrl = `${window.location.origin}/public-node/${selectedProject?.id ?? 'demo'}`;

  const handleDownload = async () => {
    if (!posterRef.current) return;
    setDownloading(true);
    try {
      const [mmW, mmH] = FORMAT_SIZES[format];
      const canvas = await html2canvas(posterRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: selected.color,
        logging: false,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [mmW, mmH] });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, mmW, mmH);
      pdf.save(`afiches-seguridad-${selected.id}-${format}.pdf`);
      showToast(`Afiche descargado en formato ${format}`, 'success');
    } catch (err) {
      logger.error('[AfichesSeguridad] PDF generation failed', { message: (err as Error).message });
      showToast('Error al generar el PDF. Intenta de nuevo.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Printer className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">
              Afiches de Seguridad
            </h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Generador PDF con código QR — Impresión en faena
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Format selector */}
          {(['A4', 'A3', 'A2'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-colors ${
                format === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {f}
            </button>
          ))}

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Descargar {format}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template selector */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">
            Plantillas ({TEMPLATES.length})
          </p>
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => setSelected(tpl)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selected.id === tpl.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                  : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                <div className="min-w-0">
                  <p className="text-xs font-black text-zinc-900 dark:text-white truncate">{tpl.title}</p>
                  <p className="text-[9px] text-zinc-500 truncate">{tpl.industry}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Live preview + hidden PDF target */}
        <div className="lg:col-span-2">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">
            Vista Previa — <span className="text-blue-500">{format}</span>
          </p>
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden shadow-xl border border-zinc-200 dark:border-zinc-700"
            style={{ aspectRatio: `${FORMAT_SIZES[format][0]}/${FORMAT_SIZES[format][1]}` }}
          >
            <div ref={posterRef} className="w-full h-full">
              <PosterCard tpl={selected} projectName={projectName} qrUrl={qrUrl} />
            </div>
          </motion.div>

          <div className="flex items-center gap-2 mt-3">
            <QrCode className="w-4 h-4 text-zinc-400" />
            <p className="text-[10px] text-zinc-400">
              El QR lleva a la red de conocimiento del proyecto: <span className="font-mono">{qrUrl.slice(0, 50)}…</span>
            </p>
          </div>
        </div>
      </div>
    </div>
    <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
