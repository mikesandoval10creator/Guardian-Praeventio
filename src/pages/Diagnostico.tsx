import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ClipboardList, Building2, MapPin, Users, AlertTriangle, Zap, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { analyzeRiskWithAI } from '../services/geminiService';
import { useIndustryIntegration } from '../hooks/useIndustryIntegration';
import { z } from 'zod';
import { logger } from '../utils/logger';

const diagnosticSchema = z.object({
  industry: z.string().min(2, "La industria es requerida"),
  location: z.string().min(2, "La ubicación es requerida"),
  workersCount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Debe ser un número válido mayor a 0"
  }),
  facilities: z.array(z.string()).min(1, "Selecciona al menos una instalación"),
  mainActivities: z.string().min(10, "Describe las actividades principales (mínimo 10 caracteres)"),
  knownHazards: z.string().optional()
});

export function Diagnostico() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const { bootstrapProjectKnowledge } = useIndustryIntegration();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    industry: selectedProject?.industry || '',
    location: '',
    workersCount: '',
    facilities: [] as string[],
    mainActivities: '',
    knownHazards: ''
  });

  const handleFacilityToggle = (facility: string) => {
    setFormData(prev => ({
      ...prev,
      facilities: prev.facilities.includes(facility)
        ? prev.facilities.filter(f => f !== facility)
        : [...prev.facilities, facility]
    }));
  };

  const validateForm = () => {
    try {
      diagnosticSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        (error as any).errors.forEach((err: any) => {
          if (err.path[0]) {
            newErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!formData.industry || !formData.location || !formData.workersCount) {
        setErrors({
          industry: !formData.industry ? 'Requerido' : '',
          location: !formData.location ? 'Requerido' : '',
          workersCount: !formData.workersCount ? 'Requerido' : ''
        });
        return;
      }
    }
    setErrors({});
    setStep(2);
  };

  const handleGenerateBaseMatrix = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const prompt = `Actúa como un experto en prevención de riesgos laborales (Prevencionista de Riesgos en Chile).
      Basado en el siguiente diagnóstico inicial de una faena/empresa, genera una lista de los 5 riesgos más críticos y comunes para iniciar una matriz IPER.

      Datos de la empresa:
      - Industria: ${formData.industry}
      - Ubicación/Entorno: ${formData.location}
      - Cantidad de Trabajadores: ${formData.workersCount}
      - Instalaciones: ${formData.facilities.join(', ')}
      - Actividades Principales: ${formData.mainActivities}
      - Peligros Conocidos: ${formData.knownHazards}

      Devuelve un JSON con la siguiente estructura:
      {
        "riesgosBase": [
          {
            "peligro": "Descripción del peligro",
            "riesgo": "Consecuencia o riesgo asociado",
            "criticidad": "Alta | Media | Baja",
            "controlesSugeridos": ["Control 1", "Control 2"]
          }
        ]
      }`;

      // We use a slightly modified analyzeRiskWithAI or a direct call. Since we want JSON, we'll use a generic approach or adapt the existing one.
      // For simplicity in this prototype, we'll use the existing analyzeRiskWithAI and parse its text, or just use it to generate a general report.
      // Let's create a custom prompt for the existing service.
      const analysisContext = `Diagnóstico Inicial:\nIndustria: ${formData.industry}\nUbicación: ${formData.location}\nTrabajadores: ${formData.workersCount}\nInstalaciones: ${formData.facilities.join(', ')}\nActividades: ${formData.mainActivities}`;
      const data = await analyzeRiskWithAI(`Generar riesgos base para: ${formData.knownHazards || 'Operaciones generales'}`, analysisContext, formData.industry);

      setResult(data);
      setStep(3);
      // Fire-and-forget: pre-load normative + EPP + training nodes for the industry
      if (selectedProject?.id) {
        bootstrapProjectKnowledge(selectedProject.id, formData.industry).catch(
          err => logger.error('bootstrapProjectKnowledge error:', err)
        );
      }
    } catch (error) {
      logger.error('Error generating base matrix:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToZettelkasten = async () => {
    if (!result) return;
    setLoading(true);
    try {
      // Create a central node for the diagnosis
      const diagnosisNode = await addNode({
        type: NodeType.DOCUMENT,
        title: `Diagnóstico Inicial: ${selectedProject?.name || 'Proyecto'}`,
        description: `Diagnóstico base generado por IA.\nIndustria: ${formData.industry}\nActividades: ${formData.mainActivities}`,
        tags: ['Diagnóstico', 'IPER Base', formData.industry],
        metadata: { ...formData, result },
        connections: []
      });
      if (!diagnosisNode) return;

      // Create risk nodes for the generated base risks. Round 16 (R1):
      // we no longer let the LLM emit `criticidad` (the legal P×S
      // classification belongs to the deterministic IPER engine), so the
      // node is created without a level — the prevencionista classifies
      // it later from the IPER matrix UI.
      await addNode({
        type: NodeType.RISK,
        title: `Riesgos Base: ${formData.industry}`,
        description: `Riesgos identificados en diagnóstico inicial.\n\nNormativa: ${result.normativa}`,
        tags: ['IPER Base', 'Pendiente clasificación'],
        metadata: {
          controles: result.controles,
          recomendaciones: result.recomendaciones,
        },
        connections: [diagnosisNode.id]
      });

      setSaved(true);
    } catch (error) {
      logger.error('Error saving diagnosis:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight">{t('diagnostico.title', 'Diagnóstico Inicial')}</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('diagnostico.subtitle', 'Evaluación de Línea Base y Pre-carga IPER')}
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8 relative">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-elevated -z-10" />
        {[1, 2, 3].map((s) => (
          <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            step >= s ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-surface border border-default-token text-muted-token'
          }`}>
            {s}
          </div>
        ))}
      </div>

      <Card className="p-6">
        {step === 1 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
            <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-500" />
              {t('diagnostico.generalData', 'Datos Generales de la Faena')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.industry', 'Industria / Rubro SII')}</label>
                <input
                  type="text"
                  value={formData.industry}
                  onChange={(e) => setFormData({...formData, industry: e.target.value})}
                  className={`w-full bg-surface border rounded-xl px-4 py-3 text-sm text-primary-token placeholder:text-muted-token focus:ring-2 focus:ring-emerald-500/50 outline-none ${errors.industry ? 'border-red-500/50' : 'border-default-token'}`}
                  placeholder="Ej: Minería Subterránea, Construcción..."
                />
                {errors.industry && <p className="text-[10px] text-red-400">{errors.industry}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.location', 'Ubicación / Geografía')}</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  className={`w-full bg-surface border rounded-xl px-4 py-3 text-sm text-primary-token placeholder:text-muted-token focus:ring-2 focus:ring-emerald-500/50 outline-none ${errors.location ? 'border-red-500/50' : 'border-default-token'}`}
                  placeholder="Ej: Cordillera, Altitud 3000m, Zona Costera..."
                />
                {errors.location && <p className="text-[10px] text-red-400">{errors.location}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.workersCount', 'Dotación Aproximada')}</label>
                <input
                  type="number"
                  value={formData.workersCount}
                  onChange={(e) => setFormData({...formData, workersCount: e.target.value})}
                  className={`w-full bg-surface border rounded-xl px-4 py-3 text-sm text-primary-token placeholder:text-muted-token focus:ring-2 focus:ring-emerald-500/50 outline-none ${errors.workersCount ? 'border-red-500/50' : 'border-default-token'}`}
                  placeholder="Ej: 150"
                />
                {errors.workersCount && <p className="text-[10px] text-red-400">{errors.workersCount}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.facilities', 'Instalaciones Presentes')}</label>
              <div className="flex flex-wrap gap-2">
                {['Campamento', 'Casino', 'Talleres', 'Bodega Sustancias Peligrosas', 'Planta de Procesos', 'Oficinas', 'Polvorín'].map(fac => (
                  <button
                    key={fac}
                    onClick={() => handleFacilityToggle(fac)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      formData.facilities.includes(fac)
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-surface border-default-token text-secondary-token hover:border-strong-token'
                    }`}
                  >
                    {fac}
                  </button>
                ))}
              </div>
              {errors.facilities && <p className="text-[10px] text-red-400">{errors.facilities}</p>}
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleNextStep}>
                {t('diagnostico.nextStep', 'Siguiente Paso')} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
            <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {t('diagnostico.activitiesHazards', 'Actividades y Peligros')}
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.mainActivities', 'Actividades Principales')}</label>
                <textarea
                  value={formData.mainActivities}
                  onChange={(e) => setFormData({...formData, mainActivities: e.target.value})}
                  className={`w-full h-24 bg-surface border rounded-xl p-4 text-sm text-primary-token placeholder:text-muted-token focus:ring-2 focus:ring-emerald-500/50 outline-none resize-none ${errors.mainActivities ? 'border-red-500/50' : 'border-default-token'}`}
                  placeholder="Describe los procesos principales. Ej: Perforación, tronadura, carguío y transporte..."
                />
                {errors.mainActivities && <p className="text-[10px] text-red-400">{errors.mainActivities}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-token uppercase tracking-wider">{t('diagnostico.knownHazards', 'Peligros Críticos Conocidos (Opcional)')}</label>
                <textarea
                  value={formData.knownHazards}
                  onChange={(e) => setFormData({...formData, knownHazards: e.target.value})}
                  className="w-full h-24 bg-surface border border-default-token rounded-xl p-4 text-sm text-primary-token placeholder:text-muted-token focus:ring-2 focus:ring-emerald-500/50 outline-none resize-none"
                  placeholder="Ej: Presencia de sílice, trabajo en altura geográfica, manejo de cianuro..."
                />
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="secondary" onClick={() => setStep(1)}>{t('diagnostico.back', 'Atrás')}</Button>
              <Button onClick={handleGenerateBaseMatrix} disabled={loading}>
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('diagnostico.analyzing', 'Analizando...')}</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" /> {t('diagnostico.generateSeed', 'Generar Semilla IPER')}</>
                )}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 3 && result && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
            <div className="text-center space-y-2 mb-8">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold text-primary-token">{t('diagnostico.completed', 'Diagnóstico Completado')}</h2>
              <p className="text-sm text-secondary-token">{t('diagnostico.completedDescription', 'La IA ha generado una base para tu matriz IPER.')}</p>
            </div>

            <div className="bg-surface border border-default-token rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                {t('diagnostico.summary', 'Resumen de Análisis Base')}
              </h3>

              <div className="space-y-3">
                {/*
                  Round 16 (R1) — la "Criticidad General" la calcula la
                  matriz IPER P×S, no el LLM. Ya no se muestra acá; la
                  evaluación cuantitativa la hace el prevencionista en
                  /risks una vez creado el nodo.
                */}
                <div>
                  <span className="text-xs text-muted-token uppercase font-bold block mb-1">{t('diagnostico.controlsSuggested', 'Controles Críticos Sugeridos:')}</span>
                  <ul className="list-disc list-inside text-sm text-secondary-token space-y-1">
                    {result.controles.slice(0, 3).map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
                <div>
                  <span className="text-xs text-muted-token uppercase font-bold block mb-1">{t('diagnostico.mainNormative', 'Normativa Principal:')}</span>
                  <p className="text-sm text-secondary-token">{result.normativa}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="secondary" onClick={() => setStep(2)}>{t('diagnostico.reviewData', 'Revisar Datos')}</Button>
              <Button onClick={handleSaveToZettelkasten} disabled={loading || saved}>
                {saved ? (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> {t('diagnostico.saved', 'Guardado en Zettelkasten')}</>
                ) : loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('diagnostico.saving', 'Guardando...')}</>
                ) : (
                  t('diagnostico.confirmCreate', 'Confirmar y Crear Nodos')
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </Card>
    </div>
  );
}
