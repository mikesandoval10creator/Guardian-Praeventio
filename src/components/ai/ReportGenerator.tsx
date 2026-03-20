import React, { useState } from 'react';
import { FileText, Wand2, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { generateSafetyReport } from '../../services/geminiService';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';

export function ReportGenerator() {
  const [reportType, setReportType] = useState<'PTS' | 'PE' | 'AST'>('PTS');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const { addNode } = useZettelkasten();
  const { selectedProject } = useProject();

  const handleGenerate = async () => {
    if (!context.trim()) return;
    setLoading(true);
    try {
      const result = await generateSafetyReport(reportType, context);
      setReport(result);

      // Save to Zettelkasten
      await addNode({
        type: NodeType.DOCUMENT,
        title: `${reportType}: Generado por IA`,
        description: result,
        tags: ['IA', reportType, 'Seguridad'],
        metadata: {
          type: reportType,
          generatedAt: new Date().toISOString()
        },
        projectId: selectedProject?.id,
        connections: []
      });
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white uppercase tracking-tight">Generador de Documentos IA</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">PTS, PE y AST Automatizados</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Tipo de Documento</label>
            <div className="grid grid-cols-3 gap-2">
              {(['PTS', 'PE', 'AST'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setReportType(type)}
                  className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                    reportType === type
                      ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]'
                      : 'bg-white/5 border-white/5 text-zinc-400 hover:border-white/10'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Contexto del Trabajo / Emergencia</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Describe la actividad, ubicación y equipos involucrados..."
              className="w-full h-48 p-4 bg-white/5 border border-white/5 rounded-2xl text-sm text-white outline-none focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !context.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generando Documento...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generar Borrador con IA
              </>
            )}
          </button>
        </div>

        <div className="bg-black/40 rounded-3xl border border-white/5 p-6 min-h-[400px] relative overflow-hidden">
          <AnimatePresence mode="wait">
            {report ? (
              <motion.div
                key="report"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="prose prose-invert prose-sm max-w-none"
              >
                <div className="flex justify-end mb-4">
                  <button className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors">
                    <Download className="w-3 h-3" />
                    Descargar PDF
                  </button>
                </div>
                <div className="markdown-body">
                  <ReactMarkdown>{report}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 space-y-4"
              >
                <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center text-zinc-700 border border-white/5">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Vista Previa del Documento</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Completa el contexto y presiona generar para ver el borrador.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
