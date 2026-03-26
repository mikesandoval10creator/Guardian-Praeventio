import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Upload, FileText, CheckCircle2, Loader2, Sparkles, Database, AlertTriangle } from 'lucide-react';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { processDocumentToNodes } from '../services/geminiService';

import { NodeType } from '../types';

export function KnowledgeIngestion() {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; nodesAdded: number; message: string } | null>(null);
  const { addNode } = useZettelkasten();

  const handleProcess = async () => {
    if (!text.trim()) return;
    
    setIsProcessing(true);
    setResult(null);
    
    try {
      // Process text with Gemini to extract Master Nodes
      const extractedNodes = await processDocumentToNodes(text);
      
      // Add nodes to Universal Knowledge
      let addedCount = 0;
      for (const node of extractedNodes) {
        await addNode({
          title: node.title,
          description: node.content,
          type: NodeType.NORMATIVE,
          tags: ['master-node', 'manual-prevencion', ...node.tags],
          metadata: { source: 'manual-ingestion', isMasterNode: true },
          projectId: 'global', // Global knowledge
          connections: []
        });
        addedCount++;
      }
      
      setResult({
        success: true,
        nodesAdded: addedCount,
        message: `Se han extraído y asimilado ${addedCount} Nodos Maestros exitosamente.`
      });
      setText('');
    } catch (error) {
      console.error('Error processing document:', error);
      setResult({
        success: false,
        nodesAdded: 0,
        message: 'Hubo un error al procesar el documento. Por favor, intenta de nuevo.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
        <div className="space-y-1 sm:space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shrink-0">
              <Brain className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Entrenamiento IA</h1>
          </div>
          <p className="text-zinc-500 font-medium text-[10px] sm:text-sm md:text-base">Ingesta de Conocimiento y Creación de Nodos Maestros</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-500" />
                Manual de Prevención / Normativa
              </h2>
              <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-1 rounded">RAG System</span>
            </div>
            
            <p className="text-sm text-zinc-400 mb-6">
              Pega aquí el texto de tu manual, protocolo o normativa. El Guardián analizará el contenido, extraerá los conceptos clave y los convertirá en <strong>Nodos Maestros</strong> dentro de la Red Neuronal para usarlos en futuras predicciones y respuestas.
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej: PROCEDIMIENTO DE TRABAJO SEGURO EN ALTURA. 1. Objetivo: Establecer las normas... 2. Alcance... 3. Responsabilidades..."
              className="w-full h-64 bg-zinc-950 border border-white/10 rounded-xl p-4 text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none mb-4"
            />

            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                {text.length} caracteres
              </div>
              <button
                onClick={handleProcess}
                disabled={!text.trim() || isProcessing}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Asimilar Conocimiento
                  </>
                )}
              </button>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-6 p-4 rounded-xl border flex items-start gap-3 ${
                  result.success 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}
              >
                {result.success ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
                <div>
                  <h4 className="text-sm font-bold mb-1">{result.success ? 'Asimilación Completada' : 'Error de Procesamiento'}</h4>
                  <p className="text-xs opacity-80">{result.message}</p>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-500" />
              ¿Cómo funciona?
            </h3>
            <ul className="space-y-4 text-xs text-zinc-400">
              <li className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 text-white font-bold">1</div>
                <p><strong>Ingesta:</strong> La IA lee tu documento y comprende el contexto general y las reglas específicas.</p>
              </li>
              <li className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 text-white font-bold">2</div>
                <p><strong>Fragmentación:</strong> Divide el texto en "Nodos Maestros" (ej. Protocolo de Viento, Uso de Arnés).</p>
              </li>
              <li className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 text-white font-bold">3</div>
                <p><strong>Asimilación:</strong> Los nodos se guardan en la Red Neuronal Global, disponibles para todos los proyectos.</p>
              </li>
              <li className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-500 font-bold">4</div>
                <p className="text-emerald-400"><strong>Aplicación:</strong> El Guardián usará estas reglas como base inquebrantable para responder dudas y generar PTS.</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
