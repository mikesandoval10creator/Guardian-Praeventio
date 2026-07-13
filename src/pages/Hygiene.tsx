import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Wind,
  Thermometer,
  Volume2,
  Activity,
  AlertTriangle,
  BarChart3,
  Plus,
  Loader2,
  MapPin
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { subscribeObligations } from '../services/legalCalendar/legalCalendarStore';
import { computeCalendar } from '../services/legalCalendar/legalObligationsCalendar';
import type { LegalObligation } from '../services/legalCalendar/legalObligationsCalendar';
import { computeMonthlyHygieneTrend, computeMedicalExamCompliance } from './hygieneMetrics';
import { logger } from '../utils/logger';
import { AddHygieneModal } from '../components/hygiene/AddHygieneModal';
import { NoiseMonitor } from '../components/hygiene/NoiseMonitor';
import { SensoryFatigueMonitor } from '../components/hygiene/SensoryFatigueMonitor';
import { BreathingExercise } from '../components/hygiene/BreathingExercise';
import { VitalityMonitor } from '../components/hygiene/VitalityMonitor';
import { FloraFaunaCatalog } from '../components/hygiene/FloraFaunaCatalog';
import { MorningRoutine } from '../components/hygiene/MorningRoutine';
import { NutritionLog } from '../components/hygiene/NutritionLog';
import { MeasurementQualityCard } from '../components/measurements/MeasurementQualityCard';
import { AirQualityPanel } from '../components/hvac/AirQualityPanel';

const iconMap: Record<string, any> = {
  'Ruido Ambiental': Volume2,
  'Iluminación': Activity,
  'Estrés Térmico': Thermometer,
  'Particulado (PM10)': Wind,
};

