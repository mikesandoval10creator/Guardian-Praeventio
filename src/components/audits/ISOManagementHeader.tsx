import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

// ─── Types (mirrored from ISOManagement) ──────────────────────────────────────

export interface ISOHeaderDocument {
  id: string;
  estado: 'Vigente' | 'Obsoleto' | 'En revisión';
}

export interface ISOHeaderImprovement {
  id: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface ISOManagementHeaderProps {
  docs: ISOHeaderDocument[];
  improvements: ISOHeaderImprovement[];
  auditCount: number;
  isoRiskCount: number;
}

const TEAL = '#4db6ac';

/**
 * ISOManagementHeader
 * Renders the ISO 45001 module summary header: KPI cards + ISO 45001 summary
 * card. Extracted from ISOManagement.tsx (F-C14, Sprint 20 second wave).
 */
export function ISOManagementHeader({
  docs,
  improvements,
  auditCount,
  isoRiskCount,
}: ISOManagementHeaderProps) {
  const { t } = useTranslation();
  const inProgress = improvements.filter(i => i.status === 'in_progress').length;

  const kpis = [
    {
      label: t('audits.kpi_total_documents', 'Total Documentos'),
      value: docs.length,
      icon: FileText,
      color: 'text-[#4db6ac]',
      bg: 'bg-[#4db6ac]/10',
    },
    {
      label: t('audits.kpi_completed_audits', 'Auditorías Completadas'),
      value: auditCount,
      icon: CheckCircle2,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      label: t('audits.kpi_in_progress_improvements', 'Mejoras en Progreso'),
      value: inProgress,
      icon: RefreshCw,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: t('audits.kpi_high_iso_risks', 'Riesgos ISO Altos'),
      value: isoRiskCount,
      icon: AlertTriangle,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm"
          >
            <div className={`w-8 h-8 rounded-xl ${kpi.bg} flex items-center justify-center mb-3`}>
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{kpi.label}</p>
            <p className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ISO 45001 Summary Card */}
      <div className="bg-white/80 dark:bg-zinc-900/80 rounded-2xl p-5 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5" style={{ color: TEAL }} />
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">
            {t('audits.iso_summary_title', 'Sistema de Gestión ISO 45001')}
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: t('audits.iso_active_documents', 'Documentos Vigentes'), value: docs.filter(d => d.estado === 'Vigente').length, total: docs.length },
            { label: t('audits.iso_completed_improvements', 'Mejoras Completadas'), value: improvements.filter(i => i.status === 'done').length, total: improvements.length },
            { label: t('audits.iso_audit_coverage', 'Cobertura Auditorías'), value: auditCount, total: auditCount + 2 },
          ].map(item => {
            const pct = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
            return (
              <div key={item.label} className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{item.label}</p>
                <p className="text-lg font-black text-zinc-900 dark:text-white">{item.value}<span className="text-xs text-zinc-400">/{item.total}</span></p>
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: TEAL }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
