import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Upload, FileText, Loader2, Brain, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, Button } from '../components/shared/Card';
import { extractAcademicSummary } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { logger } from '../utils/logger';
import { humanErrorMessage } from '../lib/humanError';


export function AcademicProcessor() {
  const { t } = useTranslation();
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!textInput.trim()) return;

    setIsProcessing(true);
    setError(null);
    try {
      const summary = await extractAcademicSummary(textInput);
      setResult(summary);
    } catch (err) {
      logger.error(err);
      setError(t('academic.errors.processing', 'Error al procesar el texto. Por favor, intenta de nuevo.'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-violet-500" />
            {t('academic.header.title', 'Procesador Académico')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('academic.header.subtitle', 'Extracción de Conocimiento Científico')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-default-token flex flex-col h-full bg-white dark:bg-zinc-900/50">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
              <FileText className="w-5 h-5 text-violet-500" />
              {t('academic.source.title', 'Texto Fuente (Paper / Artículo)')}
            </h2>
            <Button variant="secondary" className="text-xs py-1 px-3">
              <Upload className="w-3 h-3 mr-2" /> {t('academic.source.uploadPdf', 'Subir PDF')}
            </Button>
          </div>

          <p className="text-xs text-secondary-token mb-4">
            {t('academic.source.description', 'Pega el abstract o las conclusiones de un paper científico sobre seguridad, ergonomía o salud ocupacional. La IA extraerá los puntos clave y los vinculará a la matriz de riesgos.')}
          </p>

          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={t('academic.source.placeholder', "Ej: 'El estudio demuestra que la fatiga cognitiva en operadores de maquinaria pesada aumenta un 40% después de 6 horas de turno continuo en altitud superior a 3000 msnm...'")}
            className="flex-1 w-full min-h-[300px] bg-zinc-50 dark:bg-zinc-900/50 border border-default-token rounded-xl p-4 text-sm text-primary-token placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
          />

          <Button
            className="w-full mt-4 bg-violet-500 hover:bg-violet-600 text-white"
            onClick={handleProcess}
            disabled={isProcessing || !textInput.trim()}
          >
            {isProcessing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('academic.actions.processing', 'Procesando con Gemini...')}</>
            ) : (
              <><Brain className="w-4 h-4 mr-2" /> {t('academic.actions.extract', 'Extraer Conocimiento')}</>
            )}
          </Button>
        </Card>

        <Card className="p-6 border-default-token flex flex-col h-full bg-zinc-50 dark:bg-zinc-900/30">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2 mb-6">
            <Brain className="w-5 h-5 text-emerald-500" />
            {t('academic.output.title', 'Conocimiento Extraído')}
          </h2>

          {error && (
            <div className="p-4 bg-rose-100 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p>{humanErrorMessage(error)}</p>
            </div>
          )}

          {!result && !error && !isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-default-token rounded-xl">
              <BookOpen className="w-12 h-12 text-muted-token mb-4" />
              <p className="text-muted-token text-sm">
                {t('academic.output.empty', 'El resumen estructurado, las lecciones aprendidas y las sugerencias de controles aparecerán aquí.')}
              </p>
            </div>
          )}

          {isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="relative w-16 h-16 mb-4">
                <div className="absolute inset-0 border-4 border-violet-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-violet-500 rounded-full border-t-transparent animate-spin" />
                <Brain className="absolute inset-0 m-auto w-6 h-6 text-violet-500 animate-pulse" />
              </div>
              <p className="text-violet-600 dark:text-violet-400 font-bold animate-pulse">{t('academic.output.analyzing', 'Analizando rigor científico...')}</p>
            </div>
          )}

          {result && !isProcessing && (
            <div className="flex-1 overflow-y-auto pr-2 space-y-6">
              <div className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100 prose-a:text-violet-600 dark:prose-a:text-violet-400 prose-strong:text-violet-700 dark:prose-strong:text-violet-300">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>

              <div className="pt-6 border-t border-default-token flex justify-end">
                <Button className="bg-[#4db6ac] hover:bg-[#3a9e95] text-white">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> {t('academic.actions.saveZettel', 'Guardar en Zettelkasten')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
