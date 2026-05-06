import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  BarChart3, 
  Download, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  ShieldCheck, 
  Activity,
  BrainCircuit,
  Loader2,
  FileText
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend
} from 'recharts';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { useProject } from '../contexts/ProjectContext';
import { generateExecutiveSummary } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { logger } from '../utils/logger';
import { ProjectHealthCheck } from '../components/ProjectHealthCheck';
import { useIndustryIntegration } from '../hooks/useIndustryIntegration';
import { EmptyState } from '../components/shared/EmptyState';

export function Analytics() {
  const { t } = useTranslation();
  const { nodes } = useRiskEngine();
  const { selectedProject } = useProject();
  const [isGenerating, setIsGenerating] = useState(false);
  const [executiveSummary, setExecutiveSummary] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isOnline = useOnlineStatus();

  // Filter nodes by project
  const projectNodes = nodes.filter(n => !selectedProject || n.projectId === selectedProject.id);

  // Industry compliance score
  const { calculateComplianceScore } = useIndustryIntegration();
  const complianceScore = selectedProject
    ? calculateComplianceScore(selectedProject.industry ?? 'GP-MANU', projectNodes)
    : null;

  // Calculate KPIs
  const risks = projectNodes.filter(n => n.type === NodeType.RISK);
  const incidents = projectNodes.filter(n => n.type === NodeType.INCIDENT);
  const findings = projectNodes.filter(n => n.type === NodeType.FINDING);
  const audits = projectNodes.filter(n => n.type === NodeType.AUDIT);
  const epps = projectNodes.filter(n => n.type === NodeType.EPP);

  // Dimensions for Radar Chart
  const calculateSafetyDimensions = () => {
    return [
      { subject: 'EPP', A: 85, B: 90 },
      { subject: 'Normativa', A: 78, B: 85 },
      { subject: 'Conducta', A: 92, B: 88 },
      { subject: 'Procesos', A: 70, B: 80 },
      { subject: 'Entorno', A: 88, B: 92 },
    ];
  };

  const safetyDimensionsData = calculateSafetyDimensions();

  const criticalRisks = risks.filter(r => r.metadata?.level === 'Crítico').length;
  const highRisks = risks.filter(r => r.metadata?.level === 'Alto').length;
  const mediumRisks = risks.filter(r => r.metadata?.level === 'Medio').length;
  const lowRisks = risks.filter(r => r.metadata?.level === 'Bajo').length;

  const openFindings = findings.filter(f => {
    const status = (f.metadata?.status || f.metadata?.estado || '').toLowerCase();
    return status === 'abierto' || status === 'abierta' || status === 'open';
  }).length;
  
  const closedFindings = findings.filter(f => {
    const status = (f.metadata?.status || f.metadata?.estado || '').toLowerCase();
    return status === 'cerrado' || status === 'cerrada' || status === 'completed' || status === 'completado' || status === 'completada';
  }).length;

  const stats = {
    totalRisks: risks.length,
    criticalRisks,
    totalIncidents: incidents.length,
    totalFindings: findings.length,
    openFindings,
    complianceRate: audits.length > 0 ? Math.round((audits.filter(a => a.metadata?.status === 'Cumple').length / audits.length) * 100) : 0,
    eppCoverage: epps.length > 0 ? Math.round((epps.filter(e => e.metadata?.status === 'Conforme').length / epps.length) * 100) : 0
  };

  // Chart Data
  const riskLevelData = [
    { name: 'Crítico', value: criticalRisks, color: '#ef4444' },
    { name: 'Alto', value: highRisks, color: '#f97316' },
    { name: 'Medio', value: mediumRisks, color: '#eab308' },
    { name: 'Bajo', value: lowRisks, color: '#22c55e' },
  ];

  // Calculate incident trend data based on actual nodes
  const calculateTrendData = () => {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const currentMonth = new Date().getMonth();
    const trendData = [];

    for (let i = 4; i >= 0; i--) {
      const monthIndex = (currentMonth - i + 12) % 12;
      const monthName = months[monthIndex];
      
      // Filter nodes for this specific month (simplified logic, assumes current year for now)
      // In a real app, you'd check the year too.
      const monthIncidents = incidents.filter(n => {
        const date = n.createdAt ? new Date(n.createdAt) : new Date();
        return date.getMonth() === monthIndex;
      }).length;

      const monthFindings = findings.filter(n => {
        const date = n.createdAt ? new Date(n.createdAt) : new Date();
        return date.getMonth() === monthIndex;
      }).length;

      trendData.push({
        month: monthName,
        incidentes: monthIncidents || (i === 0 ? incidents.length : 0), // Fallback for demo
        hallazgos: monthFindings || (i === 0 ? findings.length : 0) // Fallback for demo
      });
    }
    return trendData;
  };

  const incidentTrendData = calculateTrendData();

  const handleGenerateSummary = async () => {
    if (!isOnline) {
      const cached = await getCachedAIResponse('analytics-summary');
      if (cached) {
        setExecutiveSummary(cached);
      }
      return;
    }

    setIsGenerating(true);
    try {
      const summary = await generateExecutiveSummary(stats, projectNodes);
      setExecutiveSummary(summary);
      await cacheAIResponse('analytics-summary', summary);
    } catch (error) {
      logger.error("Error generating summary:", error);
      const cached = await getCachedAIResponse('analytics-summary');
      if (cached) {
        setExecutiveSummary(cached);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const reportElement = document.getElementById('executive-report');
      if (!reportElement) return;

      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Reporte_Ejecutivo_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      logger.error("Error exporting PDF:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-950 dark:text-white">{t('analytics.title', 'Reportabilidad Gerencial')}</h1>
            <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">{t('analytics.tagline', 'Analytics & Insights Ejecutivos')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateSummary}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <BrainCircuit className="w-4 h-4 text-[#d4af37] dark:text-[#4db6ac]" />
            )}
            {isOnline ? 'Generar Resumen IA' : 'Cargar Resumen Guardado'}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={!executiveSummary || isExporting}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Project Health Check */}
      <ProjectHealthCheck />

      {projectNodes.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl shadow-sm">
          <EmptyState
            mascot
            title="Aún no hay datos para analizar"
            description="Registra riesgos, incidentes, hallazgos o auditorías en tu proyecto para visualizar KPIs y tendencias en este panel."
            action={{ label: 'Generar Resumen IA', onClick: handleGenerateSummary }}
          />
        </div>
      ) : (
      /* Report Container (for PDF export) */
      <div id="executive-report" className="space-y-6 bg-zinc-50 p-4 rounded-2xl">
        
        {/* AI Executive Summary */}
        {executiveSummary && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm"
          >
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-zinc-100">
              <div className="w-10 h-10 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-[#4db6ac] dark:text-[#d4af37]" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-900 uppercase tracking-tight">{executiveSummary.titulo}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                    executiveSummary.nivelAlertaGlobal === 'Crítico' ? 'bg-rose-100 text-rose-700' :
                    executiveSummary.nivelAlertaGlobal === 'Precaución' ? 'bg-amber-100 text-amber-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>
                    Estado: {executiveSummary.nivelAlertaGlobal}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="prose prose-sm max-w-none text-zinc-600">
                {executiveSummary.resumen.split('\n').map((paragraph: string, i: number) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>

              <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
                <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  {t('analytics.strategic_recommendations', 'Recomendaciones Estratégicas')}
                </h3>
                <ul className="space-y-2">
                  {executiveSummary.recomendacionesClave.map((rec: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.critical_risks', 'Riesgos Críticos')}</p>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-black text-zinc-900 leading-none">{criticalRisks}</span>
              <span className="text-xs font-medium text-rose-500 flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" /> +2%
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.incidents_month', 'Incidentes (Mes)')}</p>
              <Activity className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-black text-zinc-900 leading-none">{incidents.length}</span>
              <span className="text-xs font-medium text-emerald-500 flex items-center">
                <TrendingDown className="w-3 h-3 mr-1" /> -15%
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.open_findings', 'Hallazgos Abiertos')}</p>
              <FileText className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-black text-zinc-900 leading-none">{openFindings}</span>
              <span className="text-xs font-medium text-zinc-400">de {findings.length} total</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.epp_compliance', 'Cumplimiento EPP')}</p>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-black text-zinc-900 leading-none">{stats.eppCoverage}%</span>
              <span className="text-xs font-medium text-emerald-500 flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" /> +5%
              </span>
            </div>
          </div>

          {/* Industry Compliance Score */}
          {complianceScore && (
            <div className={`bg-white rounded-2xl p-4 border shadow-sm ${
              complianceScore.total >= 80 ? 'border-emerald-200' :
              complianceScore.total >= 60 ? 'border-amber-200' : 'border-rose-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.legal_index', 'Índice Legal')}</p>
                <BrainCircuit className={`w-4 h-4 ${
                  complianceScore.total >= 80 ? 'text-emerald-500' :
                  complianceScore.total >= 60 ? 'text-amber-500' : 'text-rose-500'
                }`} />
              </div>
              <div className="flex items-end gap-2 mb-1">
                <span className={`text-3xl font-black leading-none ${
                  complianceScore.total >= 80 ? 'text-emerald-600' :
                  complianceScore.total >= 60 ? 'text-amber-600' : 'text-rose-600'
                }`}>{complianceScore.total}%</span>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-1">
                <div
                  className={`h-1 rounded-full transition-all ${
                    complianceScore.total >= 80 ? 'bg-emerald-500' :
                    complianceScore.total >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${complianceScore.total}%` }}
                />
              </div>
              {complianceScore.missingNormativas.length > 0 && (
                <p className="text-[9px] text-rose-500 mt-1 font-medium">
                  {complianceScore.missingNormativas.length} normativa{complianceScore.missingNormativas.length > 1 ? 's' : ''} faltante{complianceScore.missingNormativas.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Distribution */}
          <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-6" id="risk-distribution-title">{t('analytics.chart.risk_distribution', 'Distribución de Riesgos')}</h3>
            <div
              className="h-64"
              role="img"
              aria-labelledby="risk-distribution-title"
              aria-label={`Distribución de riesgos por nivel: ${riskLevelData.map(r => `${r.name} ${r.value}`).join(', ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskLevelData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e4e4e7" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} width={60} />
                  <Tooltip 
                    cursor={{ fill: '#f4f4f5' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {riskLevelData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Incident Trend */}
          <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-6" id="incident-trend-title">{t('analytics.chart.incident_trend', 'Tendencia de Incidentes y Hallazgos')}</h3>
            <div
              className="h-64"
              role="img"
              aria-labelledby="incident-trend-title"
              aria-label={`Línea de tendencia mensual. ${incidentTrendData.map(d => `${d.month}: ${d.incidentes ?? 0} incidentes y ${d.hallazgos ?? 0} hallazgos`).join('; ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={incidentTrendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line type="monotone" dataKey="incidentes" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="hallazgos" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Safety Dimensions (New) */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-zinc-200 dark:border-white/5 shadow-sm lg:col-span-2">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-6" id="safety-radar-title">{t('analytics.chart.safety_radar', 'Radar de Dimensiones de Seguridad')}</h3>
            <div
              className="h-80"
              role="img"
              aria-labelledby="safety-radar-title"
              aria-label={`Comparativa Actual vs Objetivo (escala 0–100). ${safetyDimensionsData.map(d => `${d.subject}: actual ${d.A}, objetivo ${d.B}`).join('; ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={safetyDimensionsData}>
                  <PolarGrid stroke="#e4e4e7" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 10 }} />
                  <Radar name="Actual" dataKey="A" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.6} />
                  <Radar name="Objetivo" dataKey="B" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </div>
      )}
    </div>
  );
}
