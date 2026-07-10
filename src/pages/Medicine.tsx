import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
// Sprint 36 G1 fix — ADR 0012 enforcement: vistas médicas DEBEN renderizar
// <MedicalDisclaimer/>. El hook precommit-medical-guard.cjs detectó que
// Medicine.tsx no lo tenía (regresión histórica que i18n sweep destapó).
import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import {
  Activity,
  Heart,
  Stethoscope,
  Search,
  Plus,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Brain
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { AddMedicineModal } from '../components/medicine/AddMedicineModal';
import { HumanBodyViewer, BodyRegion } from '../components/occupational-health/HumanBodyViewer';
import { SymptomDocumenter } from '../components/occupational-health/SymptomDocumenter';
import { DifferentialDiagnosis } from '../components/medicine/DifferentialDiagnosis';
import { AptitudeCertificateForm } from '../components/medicine/AptitudeCertificateForm';
import { AnatomyLibrary } from '../components/medicine/AnatomyLibrary';
import { VigilanciaScheduler } from '../components/medicine/VigilanciaScheduler';
import { DrugInteractions } from '../components/medicine/DrugInteractions';
import { Ds109Modal } from '../components/medicine/Ds109Modal';
import { Ds67Modal } from '../components/medicine/Ds67Modal';
import { computeSurveillanceBreakdown } from './medicineMetrics';
import { OccupationalContextBundleCard } from '../components/health/OccupationalContextBundleCard';
import { OCCUPATIONAL_BUNDLE_DISCLAIMER } from '../services/health/occupationalContext';
import { FileCheck } from 'lucide-react';

export function Medicine() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes, loading } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [ds109Open, setDs109Open] = useState(false);
  const [ds67Open, setDs67Open] = useState(false);
  const [bodyRegions, setBodyRegions] = useState<BodyRegion[]>([]);
  const [activeTab, setActiveTab] = useState<'visor' | 'diagnostico' | 'aptitud' | 'anatomia' | 'vigilancia' | 'farmacos'>('visor');

  const medicalNodes = nodes.filter(node => 
    node.type === NodeType.MEDICINE && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const filteredRecords = medicalNodes.filter(node => 
    (node.metadata?.patient || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (node.metadata?.examType || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  const stats = {
    aptitude: medicalNodes.length > 0
      ? Math.round((medicalNodes.filter(n => n.metadata.result === 'Apto').length / medicalNodes.length) * 100)
      : 0,
    restrictions: medicalNodes.filter(n => n.metadata.result === 'Apto con restricción').length,
    pending: medicalNodes.filter(n => n.metadata.status === 'scheduled').length
  };

  // REAL active-surveillance breakdown derived from the project's actual
  // MEDICINE records, grouped by their real `examType`. Replaces the previously
  // hardcoded 45 / 28 / 15 program counts (which had no source in the data
  // model). Empty → honest "Sin datos aún" state, never a fabricated number.
  const surveillance = useMemo(() => computeSurveillanceBreakdown(medicalNodes), [medicalNodes]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* ADR 0012 — Praeventio NUNCA diagnostica. Esta vista médica
          renderiza el disclaimer canónico arriba de todo el contenido
          para reforzar al usuario que el rol del producto es asistir
          al profesional, no reemplazarlo. */}
      <MedicalDisclaimer />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter flex items-center gap-3">
            <Stethoscope className="w-8 h-8 text-rose-500" />
            {t('medicine.title')}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{t('medicine.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setDs109Open(true)}
            className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white px-4 py-2 rounded-xl font-medium transition-all border border-zinc-200 dark:border-white/10 active:scale-95"
            title={t('medicine.ds109_tooltip')}
          >
            <FileCheck className="w-5 h-5 text-teal-500 dark:text-gold-400" />
            <span>{t('medicine.ds109_label')}</span>
          </button>
          <button
            onClick={() => setDs67Open(true)}
            className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white px-4 py-2 rounded-xl font-medium transition-all border border-zinc-200 dark:border-white/10 active:scale-95"
            title={t('medicine.ds67_tooltip')}
          >
            <FileCheck className="w-5 h-5 text-teal-500 dark:text-gold-400" />
            <span>{t('medicine.ds67_label')}</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-rose-500/20 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            <span>{t('medicine.new_consultation')}</span>
          </button>
        </div>
      </div>

      {/* Doctor's Workstation — tabbed AI tools */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Brain className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
          <h2 className="text-sm font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">{t('medicine.workstation')}</h2>
          <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 uppercase">
            Gemini IA
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 overflow-x-auto custom-scrollbar">
          {[
            { id: 'visor' as const, label: t('medicine.tab_visor') },
            { id: 'diagnostico' as const, label: t('medicine.tab_dx') },
            { id: 'aptitud' as const, label: t('medicine.tab_aptitude') },
            { id: 'anatomia' as const, label: t('medicine.tab_anatomy') },
            { id: 'vigilancia' as const, label: t('medicine.tab_surveillance') },
            { id: 'farmacos' as const, label: t('medicine.tab_drugs') },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-800 text-[#2a8a81] dark:text-[#d4af37] shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'visor' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <HumanBodyViewer onChange={setBodyRegions} compact />
            <SymptomDocumenter regions={bodyRegions} />
          </div>
        )}
        {activeTab === 'diagnostico' && <DifferentialDiagnosis />}
        {activeTab === 'aptitud' && <AptitudeCertificateForm />}
        {activeTab === 'anatomia' && <AnatomyLibrary />}
        {activeTab === 'vigilancia' && <VigilanciaScheduler />}
        {activeTab === 'farmacos' && <DrugInteractions />}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Records List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder={t('medicine.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
              </div>
            ) : filteredRecords.length > 0 ? (
              filteredRecords.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 hover:border-rose-500/30 transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-rose-500 border border-white/5">
                        <Stethoscope className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white group-hover:text-rose-400 transition-colors">{node.metadata.patient}</h3>
                        <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider">{node.metadata.examType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{t('medicine.result')}</p>
                        <span className={`text-xs font-bold ${
                          node.metadata.result === 'Apto' ? 'text-[#4db6ac]' : 
                          node.metadata.result === 'Apto con restricción' ? 'text-amber-500' : 
                          'text-zinc-500'
                        }`}>
                          {node.metadata.result}
                        </span>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{t('medicine.date')}</p>
                        <span className="text-xs font-bold text-white">{node.metadata.date}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-500 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
                <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Heart className="w-8 h-8 text-zinc-600" />
                </div>
                <p className="text-zinc-500 text-sm">{t('medicine.empty')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-500" />
              {t('medicine.health_status')}
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">{t('medicine.medical_aptitude')}</span>
                <span className="text-xs font-bold text-[#4db6ac]">{stats.aptitude}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">{t('medicine.active_restrictions')}</span>
                <span className="text-xs font-bold text-amber-500">{stats.restrictions}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">{t('medicine.pending_exams')}</span>
                <span className="text-xs font-bold text-rose-500">{stats.pending}</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#4db6ac]" />
              {t('medicine.surveillance')}
            </h3>
            {surveillance.hasData ? (
              <div className="space-y-4">
                {surveillance.rows.map((row) => (
                  <div key={row.examType} className="space-y-2">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-zinc-400">
                        {row.i18nKey ? t(row.i18nKey) : t('medicine.exam_other')}
                      </span>
                      <span className="text-white">{row.count}</span>
                    </div>
                    <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#4db6ac] rounded-full"
                        style={{ width: `${Math.round((row.count / surveillance.max) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">{t('medicine.surveillance_empty')}</p>
            )}
          </div>

          <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <h4 className="font-bold text-rose-500">{t('medicine.health_alert')}</h4>
            </div>
            <p className="text-xs text-rose-200 leading-relaxed">
              {t('medicine.health_alert_text')}
            </p>
          </div>

          {/* Wire OccupationalContextBundleCard — informative occupational
              context bundle for the treating physician. Renders with a minimal
              placeholder bundle until real worker data is wired. Per ADR 0012:
              Praeventio organizes, never diagnoses. */}
          {user && (
            <OccupationalContextBundleCard
              bundle={{
                workerUid: user.uid,
                generatedAt: Date.now(),
                laborHistory: [],
                ergonomicMetrics: [],
                selfReportedSymptoms: [],
                disclaimer: OCCUPATIONAL_BUNDLE_DISCLAIMER,
              }}
            />
          )}
        </div>
      </div>

      <AddMedicineModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={selectedProject?.id}
      />

      <Ds109Modal isOpen={ds109Open} onClose={() => setDs109Open(false)} />

      <Ds67Modal isOpen={ds67Open} onClose={() => setDs67Open(false)} />
    </div>
  );
}