export function Hygiene() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { nodes, loading } = useRiskEngine();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const hygieneNodes = nodes.filter(node =>
    node.type === NodeType.HYGIENE &&
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const alerts = hygieneNodes.filter(n => n.metadata.status === 'warning');

  // REAL monthly exposure trend derived from the actual hygiene measurements
  // (value / legal-limit per calendar month). Replaces the previously
  // hardcoded bar array. Empty → honest empty state, not fake bars.
  const trend = useMemo(() => computeMonthlyHygieneTrend(hygieneNodes), [hygieneNodes]);

  // REAL occupational medical-exam compliance from the legal-obligations
  // calendar (same source VigilanciaScheduler uses). `null` = "Sin datos".
  const [medicalObligations, setMedicalObligations] = useState<LegalObligation[]>([]);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setMedicalObligations([]);
      return undefined;
    }
    const unsub = subscribeObligations(
      projectId,
      (list) => setMedicalObligations(list.filter((o) => o.kind === 'medical_exam')),
      (err) => logger.warn('hygiene_medical_obligations_sub_error', { err: String(err) }),
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const medicalExamCompliance = useMemo(
    () => computeMedicalExamCompliance(computeCalendar(medicalObligations)),
    [medicalObligations],
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight">{t('hygiene.title')}</h1>
          <p className="text-[10px] sm:text-xs font-bold text-muted-token uppercase tracking-widest mt-1">{t('hygiene.subtitle')}</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-lg shadow-emerald-500/20 active:scale-95 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{t('hygiene.new_record')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Environmental Monitoring */}
        <div className="lg:col-span-2 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : hygieneNodes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hygieneNodes.map((node, index) => {
                const Icon = iconMap[node.metadata.parameter] || Activity;
                const status = node.metadata.status;
                const progress = Math.min(100, (node.metadata.value / node.metadata.limit) * 100);

                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-surface border border-default-token rounded-3xl p-6 hover:border-emerald-500/30 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-elevated flex items-center justify-center text-emerald-500 border border-default-token">
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        status === 'safe' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {status === 'safe' ? t('hygiene.status_normal') : t('hygiene.status_alert')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-muted-token text-xs font-bold uppercase tracking-widest">{node.metadata.parameter}</h3>
                      <div className="flex items-center gap-1 text-[9px] text-muted-token font-bold uppercase tracking-tighter">
                        <MapPin className="w-2.5 h-2.5" />
                        {node.metadata.location}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-primary-token">{node.metadata.value} {node.metadata.unit}</span>
                      <span className="text-xs text-muted-token font-medium">{t('hygiene.limit')}: {node.metadata.limit} {node.metadata.unit}</span>
                    </div>
                    <div className="mt-6 h-1.5 w-full bg-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${status === 'safe' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="bg-surface border border-dashed border-default-token rounded-3xl p-20 text-center">
              <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-muted-token" />
              </div>
              <p className="text-muted-token text-sm">{t('hygiene.empty')}</p>
            </div>
          )}

          <div className="bg-surface border border-default-token rounded-3xl p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold text-primary-token flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-indigo-500" />
                {t('hygiene.monthly_trends')}
              </h3>
              <select className="bg-elevated border border-default-token text-secondary-token text-xs rounded-lg px-3 py-1.5 focus:outline-none">
                <option>{t('hygiene.last_30_days')}</option>
                <option>{t('hygiene.last_6_months')}</option>
              </select>
            </div>
            {trend.hasData ? (
              <>
                <div className="h-48 flex items-end justify-between gap-2">
                  {trend.bars.map((h, i) => (
                    <div
                      key={trend.labels[i] + i}
                      className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/40 transition-all rounded-t-lg relative group"
                      style={{ height: `${Math.max(h, 2)}%` }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-elevated text-primary-token text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {h}% {t('hygiene.level')}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-4 text-[10px] font-bold text-muted-token uppercase tracking-widest">
                  {trend.labels.map((label, i) => (
                    <span key={label + i} className="capitalize">{label}</span>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-muted-token font-medium">{t('hygiene.trend_caption')}</p>
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-center">
                <BarChart3 className="w-8 h-8 text-muted-token mb-3" />
                <p className="text-muted-token text-sm">{t('hygiene.trend_empty')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Health Stats & Tools */}
        <div className="space-y-6">
          <MorningRoutine />
          <NutritionLog />
          <VitalityMonitor />
          <NoiseMonitor />
          <SensoryFatigueMonitor />
          <BreathingExercise />

          <div className="bg-surface border border-default-token rounded-3xl p-6">
            <h3 className="text-lg font-bold text-primary-token mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-500" />
              {t('hygiene.occupational_health')}
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-elevated border border-default-token">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-secondary-token">{t('hygiene.medical_exams')}</span>
                  <span className="text-xs font-bold text-emerald-500">
                    {medicalExamCompliance !== null ? `${medicalExamCompliance}%` : t('hygiene.no_data')}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${medicalExamCompliance ?? 0}%` }}
                  />
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-elevated border border-default-token">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-secondary-token">{t('hygiene.vaccination')}</span>
                  {/* No vaccination collection exists in the repo. Per founder
                      directive we never fabricate a number — show "Sin datos"
                      until a real immunization source is wired. */}
                  <span className="text-xs font-bold text-muted-token">{t('hygiene.no_data')}</span>
                </div>
                <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-elevated rounded-full" style={{ width: '0%' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Wire MeasurementQualityCard — aggregated quality score for the
              measurement chain (noise, dust, gases, lighting). Renders with
              empty results until real ChainValidationResult data is wired. */}
          <MeasurementQualityCard results={[]} />

          {/* Wire AirQualityPanel — CO2 prediction + ventilation recommendation
              using the thermal model steady-state calculator. Renders with
              placeholder zone/driver until real sensor data is wired. */}
          <AirQualityPanel
            co2Zone={{ volumeM3: 200, airExchangeM3perH: 150 }}
            co2Driver={{ occupancyCount: 5 }}
          />

          <div className="bg-surface border border-default-token rounded-3xl p-6">
            <h3 className="text-lg font-bold text-primary-token mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {t('hygiene.critical_alerts')} ({alerts.length})
            </h3>
            <div className="space-y-3">
              {alerts.length > 0 ? (
                alerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[10px] font-black uppercase text-amber-500 mb-0.5">{alert.metadata.parameter}</p>
                      <p className="text-xs text-amber-200 leading-relaxed">
                        {alert.description}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  <p className="text-xs text-emerald-200">{t('hygiene.no_critical_alerts')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddHygieneModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={selectedProject?.id}
      />
    </div>
  );
}
