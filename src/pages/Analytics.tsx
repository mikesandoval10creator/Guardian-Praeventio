import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  BarChart3, 
  Download,
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
import { useSubscription } from '../contexts/SubscriptionContext';
import { generateExecutiveSummary } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import { buildAdoptionModuleReport } from '../hooks/useAdoption';
import type { ModuleAdoptionResponse } from '../hooks/useAdoption';
import type { ModuleUsageKind } from '../services/adoption/adoptionAnalytics';
// jsPDF + html2canvas are dynamically imported inside handleExportPDF so they
// are not in this lazy-routed page's initial chunk (~140KB saved on mount).
import { logger } from '../utils/logger';
import { ProjectHealthCheck } from '../components/ProjectHealthCheck';
import { useIndustryIntegration } from '../hooks/useIndustryIntegration';
import { EmptyState } from '../components/shared/EmptyState';

export function Analytics() {
  const { t } = useTranslation();
  const { nodes } = useRiskEngine();
  const { selectedProject, projects } = useProject();
  const { isPremium, isEnterprise } = useSubscription();
  const [isGenerating, setIsGenerating] = useState(false);
  const [executiveSummary, setExecutiveSummary] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isOnline = useOnlineStatus();
  const [adoptionReport, setAdoptionReport] = useState<ModuleAdoptionResponse | null>(null);

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

  useEffect(() => {
    if (!selectedProject?.id) return;
    const activeModules: ModuleUsageKind[] = [];
    if (incidents.length > 0) activeModules.push('incidents');
    if (findings.length > 0) activeModules.push('findings');
    if (epps.length > 0) activeModules.push('epp');
    if (audits.length > 0) activeModules.push('audit_portal');
    activeModules.push('projects');

    const daysSinceSignup = Math.max(
      0,
      Math.floor((Date.now() - new Date(selectedProject.startDate).getTime()) / 86_400_000),
    );

    buildAdoptionModuleReport(selectedProject.id, {
      snapshots: [{
        tenantId: selectedProject.id,
        snapshotAt: new Date().toISOString(),
        daysSinceSignup,
        activeModules,
        events30d: projectNodes.length,
        activeWorkers: selectedProject.workersCount ?? 0,
        activeProjects: projects.length,
        hasPaidPlan: isPremium || isEnterprise,
      }],
    }).then(setAdoptionReport).catch(() => {});
  }, [selectedProject?.id, projectNodes.length, projects.length, isPremium, isEnterprise]);

  // Dimensions for Radar Chart
  //
  // 2026-05-17 (Sprint J): real derivation from projectNodes.
  // Antes la función devolvía literales hard-coded {85, 90, 78, ...} que
  // no representaban la realidad del proyecto — el radar era decorativo.
  // Ahora cada dimensión se calcula desde los nodos cargados:
  //   - EPP:        % NodeType.EPP con metadata.status === 'Conforme'
  //   - Normativa:  % NodeType.AUDIT con metadata.status === 'Cumple'
  //   - Conducta:   % findings cerrados vs total
  //   - Procesos:   % audits sin no-conformidades (preferimos work permits
  //                 sin observaciones cuando exista source en RiskNode;
  //                 hoy los permits viven en otro adaptador, fallback audits)
  //   - Entorno:    % NodeType.RISK con level !== 'Crítico' && !== 'Alto'
  //
  // Si una categoría no tiene nodos, marcamos `insufficient_data` y
  // mostramos un score de 0 con tooltip explicativo en el radar.
  //
  // El benchmark `B` es 80 constante por ahora.
  // TODO Sprint K §164-170: reemplazar por benchmark dinámico desde
  //      "adoption analytics" (industria + tamaño empresa + región) una
  //      vez se materialicen los datos comparativos. Mientras tanto 80
  //      es el umbral interno mínimo aceptable de Praeventio.
  type SafetyDimension = {
    subject: string;
    A: number;
    B: number;
    insufficient_data: boolean;
  };

  const RADAR_BENCHMARK = 80;
  const calculateSafetyDimensions = (): SafetyDimension[] => {
    const pct = (num: number, den: number): number =>
      den > 0 ? Math.round((num / den) * 100) : 0;

    // EPP — % conformes
    const eppConformes = epps.filter(
      (e) => e.metadata?.status === 'Conforme'
    ).length;
    const eppScore = pct(eppConformes, epps.length);

    // Normativa — % auditorías con compliance status
    const auditsCumple = audits.filter(
      (a) => a.metadata?.status === 'Cumple'
    ).length;
    const normativaScore = pct(auditsCumple, audits.length);

    // Conducta — % findings cerrados vs total
    // (closedFindings ya está computado más abajo con tolerancia a 'cerrado',
    //  'cerrada', 'completed', 'completado', 'completada'; replicamos aquí
    //  para mantener el scope local — no podemos depender de la const que
    //  se declara después.)
    const closedFindingsForRadar = findings.filter((f) => {
      const status = (f.metadata?.status || f.metadata?.estado || '')
        .toString()
        .toLowerCase();
      return (
        status === 'cerrado' ||
        status === 'cerrada' ||
        status === 'closed' ||
        status === 'completed' ||
        status === 'completado' ||
        status === 'completada'
      );
    }).length;
    const conductaScore = pct(closedFindingsForRadar, findings.length);

    // Procesos — % audits sin no-conformidades.
    // Los work permits no se persisten como RiskNode (viven en
    // workPermitFirestoreAdapter), por lo que usamos el fallback
    // descrito en el spec: audits sin items en estado 'No Cumple'.
    // Si una auditoría no tiene items aún (planificada/pendiente),
    // no la contamos ni como exitosa ni como no-conformidad.
    const auditsConItems = audits.filter((a) => {
      const items = a.metadata?.items;
      return Array.isArray(items) && items.length > 0;
    });
    const auditsSinNoCumple = auditsConItems.filter((a) => {
      const items = a.metadata?.items as Array<{ status?: string }>;
      return !items.some((it) => it?.status === 'No Cumple');
    }).length;
    const procesosScore = pct(auditsSinNoCumple, auditsConItems.length);

    // Entorno — % riesgos NO críticos ni altos (i.e. controlados/aceptables)
    const riesgosControlados = risks.filter((r) => {
      const level = r.metadata?.level;
      return level !== 'Crítico' && level !== 'Alto';
    }).length;
    const entornoScore = pct(riesgosControlados, risks.length);

    return [
      {
        subject: 'EPP',
        A: eppScore,
        B: RADAR_BENCHMARK,
        insufficient_data: epps.length === 0,
      },
      {
        subject: 'Normativa',
        A: normativaScore,
        B: RADAR_BENCHMARK,
        insufficient_data: audits.length === 0,
      },
      {
        subject: 'Conducta',
        A: conductaScore,
        B: RADAR_BENCHMARK,
        insufficient_data: findings.length === 0,
      },
      {
        subject: 'Procesos',
        A: procesosScore,
        B: RADAR_BENCHMARK,
        insufficient_data: auditsConItems.length === 0,
      },
      {
        subject: 'Entorno',
        A: entornoScore,
        B: RADAR_BENCHMARK,
        insufficient_data: risks.length === 0,
      },
    ];
  };

  const safetyDimensionsData = calculateSafetyDimensions();
  const dimensionsWithInsufficientData = safetyDimensionsData.filter(
    (d) => d.insufficient_data
  );

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

  // Calculate incident trend data based on actual nodes.
  //
  // 2026-05-16 (Sprint F): fix de precisión. Antes el filtro era SOLO
  // por mes sin considerar año, lo que mezclaba incidentes de Mayo 2024,
  // 2025 y 2026 en la misma barra "May". Además había un fallback
  // `|| (i === 0 ? incidents.length : 0)` que rellenaba el mes actual
  // con TODOS los incidentes si el bucket salía vacío — disfrazaba la
  // ausencia de datos como pico de actividad.
  //
  // Ahora: bucketizamos por (año, mes) reales y mostramos cero honesto
  // cuando un mes no tiene actividad. El loop construye los últimos 5
  // meses calendario reales (no mezclados por wraparound de mes).
  const calculateTrendData = () => {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const trendData: { month: string; incidentes: number; hallazgos: number }[] = [];

    for (let i = 4; i >= 0; i--) {
      // Computamos año/mes calendario REALES (manejando wraparound
      // diciembre→enero del año anterior).
      const targetMonth = (currentMonth - i + 12) % 12;
      const targetYear = currentMonth - i < 0 ? currentYear - 1 : currentYear;
      const monthName = months[targetMonth];

      const monthIncidents = incidents.filter((n) => {
        if (!n.createdAt) return false;
        const date = new Date(n.createdAt);
        return date.getMonth() === targetMonth && date.getFullYear() === targetYear;
      }).length;

      const monthFindings = findings.filter((n) => {
        if (!n.createdAt) return false;
        const date = new Date(n.createdAt);
        return date.getMonth() === targetMonth && date.getFullYear() === targetYear;
      }).length;

      trendData.push({
        month: monthName,
        incidentes: monthIncidents, // cero honesto si no hay datos
        hallazgos: monthFindings,
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
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
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
    <div data-testid="analytics-page" className="p-4 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-950 dark:text-white">{t('analytics.title', 'Reportabilidad Gerencial')}</h1>
            <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest">{t('analytics.tagline', 'Analytics & Insights Ejecutivos')}</p>
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
        <div className="bg-white dark:bg-zinc-900/50 border border-dashed border-default-token rounded-2xl sm:rounded-3xl shadow-sm">
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
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('analytics.kpi.incidents_month', 'Incidentes (Mes)')}</p>
              <Activity className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-black text-zinc-900 leading-none">{incidents.length}</span>
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
          <div className="bg-surface rounded-2xl p-6 border border-default-token shadow-sm lg:col-span-2">
            <h3 className="text-sm font-bold text-primary-token uppercase tracking-widest mb-6" id="safety-radar-title">{t('analytics.chart.safety_radar', 'Radar de Dimensiones de Seguridad')}</h3>
            <div
              className="h-80"
              role="img"
              aria-labelledby="safety-radar-title"
              aria-label={`Comparativa Actual vs Objetivo (escala 0–100). ${safetyDimensionsData.map(d => `${d.subject}: actual ${d.A}, objetivo ${d.B}${d.insufficient_data ? ' (datos insuficientes)' : ''}`).join('; ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={safetyDimensionsData}>
                  <PolarGrid stroke="#e4e4e7" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 10 }} />
                  <Radar name="Actual" dataKey="A" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.6} />
                  <Radar name="Objetivo" dataKey="B" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                  <Legend />
                  <Tooltip
                    formatter={(value, name, props) => {
                      const payload = (props as { payload?: { subject?: string } } | undefined)?.payload;
                      const subject = payload?.subject;
                      const dim = safetyDimensionsData.find(d => d.subject === subject);
                      if (dim?.insufficient_data && name === 'Actual') {
                        return [`${String(value)} (datos insuficientes)`, name];
                      }
                      return [String(value), name];
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {dimensionsWithInsufficientData.length > 0 && (
              <p
                className="mt-3 text-[11px] font-medium text-muted-token"
                role="note"
              >
                <span className="font-bold text-amber-600 dark:text-amber-400">⚠ Datos insuficientes:</span>{' '}
                {dimensionsWithInsufficientData.map(d => d.subject).join(', ')}.
                Registra nodos en estas categorías para obtener un puntaje real.
              </p>
            )}
           </div>
        </div>

        {adoptionReport && (
          <div className="bg-surface rounded-2xl p-6 border border-default-token shadow-sm">
            <h3 className="text-sm font-bold text-primary-token uppercase tracking-widest mb-6">
              {t('analytics.chart.module_adoption', 'Adopción de Módulos')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {(Object.entries(adoptionReport.report.byModule) as [ModuleUsageKind, { adopters: number; adoptionPercent: number }][]).map(
                ([module, data]) => (
                  <div key={module} className="rounded-xl p-3 border border-default-token bg-zinc-50 dark:bg-zinc-800/50">
                    <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest truncate">{module.replace(/_/g, ' ')}</p>
                    <p className="text-2xl font-black text-primary-token mt-1">{data.adoptionPercent}%</p>
                    <p className="text-[10px] text-muted-token">{data.adopters} adopters</p>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

      </div>
      )}
    </div>
  );
}
