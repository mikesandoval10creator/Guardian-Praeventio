import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Brain, Heart, Wind, Bone, Eye, Ear, Activity, Sparkles,
  Loader2, Download, X, ImageIcon
} from 'lucide-react';
import { generateMedicalIllustration } from '../../services/geminiService';
import { MedicalIcon } from '../medical/MedicalIcon';

interface AnatomyTopic {
  id: string;
  label: string;
  description: string;
  bodySystem: string;
  ds594Article: string;
  icon: typeof Heart;
  /** Sprint 17c — Bioicons-derived medical glyph rendered as decoration. */
  bioicon: string;
  color: string;
  /** Prompt sent to Gemini — kept in English on purpose for prompt quality. */
  prompt: string;
}

interface CachedImage {
  topicId: string;
  src: string;
  generatedAt: number;
}

export function AnatomyLibrary() {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState<string | null>(null);
  const [cache, setCache] = useState<CachedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Topics are localised through t() but preserve their stable id +
  // English prompt (the prompt is sent to Gemini — translating it would
  // degrade illustration quality).
  const TOPICS: AnatomyTopic[] = useMemo(() => [
    {
      id: 'lungs-silicosis',
      label: t('medicine.anatomy_topic_lungs_label', 'Pulmones / Silicosis'),
      description: t('medicine.anatomy_topic_lungs_description', 'Sistema respiratorio + fibrosis por sílice (PLANESI)'),
      bodySystem: t('medicine.body_system_respiratory', 'Respiratorio'),
      ds594Article: 'DS 594 Art. 66',
      icon: Wind,
      bioicon: 'lung-pair',
      color: 'text-cyan-500',
      prompt: 'Educational anatomical diagram of human lungs showing silica fibrosis (silicosis), alveolar damage, scar tissue patterns. PLANESI Chile occupational disease.',
    },
    {
      id: 'auditory-prexor',
      label: t('medicine.anatomy_topic_ear_label', 'Oído / PREXOR'),
      description: t('medicine.anatomy_topic_ear_description', 'Oído interno + hipoacusia inducida por ruido'),
      bodySystem: t('medicine.body_system_sensorial', 'Sensorial'),
      ds594Article: 'DS 594 Art. 70',
      icon: Ear,
      bioicon: 'ear',
      color: 'text-rose-500',
      prompt: 'Cross-section of human ear showing cochlea hair cell damage from noise-induced hearing loss (NIHL/PREXOR). Educational style.',
    },
    {
      id: 'spine-tmert',
      label: t('medicine.anatomy_topic_spine_label', 'Columna / TMERT'),
      description: t('medicine.anatomy_topic_spine_description', 'Trastornos musculoesqueléticos relacionados al trabajo'),
      bodySystem: t('medicine.body_system_musculoskeletal', 'Musculoesquelético'),
      ds594Article: 'DS 594 Art. 110bis',
      icon: Bone,
      bioicon: 'spine',
      color: 'text-amber-500',
      prompt: 'Human spine anatomy showing lumbar disc compression from manual material handling. TMERT occupational ergonomics Chile. Educational diagram.',
    },
    {
      id: 'cardiovascular',
      label: t('medicine.anatomy_topic_cardio_label', 'Cardiovascular'),
      description: t('medicine.anatomy_topic_cardio_description', 'Sistema circulatorio + factores de riesgo laboral'),
      bodySystem: t('medicine.body_system_cardiovascular', 'Cardiovascular'),
      ds594Article: t('medicine.ds594_generic', 'Vigilancia genérica'),
      icon: Heart,
      bioicon: 'heart-anatomical',
      color: 'text-rose-600',
      prompt: 'Human cardiovascular system anatomical diagram showing heart, major arteries, coronary circulation. Educational textbook style.',
    },
    {
      id: 'brain-stress',
      label: t('medicine.anatomy_topic_brain_label', 'Cerebro / EVAST'),
      description: t('medicine.anatomy_topic_brain_description', 'Sistema nervioso + estrés laboral'),
      bodySystem: t('medicine.body_system_neurological', 'Neurológico'),
      ds594Article: t('medicine.ds594_evast', 'EVAST psicosocial'),
      icon: Brain,
      bioicon: 'brain',
      color: 'text-violet-500',
      prompt: 'Human brain anatomical diagram showing limbic system, cortisol stress response areas. Psychosocial occupational stress (EVAST Chile). Educational.',
    },
    {
      id: 'visual',
      label: t('medicine.anatomy_topic_visual_label', 'Visual / Fatiga'),
      description: t('medicine.anatomy_topic_visual_description', 'Sistema visual + esfuerzo en pantallas'),
      bodySystem: t('medicine.body_system_sensorial', 'Sensorial'),
      ds594Article: 'DS 594 Art. 95-99',
      icon: Eye,
      bioicon: 'eye',
      color: 'text-blue-500',
      prompt: 'Human eye anatomy cross-section showing accommodation muscles, retina. Computer vision syndrome / visual fatigue. Educational diagram.',
    },
    {
      id: 'hand-vibration',
      label: t('medicine.anatomy_topic_hand_label', 'Mano / Vibración'),
      description: t('medicine.anatomy_topic_hand_description', 'Síndrome vibración mano-brazo (HAVS)'),
      bodySystem: t('medicine.body_system_peripheral_vascular', 'Vascular periférico'),
      ds594Article: 'DS 594 Art. 79',
      icon: Activity,
      bioicon: 'gloves-medical',
      color: 'text-orange-500',
      prompt: 'Human hand anatomy showing Raynaud-like vasoconstriction from hand-arm vibration syndrome (HAVS). Occupational disease.',
    },
  ], [t]);

  const generateFor = async (topic: AnatomyTopic) => {
    setGenerating(topic.id);
    setError(null);
    try {
      const result = await generateMedicalIllustration(
        [{ id: topic.id, label: topic.label, severity: 'moderado' }],
        topic.prompt,
      );
      if (result?.error) throw new Error(result.error);
      if (result?.imageBase64) {
        const src = `data:${result.mimeType ?? 'image/png'};base64,${result.imageBase64}`;
        setCache(prev => [{ topicId: topic.id, src, generatedAt: Date.now() }, ...prev.filter(c => c.topicId !== topic.id)]);
      }
    } catch (err: any) {
      setError(`${topic.label}: ${err?.message ?? 'error'}`);
    } finally {
      setGenerating(null);
    }
  };

  const downloadImage = (src: string, topicId: string) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `anatomia_${topicId}_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <ImageIcon className="w-4 h-4 text-teal-400 dark:text-gold-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">{t('medicine.anatomy_library_title', 'Librería Anatómica')}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{t('medicine.anatomy_library_subtitle', 'Ilustraciones BioRender-style por sistema · Gemini bajo demanda')}</p>
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 uppercase">
          {t('medicine.anatomy_badge_medical', 'Médico')}
        </span>
      </div>

      {error && (
        <div className="mx-5 mt-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TOPICS.map(topic => {
          const cached = cache.find(c => c.topicId === topic.id);
          const isGen = generating === topic.id;
          const Icon = topic.icon;
          return (
            <motion.div
              key={topic.id}
              whileHover={{ y: -2 }}
              className="rounded-xl bg-white dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5 overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-center relative overflow-hidden">
                {cached ? (
                  <img
                    src={cached.src}
                    alt={topic.label}
                    onClick={() => setPreviewSrc(cached.src)}
                    className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                  />
                ) : isGen ? (
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    <Loader2 className="w-8 h-8 animate-spin text-teal-400 dark:text-gold-400" />
                    <p className="text-[10px] uppercase tracking-widest">{t('medicine.anatomy_generating', 'Generando…')}</p>
                  </div>
                ) : (
                  <div className={`flex flex-col items-center gap-2 ${topic.color} opacity-60`}>
                    <MedicalIcon name={topic.bioicon} size={64} alt={topic.label} />
                    <Icon className="w-6 h-6 opacity-60" />
                  </div>
                )}
                {cached && (
                  <button
                    onClick={() => downloadImage(cached.src, topic.id)}
                    aria-label={t('medicine.anatomy_aria_download', 'Descargar')}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-zinc-900/80 text-white hover:bg-zinc-900 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <p className="text-sm font-black text-zinc-900 dark:text-white">{topic.label}</p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 mb-1">{topic.description}</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[9px] font-bold text-zinc-600 dark:text-zinc-400">{topic.bodySystem}</span>
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[9px] font-bold border border-violet-500/20">{topic.ds594Article}</span>
                </div>
                <button
                  onClick={() => generateFor(topic)}
                  disabled={isGen}
                  className="mt-auto w-full py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 hover:bg-teal-400/20 dark:hover:bg-gold-400/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {cached ? t('medicine.anatomy_btn_regenerate', 'Regenerar') : t('medicine.anatomy_btn_generate', 'Generar IA')}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Preview modal */}
      <AnimatePresence>
        {previewSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewSrc(null)}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          >
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={previewSrc}
              alt="Preview"
              className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setPreviewSrc(null)}
              aria-label={t('medicine.anatomy_aria_close', 'Cerrar')}
              className="absolute top-4 right-4 p-3 rounded-xl bg-white/10 hover:bg-white/20 text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
